-- Fix HR schedule permissions after dynamic roles migration.
-- Apply after 033_user_roles_catalog.sql and existing schedule migrations.

create or replace function public.normalize_profile_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select replace(
      translate(
        lower(trim(coalesce(p_role, ''))),
        'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜ',
        'aeiouAEIOUaeiouAEIOU'
      ),
      ' ',
      '_'
    ) as role_key
  )
  select case
    when role_key in ('rrhh', 'rr.hh.', 'rr._hh.', 'recursos_humanos') then 'recursos_humanos'
    when role_key in ('gerente_general') then 'gerente_general'
    when role_key in ('encargado_almacen', 'encargado_de_almacen') then 'encargado_almacen'
    when role_key in ('cajero', 'caja') then 'caja'
    when role_key in ('cocinero', 'cocina') then 'cocina'
    when role_key in ('pizzero', 'pizzeria') then 'pizzeria'
    else role_key
  end
  from normalized;
$$;

revoke all on function public.normalize_profile_role(text) from public;
grant execute on function public.normalize_profile_role(text) to authenticated;

insert into public.user_roles (role_key, role_name, category, is_system, is_active)
values
  ('recursos_humanos', 'Recursos Humanos', 'Administración', true, true),
  ('rrhh', 'RRHH (Deprecated)', 'Administración', true, true)
on conflict (role_key) do update
set is_active = true,
    updated_at = now();

update public.profiles
set role = public.normalize_profile_role(role)
where public.normalize_profile_role(role) in ('recursos_humanos', 'rrhh')
  and role is distinct from public.normalize_profile_role(role);

create or replace function public.is_schedule_editor()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'recursos_humanos', 'rrhh', 'gerente')
      and status = 'active'
  );
$$;

create or replace function public.is_schedule_publisher()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'recursos_humanos', 'rrhh')
      and status = 'active'
  );
$$;

create or replace function public.is_profile_hr()
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
      and public.normalize_profile_role(role) = 'recursos_humanos'
      and status = 'active'
  );
$$;

create or replace function public.is_attendance_manager()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'recursos_humanos')
      and status = 'active'
  );
$$;

create or replace function public.can_manage_attendance_for_profile(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles actor
    join public.profiles target on target.id = p_employee_id
    where actor.id = auth.uid()
      and actor.status = 'active'
      and (
        public.normalize_profile_role(actor.role) = 'admin'
        or (public.normalize_profile_role(actor.role) = 'gerente_general' and public.normalize_profile_role(target.role) <> 'admin')
        or (
          public.normalize_profile_role(actor.role) = 'recursos_humanos'
          and public.normalize_profile_role(target.role) not in ('admin', 'gerente_general')
        )
      )
  );
$$;

revoke all on function
  public.is_schedule_editor(),
  public.is_schedule_publisher(),
  public.is_profile_hr(),
  public.is_attendance_manager(),
  public.can_manage_attendance_for_profile(uuid)
from public;

grant execute on function
  public.is_schedule_editor(),
  public.is_schedule_publisher(),
  public.is_profile_hr(),
  public.is_attendance_manager(),
  public.can_manage_attendance_for_profile(uuid)
to authenticated;
