-- Configurable user roles system.
-- Allows admins to create, edit, and manage user roles dynamically.
-- Apply after 032_checklist_template_approvals.sql.

-- Create user_roles table
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  role_name text not null,
  description text,
  category text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create indexes for common queries
create index if not exists user_roles_role_key_idx on public.user_roles(role_key);
create index if not exists user_roles_active_idx on public.user_roles(is_active);
create index if not exists user_roles_category_idx on public.user_roles(category);
create index if not exists user_roles_system_idx on public.user_roles(is_system);

-- Enable RLS
alter table public.user_roles enable row level security;

-- Grant permissions
grant select on public.user_roles to authenticated;
grant insert, update, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

-- RLS Policies

-- Everyone can read active roles
drop policy if exists "user_roles_read_active" on public.user_roles;
create policy "user_roles_read_active"
  on public.user_roles for select to authenticated
  using (is_active = true);

-- Admins and managers can read all roles including inactive
drop policy if exists "user_roles_read_all_for_managers" on public.user_roles;
create policy "user_roles_read_all_for_managers"
  on public.user_roles for select to authenticated
  using (
    public.is_profile_manager()
  );

-- Only admins and managers can create roles
drop policy if exists "user_roles_create" on public.user_roles;
create policy "user_roles_create"
  on public.user_roles for insert to authenticated
  with check (
    public.is_profile_manager()
  );

-- Only admins and managers can update roles
drop policy if exists "user_roles_update" on public.user_roles;
create policy "user_roles_update"
  on public.user_roles for update to authenticated
  using (
    public.is_profile_manager()
  )
  with check (
    public.is_profile_manager()
    -- Prevent modifying is_system flag
    and (is_system = (select is_system from public.user_roles where id = public.user_roles.id))
  );

-- Only admins and managers can delete roles, but not system roles
drop policy if exists "user_roles_delete" on public.user_roles;
create policy "user_roles_delete"
  on public.user_roles for delete to authenticated
  using (
    public.is_profile_manager()
    and is_system = false
  );

-- Populate with existing roles
-- These are marked as system roles to protect them
insert into public.user_roles (role_key, role_name, category, is_system, is_active)
values
  -- Management
  ('admin', 'Admin', 'Administración', true, true),
  ('gerente_general', 'Gerente General', 'Administración', true, true),
  ('gerente', 'Gerente', 'Administración', true, true),
  
  -- Staff Management
  ('recursos_humanos', 'Recursos Humanos', 'Administración', true, true),
  ('encargado_almacen', 'Encargado de Almacén', 'Operativo', true, true),
  ('supervisor', 'Supervisor', 'Operativo', true, true),
  
  -- Finance/Cash
  ('caja', 'Cajero', 'Servicio', true, true),
  
  -- Front of House (Service)
  ('mesero', 'Mesero', 'Servicio', true, true),
  ('barista', 'Barista', 'Servicio', true, true),
  ('bartender', 'Bartender', 'Servicio', true, true),
  
  -- Kitchen
  ('cocina', 'Cocinero', 'Cocina', true, true),
  ('pizzeria', 'Pizzero', 'Cocina', true, true),
  ('panadero', 'Panadero', 'Cocina', true, true),
  ('repostero', 'Repostero', 'Cocina', true, true),
  
  -- Support Services
  ('servicio', 'Servicio General', 'Operativo', true, true),
  ('cafeteria', 'Cafetería', 'Cocina', true, true),
  ('limpieza', 'Limpieza', 'Operativo', true, true),
  ('repartidor', 'Repartidor', 'Operativo', true, true),
  ('mantenimiento', 'Mantenimiento', 'Operativo', true, true),
  ('operativo', 'Operativo', 'Operativo', true, true),
  ('colaborador', 'Colaborador', 'Operativo', true, true)
on conflict (role_key) do nothing;

-- Backward compatibility aliases (marked as deprecated but kept active)
-- These will be removed in a future migration after all users are migrated
insert into public.user_roles (role_key, role_name, category, is_system, is_active)
values
  ('rrhh', 'RRHH (Deprecated)', 'Administración', true, true),
  ('cajero', 'Cajero (Deprecated)', 'Servicio', true, true),
  ('cocinero', 'Cocinero (Deprecated)', 'Cocina', true, true),
  ('pizzero', 'Pizzero (Deprecated)', 'Cocina', true, true)
on conflict (role_key) do nothing;

-- Create function to validate role exists and is active
create or replace function public.validate_role_exists(p_role text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where role_key = public.normalize_profile_role(p_role)
      and is_active = true
  );
$$;

revoke all on function public.validate_role_exists(text) from public;
grant execute on function public.validate_role_exists(text) to authenticated;

