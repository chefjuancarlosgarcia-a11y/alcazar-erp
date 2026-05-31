-- Weekly employee scheduling, publication, attendance comparison and payroll summaries.
-- Apply after 019_attendance_terminal.sql.

alter table public.profiles
  add column if not exists hourly_rate numeric;

alter table public.profiles
  drop constraint if exists profiles_hourly_rate_check;

alter table public.profiles
  add constraint profiles_hourly_rate_check
  check (hourly_rate is null or hourly_rate >= 0);

create or replace function public.protect_profile_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();

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
      new.employee_id, new.status, new.hourly_rate, new.authorized_attendance_device, new.created_at
    ) is distinct from row(
      old.id, old.full_name, old.username, old.role, old.area_id, old.area_name,
      old.employee_id, old.status, old.hourly_rate, old.authorized_attendance_device, old.created_at
    ) then
      raise exception 'Solo Administracion puede modificar datos laborales o de acceso.';
    end if;
    new.updated_at := now();
    return new;
  end if;
  raise exception 'No tienes permiso para modificar este perfil.';
end;
$$;

create table if not exists public.employee_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  area text not null,
  position text,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  area text,
  is_active boolean not null default true
);

create table if not exists public.schedule_change_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.employee_schedules(id) on delete set null,
  changed_by uuid not null references public.profiles(id),
  change_type text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_summaries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  scheduled_hours numeric not null default 0,
  actual_hours numeric not null default 0,
  regular_hours numeric not null default 0,
  overtime_hours numeric not null default 0,
  late_minutes integer not null default 0,
  absences integer not null default 0,
  estimated_pay numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'approved')),
  reviewed_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, week_start)
);

create index if not exists employee_schedules_week_idx on public.employee_schedules (shift_date, employee_id);
create index if not exists schedule_change_logs_schedule_idx on public.schedule_change_logs (schedule_id, created_at desc);
create index if not exists payroll_summaries_week_idx on public.payroll_summaries (week_start, employee_id);

insert into public.shift_templates (name, start_time, end_time, break_minutes, area)
values
  ('Apertura', '12:00', '20:00', 30, null),
  ('Cierre', '16:30', '23:00', 30, null),
  ('Domingo', '12:00', '18:00', 30, null),
  ('Administrativo', '09:00', '17:00', 60, 'Administracion')
on conflict (name) do nothing;

alter table public.employee_schedules enable row level security;
alter table public.shift_templates enable row level security;
alter table public.schedule_change_logs enable row level security;
alter table public.payroll_summaries enable row level security;

grant select on public.employee_schedules, public.shift_templates, public.schedule_change_logs, public.payroll_summaries to authenticated;
grant all on public.employee_schedules, public.shift_templates, public.schedule_change_logs, public.payroll_summaries to service_role;

create or replace function public.is_schedule_editor()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'gerente_general', 'rrhh', 'gerente')
      and status = 'active'
  );
$$;

create or replace function public.is_schedule_publisher()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'gerente_general', 'rrhh')
      and status = 'active'
  );
$$;

revoke all on function public.is_schedule_editor() from public;
revoke all on function public.is_schedule_publisher() from public;
grant execute on function public.is_schedule_editor(), public.is_schedule_publisher() to authenticated;

drop policy if exists "employee_schedules_authorized_read" on public.employee_schedules;
create policy "employee_schedules_authorized_read" on public.employee_schedules
  for select to authenticated using (
    public.is_schedule_editor()
    or (employee_id = auth.uid() and status = 'published')
  );

drop policy if exists "shift_templates_authenticated_read" on public.shift_templates;
create policy "shift_templates_authenticated_read" on public.shift_templates
  for select to authenticated using (is_active = true);

drop policy if exists "schedule_change_logs_managers_read" on public.schedule_change_logs;
create policy "schedule_change_logs_managers_read" on public.schedule_change_logs
  for select to authenticated using (public.is_schedule_publisher());

