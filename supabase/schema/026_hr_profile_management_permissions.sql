-- Align Gestion de Usuarios permissions for Recursos Humanos.
-- Apply after 025_requisition_requested_by_profile.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin', 'gerente_general', 'gerente', 'encargado_almacen', 'rrhh', 'recursos_humanos',
    'supervisor', 'cajero', 'caja', 'mesero', 'cocinero', 'cocina', 'servicio',
    'pizzero', 'pizzeria', 'barista', 'bartender', 'repostero', 'panadero',
    'cafeteria', 'limpieza', 'repartidor', 'mantenimiento', 'operativo',
    'colaborador'
  ));

create or replace function public.normalize_profile_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('rrhh', 'rr.hh.', 'recursos humanos', 'recursos_humanos') then 'recursos_humanos'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('gerente general', 'gerente_general') then 'gerente_general'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('encargado almacen', 'encargado de almacen', 'encargado_almacen') then 'encargado_almacen'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('cajero', 'caja') then 'caja'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('cocinero', 'cocina') then 'cocina'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('pizzero', 'pizzeria') then 'pizzeria'
    else replace(translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou'), ' ', '_')
  end;
$$;

revoke all on function public.normalize_profile_role(text) from public;
grant execute on function public.normalize_profile_role(text) to authenticated;

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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
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

revoke all on function public.is_profile_manager(), public.is_profile_hr() from public;
grant execute on function public.is_profile_manager(), public.is_profile_hr() to authenticated;

drop policy if exists "profiles_hr_read_all" on public.profiles;
create policy "profiles_hr_read_all"
  on public.profiles
  for select
  to authenticated
  using (public.is_profile_hr());

drop policy if exists "profiles_hr_update_basic_non_privileged" on public.profiles;
create policy "profiles_hr_update_basic_non_privileged"
  on public.profiles
  for update
  to authenticated
  using (
    public.is_profile_hr()
    and public.normalize_profile_role(role) not in ('admin', 'gerente_general')
  )
  with check (
    public.is_profile_hr()
    and public.normalize_profile_role(role) not in ('admin', 'gerente_general')
  );

create or replace function public.protect_profile_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  old_role text := public.normalize_profile_role(old.role);
  new_role text := public.normalize_profile_role(new.role);
begin
  select public.normalize_profile_role(role) into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role = 'admin' then
    new.updated_at := now();
    return new;
  end if;

  if actor_role = 'gerente_general' then
    if old_role = 'admin' or new_role = 'admin' then
      raise exception 'No tienes permisos para editar este usuario.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if actor_role = 'recursos_humanos' then
    if old_role in ('admin', 'gerente_general') then
      raise exception 'No tienes permisos para editar este usuario.';
    end if;
    if new_role in ('admin', 'gerente_general') then
      raise exception 'No tienes permisos para asignar este rol.';
    end if;
    if row(new.id, new.created_at) is distinct from row(old.id, old.created_at) then
      raise exception 'No tienes permisos para editar este usuario.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if auth.uid() = old.id then
    if row(
      new.id, new.full_name, new.username, new.role, new.area_id, new.area_name,
      new.employee_id, new.status, new.created_at
    ) is distinct from row(
      old.id, old.full_name, old.username, old.role, old.area_id, old.area_name,
      old.employee_id, old.status, old.created_at
    ) then
      raise exception 'Solo Administracion puede modificar datos laborales o de acceso.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'No tienes permiso para modificar este perfil.';
end;
$$;

drop trigger if exists protect_profile_managed_fields on public.profiles;
create trigger protect_profile_managed_fields
  before update on public.profiles
  for each row execute procedure public.protect_profile_managed_fields();

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

revoke all on function public.is_attendance_manager(), public.can_manage_attendance_for_profile(uuid) from public;
grant execute on function public.is_attendance_manager(), public.can_manage_attendance_for_profile(uuid) to authenticated;
