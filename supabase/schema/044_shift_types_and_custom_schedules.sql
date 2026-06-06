-- Dynamic HR shift types and employee-specific custom schedules.
-- Apply after 043_app_settings_branding.sql.

create table if not exists public.shift_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time,
  end_time time,
  estimated_hours numeric,
  counts_as_workday boolean not null default true,
  is_rest_day boolean not null default false,
  is_holiday boolean not null default false,
  color text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shift_types_name_key
  on public.shift_types (lower(trim(name)));

create table if not exists public.employee_custom_schedules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  shift_type_id uuid references public.shift_types(id) on delete set null,
  weekday integer check (weekday is null or weekday between 0 and 6),
  specific_date date,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

alter table public.employee_schedules
  add column if not exists shift_type_id uuid references public.shift_types(id) on delete set null;

alter table public.employee_schedules
  drop constraint if exists employee_schedules_shift_type_check;

alter table public.employee_schedules
  add constraint employee_schedules_shift_type_check
  check (nullif(trim(shift_type), '') is not null);

alter table public.employee_schedules
  drop constraint if exists employee_schedules_work_day_time_check;

alter table public.employee_schedules
  add constraint employee_schedules_work_day_time_check
  check (
    (is_work_day = false)
    or (is_work_day = true and start_time is not null and end_time is not null and nullif(trim(coalesce(area, '')), '') is not null)
  );

create index if not exists shift_types_status_idx on public.shift_types (status, name);
create index if not exists employee_custom_schedules_profile_idx
  on public.employee_custom_schedules (profile_id, status, start_date, end_date);
create index if not exists employee_schedules_shift_type_id_idx
  on public.employee_schedules (shift_type_id);

alter table public.shift_types enable row level security;
alter table public.employee_custom_schedules enable row level security;

grant select on public.shift_types, public.employee_custom_schedules to authenticated;
grant all on public.shift_types, public.employee_custom_schedules to service_role;

create or replace function public.is_shift_type_manager()
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

revoke all on function public.is_shift_type_manager() from public;
grant execute on function public.is_shift_type_manager() to authenticated;

drop policy if exists "shift_types_authorized_read" on public.shift_types;
create policy "shift_types_authorized_read" on public.shift_types
  for select to authenticated using (status = 'active' or public.is_shift_type_manager());

drop policy if exists "shift_types_authorized_insert" on public.shift_types;
create policy "shift_types_authorized_insert" on public.shift_types
  for insert to authenticated with check (public.is_shift_type_manager());

drop policy if exists "shift_types_authorized_update" on public.shift_types;
create policy "shift_types_authorized_update" on public.shift_types
  for update to authenticated using (public.is_shift_type_manager()) with check (public.is_shift_type_manager());

drop policy if exists "shift_types_authorized_delete" on public.shift_types;
create policy "shift_types_authorized_delete" on public.shift_types
  for delete to authenticated using (public.is_shift_type_manager());

drop policy if exists "employee_custom_schedules_authorized_read" on public.employee_custom_schedules;
create policy "employee_custom_schedules_authorized_read" on public.employee_custom_schedules
  for select to authenticated using (
    public.is_shift_type_manager()
    or profile_id = auth.uid()
  );

drop policy if exists "employee_custom_schedules_authorized_insert" on public.employee_custom_schedules;
create policy "employee_custom_schedules_authorized_insert" on public.employee_custom_schedules
  for insert to authenticated with check (public.is_shift_type_manager());

drop policy if exists "employee_custom_schedules_authorized_update" on public.employee_custom_schedules;
create policy "employee_custom_schedules_authorized_update" on public.employee_custom_schedules
  for update to authenticated using (public.is_shift_type_manager()) with check (public.is_shift_type_manager());

drop policy if exists "employee_custom_schedules_authorized_delete" on public.employee_custom_schedules;
create policy "employee_custom_schedules_authorized_delete" on public.employee_custom_schedules
  for delete to authenticated using (public.is_shift_type_manager());