drop policy if exists "payroll_summaries_managers_read" on public.payroll_summaries;
create policy "payroll_summaries_managers_read" on public.payroll_summaries
  for select to authenticated using (public.is_schedule_publisher());

create or replace function public.save_employee_schedule(p_data jsonb)
returns public.employee_schedules
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.employee_schedules;
  saved public.employee_schedules;
  schedule_id uuid;
  v_employee_id uuid := (p_data ->> 'employee_id')::uuid;
begin
  if not public.is_schedule_editor() then
    raise exception 'No tienes permiso para editar horarios.';
  end if;
  if v_employee_id is null or nullif(trim(p_data ->> 'area'), '') is null then
    raise exception 'Colaborador y area son obligatorios.';
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
      area = trim(p_data ->> 'area'),
      position = nullif(trim(p_data ->> 'position'), ''),
      shift_date = (p_data ->> 'shift_date')::date,
      start_time = (p_data ->> 'start_time')::time,
      end_time = (p_data ->> 'end_time')::time,
      break_minutes = greatest(0, coalesce((p_data ->> 'break_minutes')::integer, 0)),
      notes = nullif(trim(p_data ->> 'notes'), ''),
      updated_by = auth.uid(),
      updated_at = now()
    where id = schedule_id returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, old_value, new_value)
    values (saved.id, auth.uid(), 'updated', to_jsonb(existing), to_jsonb(saved));
    if existing.status = 'published' then
      insert into public.notifications (user_id, type, title, message, entity_type, entity_id)
      values (saved.employee_id, 'schedule_changed', 'Cambio en tu horario', 'Se modifico un turno de tu horario publicado.', 'employee_schedule', saved.id::text);
      if existing.employee_id <> saved.employee_id then
        insert into public.notifications (user_id, type, title, message, entity_type, entity_id)
        values (existing.employee_id, 'schedule_changed', 'Cambio en tu horario', 'Un turno previamente asignado fue retirado de tu horario publicado.', 'employee_schedule', saved.id::text);
      end if;
    end if;
  else
    insert into public.employee_schedules (
      employee_id, area, position, shift_date, start_time, end_time, break_minutes, notes,
      status, created_by, updated_by
    ) values (
      v_employee_id, trim(p_data ->> 'area'), nullif(trim(p_data ->> 'position'), ''),
      (p_data ->> 'shift_date')::date, (p_data ->> 'start_time')::time, (p_data ->> 'end_time')::time,
      greatest(0, coalesce((p_data ->> 'break_minutes')::integer, 0)), nullif(trim(p_data ->> 'notes'), ''),
      'draft', auth.uid(), auth.uid()
    ) returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, new_value)
    values (saved.id, auth.uid(), 'created', to_jsonb(saved));
  end if;
  return saved;
end;
$$;