-- Create function to get role_key from role_name
create or replace function public.get_role_key_from_name(p_role_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select role_key
  from public.user_roles
  where role_name = p_role_name
    and is_active = true
  limit 1;
$$;

revoke all on function public.get_role_key_from_name(text) from public;
grant execute on function public.get_role_key_from_name(text) to authenticated;

-- Update profiles role check to validate against user_roles
-- First, we need to remove the old check constraint
alter table public.profiles
  drop constraint if exists profiles_role_check;

-- Add a new check constraint that validates against user_roles
-- Note: Supabase doesn't support CHECK with subqueries, so we use a trigger instead
-- Use a DO block to make it idempotent - only add constraint if it doesn't exist
do $$
begin
  alter table public.profiles
    add constraint profiles_role_not_empty
    check (role is not null and length(role) > 0);
exception when duplicate_object then
  null;  -- Constraint already exists, continue
end $$;

-- Create trigger to validate role exists in user_roles
create or replace function public.validate_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_role text;
  role_exists boolean;
begin
  -- Normalize the role for validation
  normalized_role := public.normalize_profile_role(new.role);
  
  -- Check if role exists and is active in user_roles
  select exists (
    select 1
    from public.user_roles
    where role_key = normalized_role and is_active = true
  ) into role_exists;
  
  if not role_exists then
    raise exception 'El rol "%" no existe o no está activo.', new.role;
  end if;
  
  -- Store the normalized role key
  new.role := normalized_role;
  
  return new;
end;
$$;

revoke all on function public.validate_profile_role() from public;
grant execute on function public.validate_profile_role() to authenticated;

-- Drop existing trigger if present to avoid conflicts
drop trigger if exists validate_profile_role_trigger on public.profiles;

-- Create trigger on profiles table
create trigger validate_profile_role_trigger
  before insert or update on public.profiles
  for each row
  execute function public.validate_profile_role();

-- Normalize existing roles in profiles table
-- Disable trigger temporarily to avoid permission errors in SQL Editor (auth.uid() context missing)
do $$
begin
  -- Temporarily disable the protection trigger
  alter table public.profiles disable trigger protect_profile_managed_fields;
  
  -- Normalize existing roles
  update public.profiles
  set role = public.normalize_profile_role(role)
  where role is not null;
  
  -- Re-enable the protection trigger
  alter table public.profiles enable trigger protect_profile_managed_fields;
  
exception when others then
  -- Ensure trigger is re-enabled even if update fails
  alter table public.profiles enable trigger protect_profile_managed_fields;
  raise;
end $$;

-- Create function to ensure user_roles is never empty
-- This prevents accidental deletion of all roles
create or replace function public.prevent_empty_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where is_active = true) then
    raise exception 'No se pueden desactivar todos los roles activos.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_empty_roles() from public;

-- Create trigger to prevent empty roles
drop trigger if exists prevent_empty_roles_trigger on public.user_roles;
create trigger prevent_empty_roles_trigger
  before update on public.user_roles
  for each row
  when (old.is_active = true and new.is_active = false)
  execute function public.prevent_empty_roles();

-- Create function to prevent system roles from being deleted
create or replace function public.prevent_system_role_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_system = true and new.is_system = false then
    raise exception 'No se pueden eliminar roles del sistema.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_system_role_deletion() from public;

-- Create trigger to prevent system role deletion
drop trigger if exists prevent_system_role_deletion_trigger on public.user_roles;
create trigger prevent_system_role_deletion_trigger
  before update on public.user_roles
  for each row
  when (old.is_system = true)
  execute function public.prevent_system_role_deletion();

-- Create helper function to normalize role names for display
create or replace function public.normalize_role_name(p_role_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role_name is null or p_role_name = '' then ''
    else lower(
      replace(
        replace(
          replace(
            translate(p_role_name, 'ÁÉÍÓÚÄËÏÖÜ', 'aeiouaeiou'),
            '-',
            '_'
          ),
          ' ',
          '_'
        ),
        '.',
        '_'
      )
    )
  end;
$$;

revoke all on function public.normalize_role_name(text) from public;
grant execute on function public.normalize_role_name(text) to authenticated;

-- Create trigger to auto-generate role_key from role_name if not provided
create or replace function public.auto_generate_role_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_key is null or new.role_key = '' then
    new.role_key := public.normalize_role_name(new.role_name);
  end if;
  
  -- Ensure role_key is in the correct format
  new.role_key := public.normalize_role_name(new.role_key);
  
  return new;
end;
$$;

revoke all on function public.auto_generate_role_key() from public;

-- Create trigger to auto-generate role_key
drop trigger if exists auto_generate_role_key_trigger on public.user_roles;
create trigger auto_generate_role_key_trigger
  before insert on public.user_roles
  for each row
  execute function public.auto_generate_role_key();

-- Update trigger for timestamp
drop trigger if exists set_user_roles_updated_at on public.user_roles;
create trigger set_user_roles_updated_at
  before update on public.user_roles
  for each row
  execute function public.set_checklist_updated_at();

-- Grant permissions on new functions
grant execute on function public.validate_role_exists(text) to authenticated;
grant execute on function public.get_role_key_from_name(text) to authenticated;
grant execute on function public.normalize_role_name(text) to authenticated;