insert into public.shift_types (
  name, start_time, end_time, estimated_hours, counts_as_workday, is_rest_day, is_holiday, color, status
)
select *
from (values
  ('Turno completo', time '12:00', time '20:00', 8::numeric, true, false, false, '#14b8a6', 'active'),
  ('Turno PM', time '16:30', time '23:00', 6.5::numeric, true, false, false, '#8b5cf6', 'active'),
  ('Medio turno AM', time '09:00', time '13:00', 4::numeric, true, false, false, '#3b82f6', 'active'),
  ('Medio turno PM', time '16:00', time '20:00', 4::numeric, true, false, false, '#f59e0b', 'active'),
  ('Descanso', null::time, null::time, 0::numeric, false, true, false, '#64748b', 'active'),
  ('Asueto', null::time, null::time, 0::numeric, false, false, true, '#ef4444', 'active'),
  ('Horario extraordinario', null::time, null::time, null::numeric, true, false, false, '#ec4899', 'active')
) as defaults(name, start_time, end_time, estimated_hours, counts_as_workday, is_rest_day, is_holiday, color, status)
where not exists (
  select 1 from public.shift_types existing
  where lower(trim(existing.name)) = lower(trim(defaults.name))
);

update public.employee_schedules s
set shift_type_id = st.id
from public.shift_types st
where s.shift_type_id is null
  and (
    (s.shift_type = 'full' and lower(st.name) = 'turno completo')
    or (s.shift_type = 'half' and lower(st.name) = 'medio turno pm')
    or (s.shift_type = 'rest' and lower(st.name) = 'descanso')
    or (s.shift_type = 'asueto' and lower(st.name) = 'asueto')
  );

update public.profiles
set area_name = replace(area_name, 'Mesetas', 'Mesas')
where area_name like '%Mesetas%';

update public.profiles
set area_name = replace(area_name, 'mesetas', 'mesas')
where area_name like '%mesetas%';

update public.areas
set name = replace(name, 'Mesetas', 'Mesas')
where name like '%Mesetas%';

update public.areas
set name = replace(name, 'mesetas', 'mesas')
where name like '%mesetas%';

update public.employee_schedules
set area = replace(area, 'Mesetas', 'Mesas')
where area like '%Mesetas%';

update public.employee_schedules
set area = replace(area, 'mesetas', 'mesas')
where area like '%mesetas%';

drop function if exists public.get_attendance_terminal_profiles();

