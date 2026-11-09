-- Minimal Supabase contracts for isolated PostgreSQL integration tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text);
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
alter table storage.objects enable row level security;
grant usage on schema public,storage to anon,authenticated,service_role;
grant all on storage.objects to anon,authenticated,service_role;
-- A deliberately overbroad pre-existing policy must not bypass the new restrictions.
create policy old_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true);
