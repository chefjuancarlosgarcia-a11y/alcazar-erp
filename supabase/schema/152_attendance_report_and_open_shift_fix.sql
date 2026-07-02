-- Fix attendance report hour matching (labor_date) and HR tools for open shifts.
-- Apply after 151_requisition_delete_closed.sql (requires 140_attendance_register_always_classify.sql).

-- ---------------------------------------------------------------------------
-- Backfill labor_date on legacy marks
-- ---------------------------------------------------------------------------
update public.attendance_marks m
set labor_date = (m.marked_at at time zone 'America/Guatemala')::date
where m.labor_date is null;

-- ---------------------------------------------------------------------------
-- get_attendance_marking_state: clearer open-shift messages + context fields
-- ---------------------------------------------------------------------------
create or replace function public.get_attendance_marking_state(
  p_employee_id uuid,
  p_mark_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mark_type text := coalesce(nullif(trim(p_mark_type), ''), 'entrada');
  v_ctx jsonb;
  v_schedule jsonb;
  v_class jsonb;
  v_labor_date date;
  v_calendar_date date;
  v_today_class jsonb;
  v_open_entry_at timestamptz;
  v_open_entry_label text;
begin
  if lower(v_mark_type) = 'salida' then v_mark_type := 'salida_final'; end if;
  if lower(v_mark_type) = 'bano_inicio' then v_mark_type := 'salida_comida'; end if;
  if lower(v_mark_type) = 'bano_regreso' then v_mark_type := 'regreso_comida'; end if;

  v_ctx := public.resolve_attendance_context(p_employee_id, v_mark_type, now());
  v_labor_date := (v_ctx ->> 'labor_date')::date;
  v_calendar_date := coalesce((v_ctx ->> 'calendar_date')::date, (now() at time zone 'America/Guatemala')::date);
  v_schedule := public.can_employee_mark_attendance(p_employee_id, v_labor_date);
  v_class := public.classify_attendance_mark(p_employee_id, v_labor_date, v_mark_type, now());
  v_open_entry_at := nullif(v_ctx ->> 'open_entry_marked_at', '')::timestamptz;

  if v_open_entry_at is not null then
    v_open_entry_label := to_char(v_open_entry_at at time zone 'America/Guatemala', 'DD/MM/YYYY HH24:MI');
  end if;

  if coalesce((v_ctx ->> 'has_open_entry')::boolean, false) then
    if v_mark_type = 'entrada' then
      v_today_class := public.classify_attendance_mark(p_employee_id, v_calendar_date, 'entrada', now());

      return jsonb_build_object(
        'allowed', false,
        'allowed_for_entrada', false,
        'allowed_for_completion', true,
        'reason', case
          when coalesce((v_ctx ->> 'overnight_shift')::boolean, false)
            and v_today_class ->> 'reason_code' = 'authorized_overtime' then
            format(
              'Turno abierto desde el %s. Registra salida final de ese turno antes de marcar entrada de tiempo extraordinario autorizado hoy (%s).',
              coalesce(v_open_entry_label, 'fecha anterior'),
              to_char(v_calendar_date, 'DD/MM/YYYY')
            )
          when coalesce((v_ctx ->> 'overnight_shift')::boolean, false) then
            format(
              'Turno abierto desde el %s (cruza medianoche). Registra salida final de ese turno antes de una nueva entrada.',
              coalesce(v_open_entry_label, 'fecha anterior')
            )
          when v_today_class ->> 'reason_code' = 'authorized_overtime'
            and v_labor_date = v_calendar_date then
            format(
              'Ya existe una entrada activa hoy (%s). Registra salida final antes de otra entrada extraordinaria.',
              coalesce(v_open_entry_label, 'hoy')
            )
          else
            format(
              'Ya existe una entrada activa desde el %s. Registra salida final antes de marcar una nueva entrada.',
              coalesce(v_open_entry_label, 'turno actual')
            )
        end,
        'reason_code', 'open_entry',
        'classification', v_class -> 'classification',
        'approval_status', v_class -> 'approval_status',
        'system_reason', v_class -> 'system_reason',
        'schedule_exception_id', v_class -> 'schedule_exception_id',
        'labor_date', v_labor_date,
        'calendar_date', v_calendar_date,
        'has_open_entry', true,
        'has_open_meal', coalesce((v_ctx ->> 'has_open_meal')::boolean, false),
        'overnight_shift', coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
        'open_entry_marked_at', v_open_entry_at,
        'open_entry_labor_date', v_labor_date,
        'today_authorized_overtime', v_today_class ->> 'reason_code' = 'authorized_overtime',
        'schedule_id', v_schedule -> 'schedule_id',
        'schedule_status', v_schedule -> 'schedule_status',
        'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, true)
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'allowed_for_entrada', false,
      'allowed_for_completion', true,
      'reason', case
        when coalesce((v_ctx ->> 'overnight_shift')::boolean, false) then
          format('Completando turno abierto del %s.', coalesce(v_open_entry_label, 'fecha anterior'))
        else coalesce(v_schedule ->> 'reason', 'Completa el turno abierto con comida o salida final.')
      end,
      'reason_code', 'open_shift',
      'classification', v_class -> 'classification',
      'approval_status', v_class -> 'approval_status',
      'system_reason', v_class -> 'system_reason',
      'schedule_exception_id', v_class -> 'schedule_exception_id',
      'labor_date', v_labor_date,
      'calendar_date', v_calendar_date,
      'has_open_entry', true,
      'has_open_meal', coalesce((v_ctx ->> 'has_open_meal')::boolean, false),
      'overnight_shift', coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
      'open_entry_marked_at', v_open_entry_at,
      'open_entry_labor_date', v_labor_date,
      'today_authorized_overtime', false,
      'schedule_id', v_schedule -> 'schedule_id',
      'schedule_status', v_schedule -> 'schedule_status',
      'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, true)
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'allowed_for_entrada', true,
    'allowed_for_completion', false,
    'reason', v_schedule -> 'reason',
    'reason_code', v_schedule -> 'reason_code',
    'classification', v_class -> 'classification',
    'approval_status', v_class -> 'approval_status',
    'system_reason', v_class -> 'system_reason',
    'schedule_exception_id', v_class -> 'schedule_exception_id',
    'labor_date', v_labor_date,
    'calendar_date', v_calendar_date,
    'has_open_entry', false,
    'has_open_meal', false,
    'overnight_shift', coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
    'open_entry_marked_at', null,
    'open_entry_labor_date', null,
    'today_authorized_overtime', v_class ->> 'reason_code' = 'authorized_overtime',
    'schedule_id', v_schedule -> 'schedule_id',
    'schedule_status', v_schedule -> 'schedule_status',
    'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, false)
  );
end;
$$;

revoke all on function public.get_attendance_marking_state(uuid, text) from public;
grant execute on function public.get_attendance_marking_state(uuid, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- get_open_attendance_shifts: list employees with unclosed entrada
-- ---------------------------------------------------------------------------
create or replace function public.get_open_attendance_shifts()
returns table (
  employee_id uuid,
  employee_name text,
  area text,
  entrada_id uuid,
  entrada_at timestamptz,
  labor_date date,
  calendar_date date,
  overnight_shift boolean,
  has_open_meal boolean,
  meal_started_at timestamptz,
  classification text,
  approval_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with open_entries as (
    select
      e.id as entrada_id,
      e.employee_id,
      e.employee_name,
      e.marked_at as entrada_at,
      coalesce(e.labor_date, (e.marked_at at time zone 'America/Guatemala')::date) as labor_date,
      e.classification,
      e.approval_status
    from public.attendance_marks e
    where e.mark_type = 'entrada'
      and not exists (
        select 1
        from public.attendance_marks out_mark
        where out_mark.employee_id = e.employee_id
          and out_mark.mark_type in ('salida_final', 'salida')
          and out_mark.marked_at > e.marked_at
      )
  ),
  open_meals as (
    select distinct on (oe.employee_id)
      oe.employee_id,
      m.marked_at as meal_started_at
    from open_entries oe
    join public.attendance_marks m
      on m.employee_id = oe.employee_id
      and m.mark_type in ('salida_comida', 'bano_inicio')
      and m.marked_at > oe.entrada_at
      and not exists (
        select 1
        from public.attendance_marks back_mark
        where back_mark.employee_id = m.employee_id
          and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
          and back_mark.marked_at > m.marked_at
      )
    order by oe.employee_id, m.marked_at desc
  )
  select
    oe.employee_id,
    coalesce(p.full_name, p.username, oe.employee_name, 'Colaborador'),
    p.area_name,
    oe.entrada_id,
    oe.entrada_at,
    oe.labor_date,
    (now() at time zone 'America/Guatemala')::date as calendar_date,
    oe.labor_date < (now() at time zone 'America/Guatemala')::date as overnight_shift,
    om.meal_started_at is not null as has_open_meal,
    om.meal_started_at,
    oe.classification,
    oe.approval_status
  from open_entries oe
  join public.profiles p on p.id = oe.employee_id
  left join open_meals om on om.employee_id = oe.employee_id
  where public.is_schedule_publisher()
  order by oe.entrada_at;
$$;

revoke all on function public.get_open_attendance_shifts() from public;
grant execute on function public.get_open_attendance_shifts() to authenticated;

-- ---------------------------------------------------------------------------
-- close_open_attendance_shift: HR manual salida_final for stuck open shifts
-- ---------------------------------------------------------------------------
create or replace function public.close_open_attendance_shift(
  p_employee_id uuid,
  p_closed_at timestamptz default now(),
  p_observation text default null
)
returns public.attendance_marks
language plpgsql
security definer
set search_path = '', extensions, public
as $$
declare
  v_open_entry public.attendance_marks;
  v_open_meal public.attendance_marks;
  v_mark public.attendance_marks;
  v_observation text := nullif(trim(coalesce(p_observation, '')), '');
  v_labor_date date;
begin
  if not public.is_schedule_publisher() then
    raise exception 'PERMISSION_DENIED: se requiere rol de RRHH para cerrar turnos manualmente.';
  end if;

  select m.* into v_open_entry
  from public.attendance_marks m
  where m.employee_id = p_employee_id
    and m.mark_type = 'entrada'
    and not exists (
      select 1
      from public.attendance_marks out_mark
      where out_mark.employee_id = m.employee_id
        and out_mark.mark_type in ('salida_final', 'salida')
        and out_mark.marked_at > m.marked_at
    )
  order by m.marked_at desc
  limit 1;

  if v_open_entry.id is null then
    raise exception 'No hay turno abierto para este colaborador.';
  end if;

  select m.* into v_open_meal
  from public.attendance_marks m
  where m.employee_id = p_employee_id
    and m.mark_type in ('salida_comida', 'bano_inicio')
    and m.marked_at > v_open_entry.marked_at
    and not exists (
      select 1
      from public.attendance_marks back_mark
      where back_mark.employee_id = m.employee_id
        and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
        and back_mark.marked_at > m.marked_at
    )
  order by m.marked_at desc
  limit 1;

  if v_open_meal.id is not null then
    raise exception 'El colaborador tiene salida a comida sin regreso. Cierra la comida antes de cerrar el turno.';
  end if;

  v_labor_date := coalesce(
    v_open_entry.labor_date,
    (v_open_entry.marked_at at time zone 'America/Guatemala')::date
  );

  insert into public.attendance_marks (
    employee_id,
    employee_name,
    mark_type,
    photo_path,
    device_id,
    device_name,
    device_alert,
    related_mark_id,
    duration_minutes,
    observation,
    marked_at,
    labor_date,
    classification,
    approval_status,
    schedule_exception_id,
    system_reason
  )
  values (
    v_open_entry.employee_id,
    v_open_entry.employee_name,
    'salida_final',
    format('manual/hr-close/%s', gen_random_uuid()),
    'rrhh-manual',
    'Cierre manual RRHH',
    false,
    v_open_entry.id,
    greatest(0, floor(extract(epoch from (p_closed_at - v_open_entry.marked_at)) / 60)::integer),
    coalesce(v_observation, 'Cierre manual de turno por RRHH.'),
    p_closed_at,
    v_labor_date,
    coalesce(v_open_entry.classification, 'normal'),
    coalesce(v_open_entry.approval_status, 'not_required'),
    v_open_entry.schedule_exception_id,
    'Salida final registrada manualmente por RRHH.'
  )
  returning * into v_mark;

  return v_mark;
end;
$$;

revoke all on function public.close_open_attendance_shift(uuid, timestamptz, text) from public;
grant execute on function public.close_open_attendance_shift(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_schedule_attendance_details: labor_date matching + robust mark pairing
-- ---------------------------------------------------------------------------
drop function if exists public.get_schedule_attendance_details(date);

create or replace function public.get_schedule_attendance_details(p_week_start date)
returns table (
  schedule_id uuid, employee_id uuid, employee_name text, role text, area text, shift_date date,
  shift_type text, is_work_day boolean, scheduled_start time, actual_start timestamptz,
  meal_out timestamptz, meal_back timestamptz, meal_minutes integer,
  scheduled_end time, actual_end timestamptz, scheduled_hours numeric, actual_hours numeric,
  late_minutes integer, early_departure_minutes integer, overtime_hours numeric,
  attendance_status text, observations text,
  pending_extra_hours numeric, approved_extra_hours numeric,
  entrance_classification text, entrance_approval_status text
)
language sql stable security definer set search_path = ''
as $$
  with schedule_rows as (
    select distinct on (s.id)
      s.*,
      p.full_name,
      p.username,
      p.role,
      case
        when s.is_work_day and s.start_time is not null then
          ((s.shift_date + s.start_time) at time zone 'America/Guatemala')
      end as shift_start_ts,
      case
        when s.is_work_day and s.end_time is not null then
          (
            (s.shift_date + case when s.end_time <= s.start_time then 1 else 0 end) + s.end_time
          ) at time zone 'America/Guatemala'
      end as shift_end_ts
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
    where s.shift_date between p_week_start and p_week_start + 6
      and s.status in ('published', 'draft')
      and public.is_schedule_publisher()
    order by s.id, case s.status when 'published' then 0 else 1 end
  ),
  work_shifts as (
    select
      s.*,
      row_number() over (
        partition by s.employee_id, s.shift_date
        order by s.block_order, s.start_time nulls last, s.id
      )::integer as shift_rank,
      count(*) over (partition by s.employee_id, s.shift_date)::integer as shifts_on_day
    from schedule_rows s
    where s.is_work_day
  ),
  day_entrances as (
    select
      m.id,
      m.employee_id,
      m.marked_at,
      m.observation,
      m.classification,
      m.approval_status,
      coalesce(m.labor_date, (m.marked_at at time zone 'America/Guatemala')::date) as mark_date,
      row_number() over (
        partition by m.employee_id, coalesce(m.labor_date, (m.marked_at at time zone 'America/Guatemala')::date)
        order by m.marked_at
      )::integer as entrance_rank
    from public.attendance_marks m
    where m.mark_type = 'entrada'
  ),
  entrance_assignments as (
    select
      ws.id as schedule_id,
      coalesce(de_rank.marked_at, de_fallback.marked_at) as entrance_marked_at,
      coalesce(de_rank.observation, de_fallback.observation) as entrance_observation,
      coalesce(de_rank.classification, de_fallback.classification) as entrance_classification,
      coalesce(de_rank.approval_status, de_fallback.approval_status) as entrance_approval_status
    from work_shifts ws
    left join day_entrances de_rank
      on de_rank.employee_id = ws.employee_id
      and de_rank.mark_date = ws.shift_date
      and (
        (ws.shifts_on_day = 1 and de_rank.entrance_rank = 1)
        or (ws.shifts_on_day > 1 and de_rank.entrance_rank = ws.shift_rank)
      )
      and (
        ws.shift_start_ts is null
        or (
          de_rank.marked_at >= ws.shift_start_ts - interval '4 hours'
          and de_rank.marked_at <= coalesce(ws.shift_end_ts, ws.shift_start_ts) + interval '4 hours'
        )
      )
    left join lateral (
      select de.*
      from day_entrances de
      where de_rank.id is null
        and de.employee_id = ws.employee_id
        and de.mark_date = ws.shift_date
        and (
          ws.shift_start_ts is null
          or (
            de.marked_at >= ws.shift_start_ts - interval '4 hours'
            and de.marked_at <= coalesce(ws.shift_end_ts, ws.shift_start_ts) + interval '4 hours'
          )
        )
      order by
        abs(coalesce(extract(epoch from (de.marked_at - ws.shift_start_ts)), 0)),
        de.marked_at
      limit 1
    ) de_fallback on true
  ),
  exit_assignments as (
    select
      ws.id as schedule_id,
      exit_mark.marked_at as exit_marked_at,
      exit_mark.observation as exit_observation
    from work_shifts ws
    left join entrance_assignments ea on ea.schedule_id = ws.id
    left join lateral (
      select ea2.entrance_marked_at as next_entrance_at
      from work_shifts ws2
      join entrance_assignments ea2 on ea2.schedule_id = ws2.id
      where ws2.employee_id = ws.employee_id
        and ws2.shift_date = ws.shift_date
        and ws2.shift_rank = ws.shift_rank + 1
      limit 1
    ) next_shift on true
    left join lateral (
      select m.marked_at, m.observation
      from public.attendance_marks m
      where ea.entrance_marked_at is not null
        and m.employee_id = ws.employee_id
        and m.mark_type in ('salida_final', 'salida')
        and m.marked_at > ea.entrance_marked_at
        and (
          next_shift.next_entrance_at is null
          or m.marked_at < next_shift.next_entrance_at
        )
        and (
          ws.shift_end_ts is null
          or m.marked_at <= ws.shift_end_ts + interval '6 hours'
        )
      order by abs(extract(epoch from (m.marked_at - coalesce(ws.shift_end_ts, m.marked_at))))
      limit 1
    ) exit_mark on true
  ),
  computed as (
    select
      s.*,
      ea.entrance_marked_at,
      ea.entrance_observation,
      ea.entrance_classification,
      ea.entrance_approval_status,
      xa.exit_marked_at,
      xa.exit_observation,
      meal_out.marked_at as meal_out_marked_at,
      meal_back.marked_at as meal_back_marked_at,
      meal_back.duration_minutes as meal_back_duration_minutes,
      case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
        ea.entrance_marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer end as raw_late_minutes,
      public.get_attendance_late_grace_minutes() as grace_minutes,
      case
        when not s.is_work_day then 0
        when ea.entrance_marked_at is null or xa.exit_marked_at is null then 0
        else greatest(0, coalesce(extract(epoch from (xa.exit_marked_at - ea.entrance_marked_at)) / 3600, 0)
          - greatest(0, coalesce(extract(epoch from (meal_back.marked_at - meal_out.marked_at)) / 3600, 0)))::numeric(10,2)
      end as gross_work_hours
    from schedule_rows s
    left join entrance_assignments ea on ea.schedule_id = s.id
    left join exit_assignments xa on xa.schedule_id = s.id
    left join lateral (
      select m.*
      from public.attendance_marks m
      where s.is_work_day
        and ea.entrance_marked_at is not null
        and m.employee_id = s.employee_id
        and m.mark_type in ('salida_comida', 'bano_inicio')
        and m.marked_at > ea.entrance_marked_at
        and (xa.exit_marked_at is null or m.marked_at < xa.exit_marked_at)
      order by m.marked_at
      limit 1
    ) meal_out on true
    left join lateral (
      select m.*
      from public.attendance_marks m
      where s.is_work_day
        and meal_out.marked_at is not null
        and m.employee_id = s.employee_id
        and m.mark_type in ('regreso_comida', 'bano_regreso')
        and m.marked_at > meal_out.marked_at
        and (xa.exit_marked_at is null or m.marked_at < xa.exit_marked_at)
      order by m.marked_at
      limit 1
    ) meal_back on true
  )
  select
    c.id,
    c.employee_id,
    coalesce(c.full_name, c.username, 'Colaborador'),
    c.role,
    c.area,
    c.shift_date,
    coalesce(c.shift_type_id::text, c.shift_type),
    c.is_work_day,
    c.start_time,
    c.entrance_marked_at,
    c.meal_out_marked_at,
    c.meal_back_marked_at,
    greatest(0, coalesce(extract(epoch from (c.meal_back_marked_at - c.meal_out_marked_at)) / 60, c.meal_back_duration_minutes, 0))::integer,
    c.end_time,
    c.exit_marked_at,
    case when not c.is_work_day then 0 else greatest(0, extract(epoch from (
      (c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
      - (c.shift_date + c.start_time)
    )) / 3600 - c.break_minutes / 60.0)::numeric(10,2) end,
    case
      when not c.is_work_day then 0
      when c.entrance_marked_at is null or c.exit_marked_at is null then 0
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'pending' then 0
      when coalesce(c.entrance_approval_status, 'not_required') = 'rejected' then 0
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime', 'authorized_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'approved' then 0
      else c.gross_work_hours
    end,
    case
      when not c.is_work_day then 0
      when c.entrance_marked_at is null then 0
      when c.raw_late_minutes <= c.grace_minutes then 0
      else c.raw_late_minutes
    end,
    case when not c.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
      (c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
      - (c.exit_marked_at at time zone 'America/Guatemala')
    )) / 60, 0))::integer end,
    case
      when not c.is_work_day then 0
      when c.exit_marked_at is null then 0
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime', 'authorized_overtime') then 0
      else (
        greatest(0, extract(epoch from (
          (c.exit_marked_at at time zone 'America/Guatemala') -
          ((c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
            + case when c.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
        )) / 3600)
      )::numeric(10,2)
    end,
    case
      when c.shift_type = 'asueto' then 'asueto'
      when not c.is_work_day or c.shift_type = 'rest' then 'descanso'
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'pending' then 'extra_pendiente'
      when c.entrance_classification = 'authorized_overtime'
        and coalesce(c.entrance_approval_status, 'approved') = 'approved' then 'horas_extra'
      when c.entrance_approval_status = 'rejected' then 'extra_rechazada'
      when c.shift_date > (now() at time zone 'America/Guatemala')::date then 'pendiente'
      when c.shift_date < (now() at time zone 'America/Guatemala')::date and c.entrance_marked_at is null then 'falta'
      when c.entrance_marked_at is not null and c.raw_late_minutes > c.grace_minutes then 'tarde'
      when c.entrance_marked_at is null or c.exit_marked_at is null then 'incompleto'
      when greatest(0, coalesce(extract(epoch from (
        (c.exit_marked_at at time zone 'America/Guatemala') -
        ((c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
          + case when c.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
      )) / 60, 0)) > 0 then 'horas_extra'
      else 'completo'
    end,
    nullif(
      concat_ws(
        ' / ',
        public.sanitize_attendance_observation(c.day_notes),
        public.sanitize_attendance_observation(c.notes),
        public.sanitize_attendance_observation(c.entrance_observation),
        public.sanitize_attendance_observation(c.exit_observation)
      ),
      ''
    ),
    case
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'pending' then c.gross_work_hours
      else 0
    end,
    case
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime', 'authorized_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'approved' then c.gross_work_hours
      else 0
    end,
    c.entrance_classification,
    c.entrance_approval_status
  from computed c
  order by c.shift_date, c.block_order, c.start_time nulls last, c.full_name;
$$;

revoke all on function public.get_schedule_attendance_details(date) from public;
grant execute on function public.get_schedule_attendance_details(date) to authenticated;
