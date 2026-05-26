-- Authentication profile foundation for Pizzeria El Gran Alcazar.
-- Run this migration from the Supabase SQL Editor before enabling application logins.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text unique,
  email text,
  role text not null default 'colaborador'
    check (role in (
      'admin', 'gerente_general', 'rrhh', 'supervisor', 'cajero', 'mesero',
      'cocinero', 'pizzero', 'barista', 'bartender', 'repostero', 'panadero',
      'colaborador'
    )),
  area_id text,
  area_name text,
  employee_id text,
  avatar_url text,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

create or replace function public.is_profile_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'gerente_general')
      and status = 'active'
  );
$$;

revoke all on function public.is_profile_manager() from public;
grant execute on function public.is_profile_manager() to authenticated;

drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_managers_read_all" on public.profiles;
create policy "profiles_managers_read_all"
  on public.profiles
  for select
  to authenticated
  using (public.is_profile_manager());

drop policy if exists "profiles_update_own_personal" on public.profiles;
create policy "profiles_update_own_personal"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_managers_update_all" on public.profiles;
create policy "profiles_managers_update_all"
  on public.profiles
  for update
  to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

create or replace function public.protect_profile_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = old.id and not public.is_profile_manager() then
    if row(
      new.id, new.full_name, new.username, new.role, new.area_id, new.area_name,
      new.employee_id, new.status, new.created_at
    ) is distinct from row(
      old.id, old.full_name, old.username, old.role, old.area_id, old.area_name,
      old.employee_id, old.status, old.created_at
    ) then
      raise exception 'Solo Administracion puede modificar datos laborales o de acceso.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_managed_fields on public.profiles;
create trigger protect_profile_managed_fields
  before update on public.profiles
  for each row execute procedure public.protect_profile_managed_fields();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'colaborador');
  initial_role text;
begin
  -- Privileged roles are never trusted from user-supplied signup metadata.
  -- Assign admin/gerente_general/rrhh/supervisor in Table Editor or a future server-only flow.
  initial_role := case
    when requested_role in (
      'cajero', 'mesero', 'cocinero', 'pizzero', 'barista', 'bartender',
      'repostero', 'panadero', 'colaborador'
    ) then requested_role
    else 'colaborador'
  end;

  insert into public.profiles (id, email, full_name, username, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    initial_role
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

