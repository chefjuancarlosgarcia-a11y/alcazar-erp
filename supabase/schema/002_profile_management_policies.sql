-- Profile management permissions for the authenticated application.
-- Apply after 001_profiles.sql when enabling Gestion de usuarios.

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
      and role = 'rrhh'
      and status = 'active'
  );
$$;

revoke all on function public.is_profile_hr() from public;
grant execute on function public.is_profile_hr() to authenticated;

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
    and role not in ('admin', 'gerente_general')
    and id <> auth.uid()
  )
  with check (
    public.is_profile_hr()
    and role not in ('admin', 'gerente_general')
    and id <> auth.uid()
  );

create or replace function public.protect_profile_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role = 'admin' then
    new.updated_at := now();
    return new;
  end if;

  if actor_role = 'gerente_general' then
    if old.role = 'admin' or new.role = 'admin' then
      raise exception 'Gerente General no puede modificar usuarios Administrador.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if public.is_profile_hr() and auth.uid() <> old.id then
    if row(new.role, new.status, new.created_at, new.id) is distinct from row(old.role, old.status, old.created_at, old.id) then
      raise exception 'Recursos Humanos no puede modificar rol o estado del usuario.';
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
