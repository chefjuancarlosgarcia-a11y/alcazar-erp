-- Disposable local lab bootstrap (NOT Supabase remote). Versioned in-repo for finance accounting labs.
-- Used by scripts/run-finance-full-schema-lab.mjs and stage package local validation.
\set ON_ERROR_STOP on

select
  current_setting('server_version') as pg_version,
  inet_server_addr() as server_addr,
  current_database() as database_name;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists supabase_migrations;

create extension if not exists pgcrypto with schema extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text default 'authenticated',
  role text default 'authenticated',
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_super_admin boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

do $roles$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $roles$;

do $roles$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $roles$;

do $roles$
begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $roles$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to postgres, service_role, authenticated;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

grant select on auth.users to authenticated, service_role;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to postgres, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to authenticated;

do $pub$
begin
  create publication supabase_realtime;
exception
  when duplicate_object then null;
end $pub$;
