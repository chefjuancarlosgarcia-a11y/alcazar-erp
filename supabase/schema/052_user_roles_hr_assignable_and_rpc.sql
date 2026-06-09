-- Enhance user_roles catalog: HR assignable flag, deprecated flag, secure RPCs.
-- Apply after 051_pos_pizzeria_variants_and_modifiers.sql.

alter table public.user_roles
  add column if not exists is_deprecated boolean not null default false;

alter table public.user_roles
  add column if not exists hr_assignable boolean not null default false;

create index if not exists user_roles_hr_assignable_idx on public.user_roles (hr_assignable);
create index if not exists user_roles_deprecated_idx on public.user_roles (is_deprecated);

-- Mark legacy alias roles as deprecated.
update public.user_roles
set
  is_deprecated = true,
  role_name = case role_key
    when 'rrhh' then 'RRHH (Deprecated)'
    when 'cajero' then 'Cajero (Deprecated)'
    when 'cocinero' then 'Cocinero (Deprecated)'
    when 'pizzero' then 'Pizzero (Deprecated)'
    else role_name
  end
where role_key in ('rrhh', 'cajero', 'cocinero', 'pizzero');

-- Roles that RRHH may assign to collaborators.
update public.user_roles
set hr_assignable = true
where role_key in (
  'supervisor',
  'encargado_almacen',
  'caja',
  'mesero',
  'servicio',
  'cocina',
  'pizzeria',
  'barista',
  'bartender',
  'panadero',
  'repostero',
  'limpieza',
  'repartidor',
  'mantenimiento',
  'operativo',
  'colaborador'
);

-- Protected catalog keys (never created from UI, never deactivated).
create or replace function public.is_protected_role_key(p_role_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_role_key, '') in ('admin', 'gerente_general');
$$;

revoke all on function public.is_protected_role_key(text) from public;
grant execute on function public.is_protected_role_key(text) to authenticated;

create or replace function public.count_profiles_with_role(p_role_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.profiles
  where role = p_role_key
    and status <> 'inactive';
$$;

revoke all on function public.count_profiles_with_role(text) from public;
grant execute on function public.count_profiles_with_role(text) to authenticated;

create or replace function public.create_user_role(
  p_role_name text,
  p_description text default '',
  p_is_active boolean default true,
  p_hr_assignable boolean default false
)
returns public.user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  normalized_key text;
  inserted_role public.user_roles;
begin
  if not public.is_profile_manager() then
    raise exception 'Solo Administración puede crear roles personalizados.';
  end if;

  normalized_name := trim(coalesce(p_role_name, ''));
  if normalized_name = '' then
    raise exception 'El nombre del rol es obligatorio.';
  end if;

  normalized_key := public.normalize_role_name(normalized_name);
  if normalized_key = '' then
    raise exception 'No se pudo generar una clave válida para el rol.';
  end if;

  if public.is_protected_role_key(normalized_key) then
    raise exception 'No se pueden crear roles reservados como admin o gerente_general.';
  end if;

  if exists (select 1 from public.user_roles where role_key = normalized_key) then
    raise exception 'El rol con clave "%" ya existe.', normalized_key;
  end if;

  insert into public.user_roles (
    role_key,
    role_name,
    description,
    category,
    is_system,
    is_active,
    is_deprecated,
    hr_assignable,
    created_by
  )
  values (
    normalized_key,
    normalized_name,
    coalesce(trim(p_description), ''),
    'Personalizado',
    false,
    coalesce(p_is_active, true),
    false,
    coalesce(p_hr_assignable, false),
    auth.uid()
  )
  returning * into inserted_role;

  return inserted_role;
end;
$$;

revoke all on function public.create_user_role(text, text, boolean, boolean) from public;
grant execute on function public.create_user_role(text, text, boolean, boolean) to authenticated;

create or replace function public.update_user_role(
  p_role_id uuid,
  p_role_name text default null,
  p_description text default null,
  p_is_active boolean default null,
  p_hr_assignable boolean default null
)
returns public.user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_role public.user_roles;
  updated_role public.user_roles;
  profile_count integer;
begin
  if not public.is_profile_manager() then
    raise exception 'Solo Administración puede editar roles del catálogo.';
  end if;

  select * into existing_role
  from public.user_roles
  where id = p_role_id;

  if existing_role.id is null then
    raise exception 'Rol no encontrado.';
  end if;

  if public.is_protected_role_key(existing_role.role_key) then
    raise exception 'Los roles admin y gerente_general no se pueden modificar.';
  end if;

  if p_is_active is not null and p_is_active = false and existing_role.is_active = true then
    select public.count_profiles_with_role(existing_role.role_key) into profile_count;
    if profile_count > 0 then
      raise exception 'Este rol está asignado a % colaboradores. Reasigna esos colaboradores antes de desactivarlo.', profile_count;
    end if;
  end if;

  update public.user_roles
  set
    role_name = coalesce(nullif(trim(p_role_name), ''), role_name),
    description = coalesce(p_description, description),
    is_active = coalesce(p_is_active, is_active),
    hr_assignable = case
      when public.is_protected_role_key(existing_role.role_key) then hr_assignable
      else coalesce(p_hr_assignable, hr_assignable)
    end,
    updated_at = now()
  where id = p_role_id
  returning * into updated_role;

  return updated_role;
end;
$$;

revoke all on function public.update_user_role(uuid, text, text, boolean, boolean) from public;
grant execute on function public.update_user_role(uuid, text, text, boolean, boolean) to authenticated;
