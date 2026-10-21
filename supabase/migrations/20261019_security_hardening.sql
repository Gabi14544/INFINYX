-- =============================================================================
-- Tech-Value Vault: Endurecimiento de Seguridad y Políticas RLS
-- =============================================================================

-- 1. Asegurar columnas de verificador de descarga en profiles
alter table public.profiles
  add column if not exists download_verifier text,
  add column if not exists download_salt text;

-- 2. Política RLS faltante para permitir DELETE en document_versions al propietario
drop policy if exists "versions_owner_delete" on public.document_versions;
create policy "versions_owner_delete"
  on public.document_versions for delete
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_versions.document_id
        and d.user_id = auth.uid()
    )
  );

-- 3. Ajustar clave foránea de audit_logs para no bloquear la eliminación de documentos
--    conservando el registro histórico de auditoría con document_id = NULL
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'audit_logs'
      and constraint_name = 'audit_logs_document_id_fkey'
  ) then
    alter table public.audit_logs
      drop constraint audit_logs_document_id_fkey;
  end if;

  alter table public.audit_logs
    add constraint audit_logs_document_id_fkey
    foreign key (document_id)
    references public.documents(id)
    on delete set null;
end $$;

-- 4. Trigger para impedir que un atacante con sesión abierta borre o sobrescriba
--    el download_verifier / download_salt una vez configurados en profiles
create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'No se permite modificar el identificador del perfil.';
  end if;

  if old.download_verifier is not null and length(old.download_verifier) > 0 then
    if new.download_verifier is distinct from old.download_verifier
       or new.download_salt is distinct from old.download_salt then
      raise exception 'El verificador de descarga ya está configurado y no puede sobrescribirse directamente.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_security_fields on public.profiles;
create trigger trg_protect_profile_security_fields
  before update on public.profiles
  for each row
  execute function public.protect_profile_security_fields();
