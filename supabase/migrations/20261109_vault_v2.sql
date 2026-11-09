-- Prototype v2. Deliberately refuses a silent migration of legacy ciphertext.
do $$ begin
  if exists (select 1 from public.documents) or exists (select 1 from public.document_versions) then
    raise exception 'Legacy documents exist. Export them with the previous client before migrating to v2.';
  end if;
end $$;

alter table public.profiles add column vault_salt text not null default encode(extensions.gen_random_bytes(32), 'hex') check (vault_salt ~ '^[a-f0-9]{64}$');
alter table public.profiles drop column download_verifier, drop column download_salt;
drop trigger if exists trg_protect_profile_security_fields on public.profiles;
drop function if exists public.protect_profile_security_fields();
alter table public.documents drop column name, drop column mime_type, add column deleting boolean not null default false;
alter table public.document_versions drop column sha256_hash, drop column file_size,
  add column encrypted_metadata text not null check (encrypted_metadata ~ '^v2:[a-f0-9]{24}:[A-Za-z0-9+/]+=*$' and length(encrypted_metadata) <= 32768),
  add constraint valid_iv check (iv ~ '^[a-f0-9]{24}$'),
  add constraint valid_version check (version_number between 1 and 3);
-- Normalize the nullable timestamps and missing constraints found in the original prototype.
update public.profiles set created_at=now() where created_at is null;
alter table public.profiles alter column created_at set default now(), alter column created_at set not null;
update public.documents set created_at=now() where created_at is null;
update public.documents set updated_at=created_at where updated_at is null;
alter table public.documents alter column created_at set default now(), alter column created_at set not null,
  alter column updated_at set default now(), alter column updated_at set not null;
alter table public.document_versions alter column created_at set default now(), alter column created_at set not null;
update public.audit_logs set created_at=now() where created_at is null;
alter table public.audit_logs alter column created_at set default now(), alter column created_at set not null,
  alter column user_id drop not null;
create unique index if not exists vault_storage_path_unique on public.document_versions(storage_path);
create index documents_user_idx on public.documents(user_id);
create index audit_logs_user_idx on public.audit_logs(user_id);

create table public.vault_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salt text not null check (salt ~ '^[a-f0-9]{64}$'),
  verifier text not null check (verifier ~ '^[a-f0-9]{64}$')
);
create table public.vault_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.vault_credentials enable row level security;
alter table public.vault_rate_limits enable row level security;
revoke all on public.vault_credentials, public.vault_rate_limits from public, anon, authenticated;
grant all on public.vault_credentials, public.vault_rate_limits to service_role;

-- Replace the complete policy set on APP tables, avoiding accidental OR composition.
do $$ declare p record; begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname='public' and tablename in ('profiles','documents','document_versions','audit_logs') loop
    execute format('drop policy %I on %I.%I', p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.profiles, public.documents, public.document_versions, public.audit_logs from public, anon, authenticated;
grant select on public.profiles, public.documents, public.document_versions, public.audit_logs to authenticated;
grant all on public.profiles, public.documents, public.document_versions, public.audit_logs to service_role;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid());
create policy documents_read on public.documents for select to authenticated using(user_id=auth.uid());
create policy versions_read on public.document_versions for select to authenticated using(exists(select 1 from public.documents d where d.id=document_id and d.user_id=auth.uid()));
create policy audit_read on public.audit_logs for select to authenticated using(user_id=auth.uid());

create or replace function public.create_vault_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,email) values(new.id,new.email) on conflict(id) do nothing;
  return new;
end $$;
-- Replace only the known signup trigger, not unrelated project triggers.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_vault_profile();
insert into public.profiles(id,email) select id,email from auth.users on conflict(id) do nothing;

-- Immutable uploads. Clients can INSERT only in their own prefix; edge function mediates reads/deletes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vault_files','vault_files',false,52428816,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists vault_files_owner on storage.objects;
create policy vault_insert on storage.objects for insert to authenticated with check(bucket_id='vault_files' and (storage.foldername(name))[1]=auth.uid()::text);
-- Restrictive policies also constrain any older permissive project policies, without affecting other buckets.
create policy vault_no_direct_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'vault_files');
create policy vault_no_direct_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'vault_files') with check(bucket_id<>'vault_files');
create policy vault_no_direct_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'vault_files');
create policy vault_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'vault_files' or (storage.foldername(name))[1]=auth.uid()::text);
create policy vault_anon_guard on storage.objects as restrictive for all to anon using(bucket_id<>'vault_files') with check(bucket_id<>'vault_files');

create function public.commit_vault_version(p_document_id uuid,p_version_number integer,p_storage_path text,p_iv text,p_metadata text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_owner uuid; v_deleting boolean; v_expected integer; v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  select user_id,deleting into v_owner,v_deleting from public.documents where id=p_document_id for update;
  if found and (v_owner<>v_user or v_deleting) then raise exception 'Document unavailable'; end if;
  if p_storage_path !~ ('^'||v_user::text||'/'||p_document_id::text||'/[0-9a-f-]{36}\.enc$') then raise exception 'Invalid path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='vault_files' and name=p_storage_path and owner_id=v_user::text) then raise exception 'Upload not found'; end if;
  select coalesce(max(version_number),0)+1 into v_expected from public.document_versions where document_id=p_document_id;
  if p_version_number<>v_expected or v_expected>3 then raise exception 'Version conflict: refresh and retry'; end if;
  insert into public.documents(id,user_id) values(p_document_id,v_user) on conflict(id) do update set updated_at=now();
  insert into public.document_versions(document_id,version_number,storage_path,iv,encrypted_metadata)
  values(p_document_id,p_version_number,p_storage_path,p_iv,p_metadata) returning id into v_id;
  insert into public.audit_logs(user_id,document_id,action,details) values(v_user,p_document_id,'UPLOAD',jsonb_build_object('version_id',v_id,'version_number',p_version_number));
  return v_id;
end $$;

-- Rate reservation commits before expensive PBKDF2 or verification failures (no rollback bypass).
create function public.reserve_vault_attempt(p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_attempts integer;
begin
  insert into public.vault_rate_limits as r(user_id) values(p_user_id)
  on conflict(user_id) do update set
    attempts=case when r.window_start < now()-interval '1 minute' then 1 else r.attempts+1 end,
    window_start=case when r.window_start < now()-interval '1 minute' then now() else r.window_start end
  returning attempts into v_attempts;
  return v_attempts<=30;
end $$;
create function public.begin_vault_delete(p_user_id uuid,p_document_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  update public.documents set deleting=true where id=p_document_id and user_id=p_user_id;
  if not found then raise exception 'Document unavailable'; end if;
end $$;
create function public.finish_vault_delete(p_user_id uuid,p_document_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  if not exists(select 1 from public.documents where id=p_document_id and user_id=p_user_id and deleting) then raise exception 'Document unavailable'; end if;
  insert into public.audit_logs(user_id,document_id,action,details) values(p_user_id,p_document_id,'DELETE',jsonb_build_object('deleted_document_id',p_document_id));
  delete from public.documents where id=p_document_id and user_id=p_user_id;
end $$;

revoke all on function public.create_vault_profile(),public.commit_vault_version(uuid,integer,text,text,text),public.reserve_vault_attempt(uuid),public.begin_vault_delete(uuid,uuid),public.finish_vault_delete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_vault_version(uuid,integer,text,text,text) to authenticated;
grant execute on function public.reserve_vault_attempt(uuid),public.begin_vault_delete(uuid,uuid),public.finish_vault_delete(uuid,uuid) to service_role;
