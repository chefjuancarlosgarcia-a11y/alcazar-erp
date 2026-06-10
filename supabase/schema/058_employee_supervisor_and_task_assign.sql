-- Supervisor assignment for HR and task delegation scope.
-- Apply after 057_checklist_v2_execution_flow.sql.

alter table public.profiles
  add column if not exists supervisor_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_supervisor_profile_id_idx
  on public.profiles (supervisor_profile_id)
  where supervisor_profile_id is not null;

create or replace function public.is_task_assigner()
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
      and status = 'active'
      and public.normalize_profile_role(role) in (
        'admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos'
      )
  );
$$;

create or replace function public.can_read_profile_for_tasks(p_profile public.profiles)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.normalize_profile_role(public.current_profile_role())
    when 'admin' then true
    when 'gerente_general' then true
    when 'gerente' then true
    when 'recursos_humanos' then true
    when 'supervisor' then p_profile.supervisor_profile_id = auth.uid() or p_profile.id = auth.uid()
    else false
  end;
$$;

drop policy if exists "profiles_task_assigners_read" on public.profiles;
create policy "profiles_task_assigners_read"
  on public.profiles
  for select
  to authenticated
  using (public.can_read_profile_for_tasks(profiles));

create or replace function public.get_task_assignable_profiles()
returns table (
  id uuid,
  full_name text,
  username text,
  role text,
  area_id text,
  area_name text,
  status text,
  supervisor_profile_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text := public.normalize_profile_role(public.current_profile_role());
begin
  if not public.is_task_assigner() then
    raise exception 'No tienes permiso para consultar colaboradores asignables.';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.username,
    p.role,
    p.area_id,
    p.area_name,
    p.status,
    p.supervisor_profile_id
  from public.profiles p
  where p.status <> 'inactive'
    and (
      actor_role in ('admin', 'gerente_general', 'gerente', 'recursos_humanos')
      or (actor_role = 'supervisor' and p.supervisor_profile_id = auth.uid())
    )
  order by coalesce(p.full_name, p.username);
end;
$$;

create or replace function public.get_profiles_task_unavailability(
  p_profile_ids uuid[],
  p_date date
)
returns table (
  profile_id uuid,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_id uuid;
  profile_row public.profiles;
  weekday_int integer;
  schedule_row record;
  custom_row record;
  unavailability text;
begin
  if not public.is_task_assigner() then
    raise exception 'No tienes permiso para consultar disponibilidad.';
  end if;

  weekday_int := extract(dow from coalesce(p_date, current_date))::integer;

  foreach profile_id in array coalesce(p_profile_ids, array[]::uuid[])
  loop
    unavailability := null;
    select * into profile_row from public.profiles where id = profile_id;

    if profile_row.id is null then
      profile_id := profile_id;
      reason := 'Perfil no encontrado';
      return next;
      continue;
    end if;

    if profile_row.status = 'suspended' then
      profile_id := profile_row.id;
      reason := 'Suspendido';
      return next;
      continue;
    end if;

    for schedule_row in
      select
        es.is_work_day,
        es.shift_type,
        coalesce(st.is_rest_day, false) as is_rest_day,
        coalesce(st.is_holiday, false) as is_holiday,
        st.name as shift_type_name
      from public.employee_schedules es
      left join public.shift_types st on st.id = es.shift_type_id
      where es.employee_id = profile_row.id
        and es.shift_date = coalesce(p_date, current_date)
        and es.status = 'published'
    loop
      if not schedule_row.is_work_day
        or lower(coalesce(schedule_row.shift_type, '')) = 'rest'
        or schedule_row.is_rest_day then
        unavailability := 'Dia de descanso';
        exit;
      end if;
      if schedule_row.is_holiday
        or lower(coalesce(schedule_row.shift_type_name, '')) like '%vacac%' then
        unavailability := 'Vacaciones';
        exit;
      end if;
    end loop;

    if unavailability is null then
      for custom_row in
        select
          coalesce(st.is_rest_day, false) as is_rest_day,
          coalesce(st.is_holiday, false) as is_holiday,
          st.name as shift_type_name
        from public.employee_custom_schedules ecs
        left join public.shift_types st on st.id = ecs.shift_type_id
        where ecs.profile_id = profile_row.id
          and ecs.status = 'active'
          and (
            ecs.specific_date = coalesce(p_date, current_date)
            or (
              ecs.weekday = weekday_int
              and ecs.specific_date is null
              and (ecs.start_date is null or ecs.start_date <= coalesce(p_date, current_date))
              and (ecs.end_date is null or ecs.end_date >= coalesce(p_date, current_date))
            )
            or (
              ecs.start_date is not null
              and ecs.end_date is not null
              and coalesce(p_date, current_date) between ecs.start_date and ecs.end_date
            )
          )
      loop
        if custom_row.is_rest_day then
          unavailability := 'Dia de descanso';
          exit;
        end if;
        if custom_row.is_holiday
          or lower(coalesce(custom_row.shift_type_name, '')) like '%vacac%' then
          unavailability := 'Vacaciones';
          exit;
        end if;
      end loop;
    end if;

    profile_id := profile_row.id;
    reason := unavailability;
    return next;
  end loop;
end;
$$;

revoke all on function
  public.is_task_assigner(),
  public.can_read_profile_for_tasks(public.profiles),
  public.get_task_assignable_profiles(),
  public.get_profiles_task_unavailability(uuid[], date)
from public;

grant execute on function
  public.is_task_assigner(),
  public.can_read_profile_for_tasks(public.profiles),
  public.get_task_assignable_profiles(),
  public.get_profiles_task_unavailability(uuid[], date)
to authenticated;