create or replace function public.delete_employee_schedule(p_schedule_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.employee_schedules;
begin
  select * into existing from public.employee_schedules where id = p_schedule_id;
  if existing.id is null then return; end if;
  if not public.is_schedule_editor()
    or (existing.status = 'published' and not public.is_schedule_publisher()) then
    raise exception 'No tienes permiso para eliminar este turno.';
  end if;
  insert into public.schedule_change_logs (schedule_id, changed_by, change_type, old_value)
  values (existing.id, auth.uid(), 'deleted', to_jsonb(existing));
  if existing.status = 'published' then
    insert into public.notifications (user_id, type, title, message, entity_type, entity_id)
    values (existing.employee_id, 'schedule_changed', 'Cambio en tu horario', 'Se elimino un turno de tu horario publicado.', 'employee_schedule', existing.id::text);
  end if;
  delete from public.employee_schedules where id = existing.id;
end;
$$;

create or replace function public.publish_schedule_week(p_week_start date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  affected integer;
  employee_record record;
begin
  if not public.is_schedule_publisher() then
    raise exception 'No tienes permiso para publicar horarios.';
  end if;
  insert into public.schedule_change_logs (schedule_id, changed_by, change_type, old_value, new_value)
  select id, auth.uid(), 'published', to_jsonb(s), to_jsonb(s) || jsonb_build_object('status', 'published', 'published_at', now())
  from public.employee_schedules s
  where shift_date between p_week_start and p_week_start + 6
    and status = 'draft';
  update public.employee_schedules set
    status = 'published', published_at = now(), updated_by = auth.uid(), updated_at = now()
  where shift_date between p_week_start and p_week_start + 6
    and status = 'draft';
  get diagnostics affected = row_count;
  for employee_record in
    select distinct employee_id from public.employee_schedules
    where shift_date between p_week_start and p_week_start + 6 and status = 'published'
  loop
    insert into public.notifications (user_id, type, title, message, entity_type, entity_id)
    values (employee_record.employee_id, 'schedule_published', 'Horario semanal publicado', 'Tu horario semanal ha sido publicado.', 'schedule_week', p_week_start::text);
  end loop;
  return affected;
end;
$$;

create or replace function public.get_schedule_attendance_details(p_week_start date)
returns table (
  schedule_id uuid, employee_id uuid, employee_name text, area text, shift_date date,
  scheduled_start time, actual_start timestamptz, scheduled_end time, actual_end timestamptz,
  late_minutes integer, early_departure_minutes integer, absence boolean, actual_hours numeric
)
language sql stable security definer set search_path = ''
as $$
  select
    s.id, s.employee_id, coalesce(p.full_name, p.username, 'Colaborador'), s.area, s.shift_date,
    s.start_time, entrance.marked_at, s.end_time, exit_mark.marked_at,
    greatest(0, coalesce(extract(epoch from (
      entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
    )) / 60, 0))::integer,
    greatest(0, coalesce(extract(epoch from (
      (s.shift_date + s.end_time + case when s.end_time < s.start_time then interval '1 day' else interval '0 day' end)
      - (exit_mark.marked_at at time zone 'America/Guatemala')
    )) / 60, 0))::integer,
    (s.shift_date < (now() at time zone 'America/Guatemala')::date and entrance.marked_at is null),
    greatest(0, coalesce(extract(epoch from (exit_mark.marked_at - entrance.marked_at)) / 3600, 0))::numeric(10,2)
  from public.employee_schedules s
  join public.profiles p on p.id = s.employee_id
  left join lateral (
    select m.marked_at from public.attendance_marks m
    where m.employee_id = s.employee_id and m.mark_type = 'entrada'
      and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
    order by m.marked_at limit 1
  ) entrance on true
  left join lateral (
    select m.marked_at from public.attendance_marks m
    where m.employee_id = s.employee_id and m.mark_type = 'salida'
      and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      and m.marked_at > entrance.marked_at
    order by m.marked_at desc limit 1
  ) exit_mark on true
  where s.shift_date between p_week_start and p_week_start + 6
    and s.status = 'published'
    and public.is_schedule_publisher()
  order by s.shift_date, p.full_name;
$$;

create or replace function public.get_schedule_attendance_summary(p_week_start date)
returns table (
  employee_id uuid, employee_name text, area text, scheduled_hours numeric, actual_hours numeric,
  regular_hours numeric, overtime_hours numeric, late_minutes integer, absences integer,
  estimated_pay numeric, payroll_status text
)
language sql stable security definer set search_path = ''
as $$
  with scheduled as (
    select s.employee_id, max(s.area) area,
      sum(greatest(0, extract(epoch from (
        (s.shift_date + s.end_time + case when s.end_time < s.start_time then interval '1 day' else interval '0 day' end)
        - (s.shift_date + s.start_time)
      )) / 3600 - s.break_minutes / 60.0))::numeric(10,2) scheduled_hours,
      sum(case when s.shift_date < (now() at time zone 'America/Guatemala')::date and entrance.marked_at is null then 1 else 0 end)::integer absences,
      sum(greatest(0, coalesce(extract(epoch from (
        (entrance.marked_at at time zone 'America/Guatemala') - (s.shift_date + s.start_time)
      )) / 60, 0)))::integer late_minutes,
      sum(greatest(0, coalesce(extract(epoch from (exit_mark.marked_at - entrance.marked_at)) / 3600, 0)))::numeric(10,2) actual_hours
    from public.employee_schedules s
    left join lateral (
      select m.marked_at from public.attendance_marks m
      where m.employee_id = s.employee_id and m.mark_type = 'entrada'
        and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      order by m.marked_at limit 1
    ) entrance on true
    left join lateral (
      select m.marked_at from public.attendance_marks m
      where m.employee_id = s.employee_id and m.mark_type = 'salida'
        and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
        and m.marked_at > entrance.marked_at
      order by m.marked_at desc limit 1
    ) exit_mark on true
    where s.shift_date between p_week_start and p_week_start + 6 and s.status = 'published'
    group by s.employee_id
  )
  select p.id, coalesce(p.full_name, p.username, 'Colaborador'), s.area, s.scheduled_hours, s.actual_hours,
    least(s.actual_hours, s.scheduled_hours)::numeric(10,2),
    greatest(0, greatest(s.actual_hours - s.scheduled_hours, s.actual_hours - 48))::numeric(10,2),
    s.late_minutes, s.absences,
    (s.actual_hours * coalesce(p.hourly_rate, 0))::numeric(12,2),
    coalesce(ps.status, 'pending')
  from scheduled s join public.profiles p on p.id = s.employee_id
  left join public.payroll_summaries ps on ps.employee_id = s.employee_id and ps.week_start = p_week_start
  where public.is_schedule_publisher();
$$;

create or replace function public.review_payroll_summary(p_employee_id uuid, p_week_start date, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  row_data record;
begin
  if not public.is_schedule_publisher() then raise exception 'No tienes permiso para revisar planilla.'; end if;
  if p_status not in ('pending', 'reviewed', 'approved') then raise exception 'Estado invalido.'; end if;
  select * into row_data from public.get_schedule_attendance_summary(p_week_start) where employee_id = p_employee_id;
  if row_data.employee_id is null then raise exception 'No existe resumen para este colaborador.'; end if;
  insert into public.payroll_summaries (
    employee_id, week_start, week_end, scheduled_hours, actual_hours, regular_hours,
    overtime_hours, late_minutes, absences, estimated_pay, status, reviewed_by, approved_by
  ) values (
    p_employee_id, p_week_start, p_week_start + 6, row_data.scheduled_hours, row_data.actual_hours,
    row_data.regular_hours, row_data.overtime_hours, row_data.late_minutes, row_data.absences,
    row_data.estimated_pay, p_status,
    case when p_status in ('reviewed', 'approved') then auth.uid() else null end,
    case when p_status = 'approved' then auth.uid() else null end
  )
  on conflict (employee_id, week_start) do update set
    scheduled_hours = excluded.scheduled_hours, actual_hours = excluded.actual_hours,
    regular_hours = excluded.regular_hours, overtime_hours = excluded.overtime_hours,
    late_minutes = excluded.late_minutes, absences = excluded.absences,
    estimated_pay = excluded.estimated_pay, status = excluded.status,
    reviewed_by = excluded.reviewed_by, approved_by = excluded.approved_by, updated_at = now();
end;
$$;

revoke all on function public.save_employee_schedule(jsonb), public.delete_employee_schedule(uuid), public.publish_schedule_week(date), public.get_schedule_attendance_details(date), public.get_schedule_attendance_summary(date), public.review_payroll_summary(uuid,date,text) from public;
grant execute on function public.save_employee_schedule(jsonb), public.delete_employee_schedule(uuid), public.publish_schedule_week(date), public.get_schedule_attendance_details(date), public.get_schedule_attendance_summary(date), public.review_payroll_summary(uuid,date,text) to authenticated;
