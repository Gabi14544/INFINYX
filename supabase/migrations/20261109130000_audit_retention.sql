-- The deployed prototype referenced profiles with ON DELETE CASCADE.
-- Audit events must survive account deletion, too, without retaining the user identifier.
alter table public.audit_logs alter column user_id drop not null;
alter table public.audit_logs drop constraint if exists audit_logs_user_id_fkey;
alter table public.audit_logs add constraint audit_logs_user_id_fkey
  foreign key(user_id) references auth.users(id) on delete set null;