create or replace function public.get_attendance_terminal_profiles()
returns table (
  id uuid,
  employee_code text,
  full_name text,
  avatar_url text,
  area_name text,
  pin_configured boolean,
  area_id text,
  role text,
  "position" text,
  department text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.employee_id,
    p.full_name,
    p.avatar_url,
    p.area_name,
    c.employee_id is not null,
    p.area_id,
    p.role,
    null::text as "position",
    p.area_name as department
  from public.profiles p
  left join public.attendance_credentials c on c.employee_id = p.id
  where p.status = 'active'
  order by p.full_name nulls last, p.username;
$$;

revoke all on function public.get_attendance_terminal_profiles() from public;
grant execute on function public.get_attendance_terminal_profiles() to authenticated;
grant execute on function public.get_attendance_terminal_profiles() to anon;

create or replace function public.save_shift_type(p_data jsonb)
returns public.shift_types
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.shift_types;
  shift_id uuid := nullif(p_data ->> 'id', '')::uuid;
begin
  if not public.is_shift_type_manager() then
    raise exception 'No tienes permiso para gestionar tipos de turno.';
  end if;
  if nullif(trim(p_data ->> 'name'), '') is null then
    raise exception 'El nombre del turno es obligatorio.';
  end if;

  if shift_id is null then
    insert into public.shift_types (
      name, start_time, end_time, estimated_hours, counts_as_workday, is_rest_day,
      is_holiday, color, status
    ) values (
      trim(p_data ->> 'name'),
      nullif(p_data ->> 'start_time', '')::time,
      nullif(p_data ->> 'end_time', '')::time,
      nullif(p_data ->> 'estimated_hours', '')::numeric,
      coalesce((p_data ->> 'counts_as_workday')::boolean, true),
      coalesce((p_data ->> 'is_rest_day')::boolean, false),
      coalesce((p_data ->> 'is_holiday')::boolean, false),
      nullif(trim(p_data ->> 'color'), ''),
      coalesce(nullif(p_data ->> 'status', ''), 'active')
    ) returning * into saved;
  else
    update public.shift_types set
      name = trim(p_data ->> 'name'),
      start_time = nullif(p_data ->> 'start_time', '')::time,
      end_time = nullif(p_data ->> 'end_time', '')::time,
      estimated_hours = nullif(p_data ->> 'estimated_hours', '')::numeric,
      counts_as_workday = coalesce((p_data ->> 'counts_as_workday')::boolean, true),
      is_rest_day = coalesce((p_data ->> 'is_rest_day')::boolean, false),
      is_holiday = coalesce((p_data ->> 'is_holiday')::boolean, false),
      color = nullif(trim(p_data ->> 'color'), ''),
      status = coalesce(nullif(p_data ->> 'status', ''), 'active'),
      updated_at = now()
    where id = shift_id
    returning * into saved;
    if saved.id is null then raise exception 'El tipo de turno no existe.'; end if;
  end if;

  return saved;
end;
$$;

create or replace function public.delete_shift_type(p_shift_type_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shift_type_manager() then
    raise exception 'No tienes permiso para gestionar tipos de turno.';
  end if;
  if exists (select 1 from public.employee_schedules where shift_type_id = p_shift_type_id)
    or exists (select 1 from public.employee_custom_schedules where shift_type_id = p_shift_type_id) then
    raise exception 'Este tipo de turno ya fue usado. Desactivalo en lugar de eliminarlo.';
  end if;
  delete from public.shift_types where id = p_shift_type_id;
end;
$$;

create or replace function public.save_employee_custom_schedule(p_data jsonb)
returns public.employee_custom_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.employee_custom_schedules;
  custom_id uuid := nullif(p_data ->> 'id', '')::uuid;
  target_profile_id uuid := nullif(p_data ->> 'profile_id', '')::uuid;
begin
  if not public.is_shift_type_manager() then
    raise exception 'No tienes permiso para gestionar turnos especiales.';
  end if;
  if target_profile_id is null then
    raise exception 'El colaborador es obligatorio.';
  end if;

  if custom_id is null then
    insert into public.employee_custom_schedules (
      profile_id, shift_type_id, weekday, specific_date, start_date, end_date,
      start_time, end_time, notes, status
    ) values (
      target_profile_id,
      nullif(p_data ->> 'shift_type_id', '')::uuid,
      nullif(p_data ->> 'weekday', '')::integer,
      nullif(p_data ->> 'specific_date', '')::date,
      nullif(p_data ->> 'start_date', '')::date,
      nullif(p_data ->> 'end_date', '')::date,
      nullif(p_data ->> 'start_time', '')::time,
      nullif(p_data ->> 'end_time', '')::time,
      nullif(trim(p_data ->> 'notes'), ''),
      coalesce(nullif(p_data ->> 'status', ''), 'active')
    ) returning * into saved;
  else
    update public.employee_custom_schedules set
      profile_id = target_profile_id,
      shift_type_id = nullif(p_data ->> 'shift_type_id', '')::uuid,
      weekday = nullif(p_data ->> 'weekday', '')::integer,
      specific_date = nullif(p_data ->> 'specific_date', '')::date,
      start_date = nullif(p_data ->> 'start_date', '')::date,
      end_date = nullif(p_data ->> 'end_date', '')::date,
      start_time = nullif(p_data ->> 'start_time', '')::time,
      end_time = nullif(p_data ->> 'end_time', '')::time,
      notes = nullif(trim(p_data ->> 'notes'), ''),
      status = coalesce(nullif(p_data ->> 'status', ''), 'active'),
      updated_at = now()
    where id = custom_id
    returning * into saved;
    if saved.id is null then raise exception 'El turno especial no existe.'; end if;
  end if;

  return saved;
end;
$$;

create or replace function public.delete_employee_custom_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shift_type_manager() then
    raise exception 'No tienes permiso para gestionar turnos especiales.';
  end if;
  delete from public.employee_custom_schedules where id = p_schedule_id;
end;
$$;

create or replace function public.save_employee_schedule(p_data jsonb)
returns public.employee_schedules
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.employee_schedules;
  saved public.employee_schedules;
  selected_shift public.shift_types;
  schedule_id uuid;
  v_employee_id uuid := (p_data ->> 'employee_id')::uuid;
  v_shift_type_id uuid := nullif(p_data ->> 'shift_type_id', '')::uuid;
  v_is_work_day boolean := coalesce((p_data ->> 'is_work_day')::boolean, true);
  v_shift_type text := coalesce(nullif(p_data ->> 'shift_type', ''), 'full');
  v_non_work_area text;
begin
  if not public.is_schedule_editor() then
    raise exception 'No tienes permiso para editar horarios.';
  end if;
  if v_employee_id is null then
    raise exception 'Colaborador es obligatorio.';
  end if;

  if v_shift_type_id is not null then
    select * into selected_shift from public.shift_types where id = v_shift_type_id;
    if selected_shift.id is null or selected_shift.status <> 'active' then
      raise exception 'Tipo de turno invalido.';
    end if;
    v_is_work_day := selected_shift.counts_as_workday and not selected_shift.is_rest_day and not selected_shift.is_holiday;
    v_shift_type := selected_shift.id::text;
  elsif v_shift_type in ('rest', 'asueto') then
    v_is_work_day := false;
  end if;

  v_non_work_area := case
    when selected_shift.is_holiday or v_shift_type = 'asueto' then 'Asueto'
    when selected_shift.is_rest_day or v_shift_type = 'rest' then 'Descanso'
    else coalesce(nullif(trim(p_data ->> 'area'), ''), 'Descanso')
  end;

  if v_is_work_day and (
    nullif(trim(p_data ->> 'area'), '') is null
    or nullif(p_data ->> 'start_time', '') is null
    or nullif(p_data ->> 'end_time', '') is null
  ) then
    raise exception 'Area, entrada y salida son obligatorios para dias laborales.';
  end if;

  schedule_id := nullif(p_data ->> 'id', '')::uuid;
  if schedule_id is not null then
    select * into existing from public.employee_schedules where id = schedule_id;
    if existing.id is null then raise exception 'Turno no encontrado.'; end if;
    if existing.status = 'published' and not public.is_schedule_publisher() then
      raise exception 'Solo Admin, Gerente General o RRHH pueden editar un horario publicado.';
    end if;
    update public.employee_schedules set
      employee_id = v_employee_id,
      area = case when v_is_work_day then trim(p_data ->> 'area') else v_non_work_area end,
      position = case when v_is_work_day then nullif(trim(p_data ->> 'position'), '') else null end,
      shift_date = (p_data ->> 'shift_date')::date,
      start_time = case when v_is_work_day then (p_data ->> 'start_time')::time else null end,
      end_time = case when v_is_work_day then (p_data ->> 'end_time')::time else null end,
      break_minutes = case when v_is_work_day then greatest(0, coalesce((p_data ->> 'break_minutes')::integer, 0)) else 0 end,
      notes = nullif(trim(p_data ->> 'notes'), ''),
      day_notes = nullif(trim(coalesce(p_data ->> 'day_notes', p_data ->> 'notes')), ''),
      is_work_day = v_is_work_day,
      shift_type = v_shift_type,
      shift_type_id = v_shift_type_id,
      block_order = greatest(1, coalesce((p_data ->> 'block_order')::integer, 1)),
      updated_by = auth.uid(),
      updated_at = now()
    where id = schedule_id returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, old_value, new_value)
    values (saved.id, auth.uid(), 'updated', to_jsonb(existing), to_jsonb(saved));
  else
    insert into public.employee_schedules (
      employee_id, area, position, shift_date, start_time, end_time, break_minutes, notes,
      status, created_by, updated_by, is_work_day, shift_type, shift_type_id, block_order, day_notes
    ) values (
      v_employee_id,
      case when v_is_work_day then trim(p_data ->> 'area') else v_non_work_area end,
      case when v_is_work_day then nullif(trim(p_data ->> 'position'), '') else null end,
      (p_data ->> 'shift_date')::date,
      case when v_is_work_day then (p_data ->> 'start_time')::time else null end,
      case when v_is_work_day then (p_data ->> 'end_time')::time else null end,
      case when v_is_work_day then greatest(0, coalesce((p_data ->> 'break_minutes')::integer, 0)) else 0 end,
      nullif(trim(p_data ->> 'notes'), ''),
      'draft', auth.uid(), auth.uid(), v_is_work_day, v_shift_type, v_shift_type_id,
      greatest(1, coalesce((p_data ->> 'block_order')::integer, 1)),
      nullif(trim(coalesce(p_data ->> 'day_notes', p_data ->> 'notes')), '')
    ) returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, new_value)
    values (saved.id, auth.uid(), 'created', to_jsonb(saved));
  end if;
  return saved;
end;
$$;

revoke all on function
  public.save_shift_type(jsonb),
  public.delete_shift_type(uuid),
  public.save_employee_custom_schedule(jsonb),
  public.delete_employee_custom_schedule(uuid),
  public.save_employee_schedule(jsonb)
from public;

grant execute on function
  public.save_shift_type(jsonb),
  public.delete_shift_type(uuid),
  public.save_employee_custom_schedule(jsonb),
  public.delete_employee_custom_schedule(uuid),
  public.save_employee_schedule(jsonb)
to authenticated;
