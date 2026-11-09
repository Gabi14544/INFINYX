-- Reproducible baseline for a fresh Supabase project. Never drops existing data.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null,
  storage_path text not null unique,
  sha256_hash text not null,
  iv text not null,
  file_size bigint not null,
  created_at timestamptz not null default now(),
  unique(document_id, version_number)
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
