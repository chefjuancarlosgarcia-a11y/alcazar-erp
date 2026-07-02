-- Diagnostic RPC for attendance terminal bugs (Osman / Moisés cases).
-- Apply after 152_attendance_report_and_open_shift_fix.sql.
-- Does NOT change marking business rules.

-- ---------------------------------------------------------------------------
-- diagnose_attendance_employee_state
-- Run: select * from public.diagnose_attendance_employee_state('Osman', '2026-06-18', '2026-06-22');
-- ---------------------------------------------------------------------------
create or replace function public.diagnose_attendance_employee_state(
  p_employee_name text,
  p_start_date date default ((now() at time zone 'America/Guatemala')::date - 7),
  p_end_date date default (now() at time zone 'America/Guatemala')::date
)
returns table (
  section text,
  employee_id uuid,
  employee_name text,
  labor_date date,
  calendar_date date,
  mark_id uuid,
  marked_at timestamptz,
  mark_type text,
  classification text,
  approval_status text,
  device_id text,
  device_name text,
  observation text,
  related_mark_id uuid,
  has_open_entry boolean,
  has_open_meal boolean,
  overnight_shift boolean,
  open_entry_id uuid,
  open_entry_at timestamptz,
  open_meal_id uuid,
  open_meal_at timestamptz,
  next_expected_mark text,
  block_reason text,
  detail text,
  marking_state jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz constant text := 'America/Guatemala';
  v_employee_id uuid;
  v_employee_name text;
  v_calendar_date date := (now() at time zone v_tz)::date;
  v_open_entry public.attendance_marks;
  v_open_meal public.attendance_marks;
  v_ctx jsonb;
  v_state_entrada jsonb;
  v_state_comida jsonb;
  v_state_regreso jsonb;
  v_state_salida jsonb;
  v_sched record;
  v_next text;
  v_block text;
  v_age_days integer;
  v_sched_overnight boolean := false;
  v_err_msg text;
  v_err_detail text;
  v_err_hint text;
  v_err_context text;
  v_err_state text;
  v_allow_diagnostic boolean;
begin
  v_open_entry.id := null;
  v_open_meal.id := null;

  v_allow_diagnostic := auth.uid() is null
    or public.is_schedule_publisher()
    or public.can_view_attendance_reports();

  if not v_allow_diagnostic then
    return query select
      'error'::text,
      null::uuid,
      coalesce(p_employee_name, 'Colaborador')::text,
      null::date,
      v_calendar_date,
      null::uuid, null::timestamptz, null::text, null::text, null::text,
      null::text, null::text,
      format(
        'PERMISSION_DENIED: auth.uid=%s. Requiere is_schedule_publisher() o can_view_attendance_reports().',
        coalesce(auth.uid()::text, 'null')
      )::text,
      null::uuid,
      null::boolean, null::boolean, null::boolean,
      null::uuid, null::timestamptz, null::uuid, null::timestamptz,
      null::text,
      'PERMISSION_DENIED'::text,
      format(
        'publisher=%s viewer=%s',
        public.is_schedule_publisher(),
        public.can_view_attendance_reports()
      )::text,
      jsonb_build_object(
        'error_message', 'PERMISSION_DENIED',
        'error_detail', format('auth.uid=%s', coalesce(auth.uid()::text, 'null')),
        'error_hint', 'Ejecuta autenticado como RRHH/admin o usa el SQL Editor con rol postgres.',
        'error_context', 'diagnose_attendance_employee_state: permission gate',
        'sqlstate', '42501'
      );
    return;
  end if;

  select p.id, coalesce(p.full_name, p.username, 'Colaborador')
  into v_employee_id, v_employee_name
  from public.profiles p
  where lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
  order by
    case when lower(coalesce(p.full_name, p.username, '')) = lower(trim(p_employee_name)) then 0 else 1 end,
    p.full_name
  limit 1;

  if v_employee_id is null then
    return query select
      'error'::text,
      null::uuid,
      coalesce(p_employee_name, 'Colaborador')::text,
      null::date,
      v_calendar_date,
      null::uuid, null::timestamptz, null::text, null::text, null::text,
      null::text, null::text,
      format('Sin colaborador que coincida con "%s".', p_employee_name)::text,
      null::uuid,
      null::boolean, null::boolean, null::boolean,
      null::uuid, null::timestamptz, null::uuid, null::timestamptz,
      null::text,
      format('EMPLOYEE_NOT_FOUND: "%s"', p_employee_name)::text,
      'Verifica nombre en profiles.full_name / profiles.username.'::text,
      jsonb_build_object(
        'error_message', format('Sin colaborador que coincida con "%s".', p_employee_name),
        'error_detail', format('search=%s range=%s..%s', p_employee_name, p_start_date, p_end_date),
        'error_hint', 'Prueba con un fragmento del nombre: Osman, Mois, Mazáriegos.',
        'error_context', 'diagnose_attendance_employee_state: employee lookup',
        'sqlstate', 'P0002'
      );
    return;
  end if;

  return query select
    'profile'::text,
    v_employee_id,
    v_employee_name,
    null::date,
    v_calendar_date,
    null::uuid, null::timestamptz, null::text, null::text, null::text,
    null::text, null::text, null::text, null::uuid,
    null::boolean, null::boolean, null::boolean,
    null::uuid, null::timestamptz, null::uuid, null::timestamptz,
    null::text, null::text,
    format('Rango diagnóstico: %s a %s. Hoy GT: %s.%s',
      p_start_date,
      p_end_date,
      v_calendar_date,
      case when auth.uid() is null then ' Modo SQL Editor (sin JWT).' else '' end
    )::text,
    null::jsonb;

  -- Open entry (global, not limited to date range)
  select m.* into v_open_entry
  from public.attendance_marks m
  where m.employee_id = v_employee_id
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

  if v_open_entry.id is not null then
    select m.* into v_open_meal
    from public.attendance_marks m
    where m.employee_id = v_employee_id
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

    v_age_days := v_calendar_date - coalesce(
      v_open_entry.labor_date,
      (v_open_entry.marked_at at time zone v_tz)::date
    );

    select exists (
      select 1
      from public.employee_schedules s
      where s.employee_id = v_employee_id
        and s.shift_date = coalesce(v_open_entry.labor_date, (v_open_entry.marked_at at time zone v_tz)::date)
        and s.status in ('draft', 'published')
        and s.is_work_day = true
        and s.start_time is not null
        and s.end_time is not null
        and s.end_time <= s.start_time
    ) into v_sched_overnight;

    return query select
      'open_entry'::text,
      v_employee_id,
      v_employee_name,
      coalesce(v_open_entry.labor_date, (v_open_entry.marked_at at time zone v_tz)::date),
      v_calendar_date,
      v_open_entry.id,
      v_open_entry.marked_at,
      v_open_entry.mark_type,
      v_open_entry.classification,
      v_open_entry.approval_status,
      v_open_entry.device_id,
      v_open_entry.device_name,
      v_open_entry.observation,
      v_open_entry.related_mark_id,
      true,
      v_open_meal.id is not null,
      coalesce(v_open_entry.labor_date, (v_open_entry.marked_at at time zone v_tz)::date) < v_calendar_date,
      v_open_entry.id,
      v_open_entry.marked_at,
      v_open_meal.id,
      v_open_meal.marked_at,
      case
        when v_open_meal.id is not null then 'regreso_comida'
        else 'salida_comida o salida_final'
      end,
      case
        when v_open_meal.id is not null then 'Comida abierta: debe regresar antes de salida final.'
        else 'Entrada abierta bloquea nueva entrada hasta salida_final.'
      end,
      format(
        'Entrada abierta hace %s día(s). labor_date=%s. ¿Horario publicado cruza medianoche ese día? %s. ¿Huérfano probable? %s (entrada sin salida_final, edad=%s d). Cierre RRHH: close_open_attendance_shift(%s).',
        v_age_days,
        coalesce(v_open_entry.labor_date::text, '-'),
        case when v_sched_overnight then 'SÍ' else 'NO' end,
        case when v_age_days >= 1 and not v_sched_overnight then 'SÍ' else 'REVISAR' end,
        v_age_days,
        v_employee_id
      ),
      null::jsonb;

    if v_open_meal.id is not null then
      return query select
        'open_meal'::text,
        v_employee_id,
        v_employee_name,
        coalesce(v_open_meal.labor_date, (v_open_meal.marked_at at time zone v_tz)::date),
        v_calendar_date,
        v_open_meal.id,
        v_open_meal.marked_at,
        v_open_meal.mark_type,
        v_open_meal.classification,
        v_open_meal.approval_status,
        v_open_meal.device_id,
        v_open_meal.device_name,
        v_open_meal.observation,
        v_open_meal.related_mark_id,
        true,
        true,
        coalesce(v_open_entry.labor_date, (v_open_entry.marked_at at time zone v_tz)::date) < v_calendar_date,
        v_open_entry.id,
        v_open_entry.marked_at,
        v_open_meal.id,
        v_open_meal.marked_at,
        'regreso_comida'::text,
        'Bloquea segunda salida_comida y salida_final hasta regreso_comida.'::text,
        format('Comida abierta desde %s. Vinculada a entrada %s.',
          to_char(v_open_meal.marked_at at time zone v_tz, 'DD/MM/YYYY HH24:MI'),
          v_open_entry.id),
        null::jsonb;
    end if;
  else
    return query select
      'open_entry'::text,
      v_employee_id,
      v_employee_name,
      null::date,
      v_calendar_date,
      null::uuid, null::timestamptz, null::text, null::text, null::text,
      null::text, null::text, null::text, null::uuid,
      false, false, false,
      null::uuid, null::timestamptz, null::uuid, null::timestamptz,
      'entrada'::text,
      null::text,
      'Sin entrada abierta global.'::text,
      null::jsonb;
  end if;

  -- Marks in range
  return query
  select
    'mark'::text,
    v_employee_id,
    v_employee_name,
    coalesce(m.labor_date, (m.marked_at at time zone v_tz)::date),
    (m.marked_at at time zone v_tz)::date,
    m.id,
    m.marked_at,
    m.mark_type,
    m.classification,
    m.approval_status,
    m.device_id,
    m.device_name,
    m.observation,
    m.related_mark_id,
    v_open_entry.id is not null,
    v_open_meal.id is not null,
    coalesce(v_open_entry.labor_date, (v_open_entry.marked_at at time zone v_tz)::date) < v_calendar_date,
    v_open_entry.id,
    v_open_entry.marked_at,
    v_open_meal.id,
    v_open_meal.marked_at,
    null::text,
    null::text,
    format('marked_at GT=%s', to_char(m.marked_at at time zone v_tz, 'DD/MM/YYYY HH24:MI:SS')),
    null::jsonb
  from public.attendance_marks m
  where m.employee_id = v_employee_id
    and coalesce(m.labor_date, (m.marked_at at time zone v_tz)::date)
      between p_start_date and p_end_date
  order by m.marked_at;

  -- Schedules in range
  for v_sched in
    select
      s.shift_date,
      s.status,
      s.is_work_day,
      s.start_time,
      s.end_time,
      s.shift_type,
      coalesce(st.name, s.shift_type) as shift_type_name
    from public.employee_schedules s
    left join public.shift_types st on st.id = s.shift_type_id
    where s.employee_id = v_employee_id
      and s.shift_date between p_start_date and p_end_date
    order by s.shift_date, s.block_order, s.start_time
  loop
    return query select
      'schedule'::text,
      v_employee_id,
      v_employee_name,
      v_sched.shift_date,
      v_calendar_date,
      null::uuid, null::timestamptz, null::text, null::text, null::text,
      null::text, null::text, null::text, null::uuid,
      v_open_entry.id is not null,
      v_open_meal.id is not null,
      false,
      v_open_entry.id,
      v_open_entry.marked_at,
      v_open_meal.id,
      v_open_meal.marked_at,
      null::text,
      null::text,
      format('%s %s-%s work=%s type=%s',
        v_sched.status,
        coalesce(v_sched.start_time::text, '-'),
        coalesce(v_sched.end_time::text, '-'),
        v_sched.is_work_day,
        v_sched.shift_type_name),
      null::jsonb;
  end loop;

  -- Custom schedule exceptions in range
  return query
  select
    'custom_schedule'::text,
    v_employee_id,
    v_employee_name,
    coalesce(ecs.specific_date, p_start_date),
    v_calendar_date,
    ecs.id,
    null::timestamptz,
    'exception'::text,
    null::text,
    ecs.status,
    null::text,
    null::text,
    ecs.notes,
    null::uuid,
    v_open_entry.id is not null,
    v_open_meal.id is not null,
    false,
    v_open_entry.id,
    v_open_entry.marked_at,
    v_open_meal.id,
    v_open_meal.marked_at,
    null::text,
    null::text,
    format('specific=%s weekday=%s %s-%s active=%s',
      coalesce(ecs.specific_date::text, '-'),
      coalesce(ecs.weekday::text, '-'),
      coalesce(ecs.start_time::text, 'null'),
      coalesce(ecs.end_time::text, 'null'),
      ecs.status),
    null::jsonb
  from public.employee_custom_schedules ecs
  where ecs.profile_id = v_employee_id
    and ecs.status = 'active'
    and (
      (ecs.specific_date between p_start_date and p_end_date)
      or (ecs.start_date <= p_end_date and coalesce(ecs.end_date, p_end_date) >= p_start_date)
    );

  v_ctx := public.resolve_attendance_context(v_employee_id, 'entrada', now());
  v_state_entrada := public.get_attendance_marking_state(v_employee_id, 'entrada');
  v_state_comida := public.get_attendance_marking_state(v_employee_id, 'salida_comida');
  v_state_regreso := public.get_attendance_marking_state(v_employee_id, 'regreso_comida');
  v_state_salida := public.get_attendance_marking_state(v_employee_id, 'salida_final');

  return query select
    'context'::text,
    v_employee_id,
    v_employee_name,
    (v_ctx ->> 'labor_date')::date,
    (v_ctx ->> 'calendar_date')::date,
    null::uuid, null::timestamptz, null::text, null::text, null::text,
    null::text, null::text, null::text, null::uuid,
    coalesce((v_ctx ->> 'has_open_entry')::boolean, false),
    coalesce((v_ctx ->> 'has_open_meal')::boolean, false),
    coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
    nullif(v_ctx ->> 'open_entry_id', '')::uuid,
    nullif(v_ctx ->> 'open_entry_marked_at', '')::timestamptz,
    nullif(v_ctx ->> 'open_meal_id', '')::uuid,
    null::timestamptz,
    null::text,
    null::text,
    'resolve_attendance_context(entrada)'::text,
    v_ctx;

  return query select
    'marking_state'::text,
    v_employee_id,
    v_employee_name,
    (v_state_entrada ->> 'labor_date')::date,
    v_calendar_date,
    null::uuid, null::timestamptz,
    'entrada'::text,
    v_state_entrada ->> 'classification',
    v_state_entrada ->> 'approval_status',
    null::text, null::text, null::text, null::uuid,
    coalesce((v_state_entrada ->> 'has_open_entry')::boolean, false),
    coalesce((v_state_entrada ->> 'has_open_meal')::boolean, false),
    coalesce((v_state_entrada ->> 'overnight_shift')::boolean, false),
    null::uuid, null::timestamptz, null::uuid, null::timestamptz,
    case when coalesce((v_state_entrada ->> 'allowed_for_entrada')::boolean, false) then 'entrada' else null end,
    v_state_entrada ->> 'reason',
    format('reason_code=%s allowed=%s allowed_for_entrada=%s allowed_for_completion=%s',
      v_state_entrada ->> 'reason_code',
      v_state_entrada ->> 'allowed',
      v_state_entrada ->> 'allowed_for_entrada',
      v_state_entrada ->> 'allowed_for_completion'),
    v_state_entrada;

  return query select
    'marking_state'::text,
    v_employee_id,
    v_employee_name,
    (v_state_comida ->> 'labor_date')::date,
    v_calendar_date,
    null::uuid, null::timestamptz,
    'salida_comida'::text,
    v_state_comida ->> 'classification',
    v_state_comida ->> 'approval_status',
    null::text, null::text, null::text, null::uuid,
    coalesce((v_state_comida ->> 'has_open_entry')::boolean, false),
    coalesce((v_state_comida ->> 'has_open_meal')::boolean, false),
    coalesce((v_state_comida ->> 'overnight_shift')::boolean, false),
    null::uuid, null::timestamptz, null::uuid, null::timestamptz,
    case when coalesce((v_state_comida ->> 'allowed')::boolean, false) then 'salida_comida' else null end,
    v_state_comida ->> 'reason',
    format('reason_code=%s allowed=%s allowed_for_completion=%s RPC=get_attendance_marking_state',
      v_state_comida ->> 'reason_code',
      v_state_comida ->> 'allowed',
      v_state_comida ->> 'allowed_for_completion'),
    v_state_comida;

  return query select
    'marking_state'::text,
    v_employee_id,
    v_employee_name,
    (v_state_regreso ->> 'labor_date')::date,
    v_calendar_date,
    null::uuid, null::timestamptz,
    'regreso_comida'::text,
    v_state_regreso ->> 'classification',
    v_state_regreso ->> 'approval_status',
    null::text, null::text, null::text, null::uuid,
    coalesce((v_state_regreso ->> 'has_open_entry')::boolean, false),
    coalesce((v_state_regreso ->> 'has_open_meal')::boolean, false),
    coalesce((v_state_regreso ->> 'overnight_shift')::boolean, false),
    null::uuid, null::timestamptz, null::uuid, null::timestamptz,
    case when coalesce((v_state_regreso ->> 'allowed')::boolean, false) then 'regreso_comida' else null end,
    v_state_regreso ->> 'reason',
    format('reason_code=%s allowed=%s', v_state_regreso ->> 'reason_code', v_state_regreso ->> 'allowed'),
    v_state_regreso;

  return query select
    'marking_state'::text,
    v_employee_id,
    v_employee_name,
    (v_state_salida ->> 'labor_date')::date,
    v_calendar_date,
    null::uuid, null::timestamptz,
    'salida_final'::text,
    v_state_salida ->> 'classification',
    v_state_salida ->> 'approval_status',
    null::text, null::text, null::text, null::uuid,
    coalesce((v_state_salida ->> 'has_open_entry')::boolean, false),
    coalesce((v_state_salida ->> 'has_open_meal')::boolean, false),
    coalesce((v_state_salida ->> 'overnight_shift')::boolean, false),
    null::uuid, null::timestamptz, null::uuid, null::timestamptz,
    case when coalesce((v_state_salida ->> 'allowed')::boolean, false) then 'salida_final' else null end,
    v_state_salida ->> 'reason',
    format('reason_code=%s allowed=%s. HR close: close_open_attendance_shift(%s)',
      v_state_salida ->> 'reason_code',
      v_state_salida ->> 'allowed',
      v_employee_id),
    v_state_salida;

  -- Terminal UI simulation (matches AttendanceTerminal.jsx disabled rules)
  v_next := case
    when v_open_entry.id is null then 'entrada'
    when v_open_meal.id is not null then 'regreso_comida'
    else 'salida_comida o salida_final'
  end;

  v_block := case
    when v_open_entry.id is not null and v_open_meal.id is null then
      'salida_comida: backend allowed=' || coalesce(v_state_comida ->> 'allowed', '?')
        || '. UI también exige isCheckedIn/has_open_entry y activeMeal=false.'
    when v_open_entry.id is null then
      'salida_comida: sin entrada activa en backend.'
    else
      'salida_comida bloqueada: comida abierta.'
  end;

  return query select
    'terminal_ui'::text,
    v_employee_id,
    v_employee_name,
    (v_ctx ->> 'labor_date')::date,
    v_calendar_date,
    null::uuid, null::timestamptz, null::text, null::text, null::text,
    null::text, null::text, null::text, null::uuid,
    v_open_entry.id is not null,
    v_open_meal.id is not null,
    coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
    v_open_entry.id,
    v_open_entry.marked_at,
    v_open_meal.id,
    v_open_meal.marked_at,
    v_next,
    v_block,
    'Ver filas marking_state y open_* para causa. Mensaje kiosk viene de get_attendance_marking_state → reason.'::text,
    jsonb_build_object(
      'entrada', v_state_entrada,
      'salida_comida', v_state_comida,
      'regreso_comida', v_state_regreso,
      'salida_final', v_state_salida
    );

exception
  when others then
    get stacked diagnostics
      v_err_msg = message_text,
      v_err_detail = pg_exception_detail,
      v_err_hint = pg_exception_hint,
      v_err_context = pg_exception_context;

    v_err_state := SQLSTATE;

    return query select
      'error'::text,
      v_employee_id,
      coalesce(v_employee_name, p_employee_name, 'Colaborador')::text,
      null::date,
      v_calendar_date,
      null::uuid, null::timestamptz, null::text, null::text, null::text,
      null::text, null::text,
      coalesce(v_err_msg, 'Error desconocido en diagnose_attendance_employee_state')::text,
      null::uuid,
      null::boolean, null::boolean, null::boolean,
      null::uuid, null::timestamptz, null::uuid, null::timestamptz,
      null::text,
      coalesce(v_err_msg, 'Error desconocido')::text,
      coalesce(v_err_detail, '-')::text,
      jsonb_build_object(
        'error_message', v_err_msg,
        'error_detail', v_err_detail,
        'error_hint', v_err_hint,
        'error_context', v_err_context,
        'sqlstate', v_err_state,
        'employee_name_search', p_employee_name,
        'start_date', p_start_date,
        'end_date', p_end_date
      );
end;
$$;

comment on function public.diagnose_attendance_employee_state(text, date, date) is
  'Diagnóstico de marcajes, turno abierto, marking_state por tipo y simulación UI terminal.';

revoke all on function public.diagnose_attendance_employee_state(text, date, date) from public;
grant execute on function public.diagnose_attendance_employee_state(text, date, date) to authenticated;
