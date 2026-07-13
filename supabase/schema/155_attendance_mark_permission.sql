-- Sprint 1.1: centralize attendance mark permission (chain rules).
-- Apply after 154_open_attendance_shifts_align.sql.
-- Does not change classification, schedule, or overnight detection rules.

-- ---------------------------------------------------------------------------
-- Composite type: single authority for "can mark X?"
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'attendance_mark_permission'
  ) then
    create type public.attendance_mark_permission as (
      allowed boolean,
      reason_code text,
      reason text,
      has_open_entry boolean,
      has_open_meal boolean,
      open_entry_id uuid,
      open_entry_at timestamptz,
      open_meal_id uuid,
      next_expected_mark text,
      labor_date date,
      classification text,
      approval_status text
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: normalize terminal mark type aliases
-- ---------------------------------------------------------------------------
create or replace function public.normalize_attendance_mark_type(p_mark_type text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mark_type text := lower(trim(coalesce(p_mark_type, 'entrada')));
begin
  if v_mark_type = 'salida' then return 'salida_final'; end if;
  if v_mark_type = 'bano_inicio' then return 'salida_comida'; end if;
  if v_mark_type = 'bano_regreso' then return 'regreso_comida'; end if;
  return v_mark_type;
end;
$$;

revoke all on function public.normalize_attendance_mark_type(text) from public;

-- ---------------------------------------------------------------------------
-- Internal: mark-chain rules (same logic previously duplicated in register)
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_attendance_mark_chain(
  p_mark_type text,
  p_has_open_entry boolean,
  p_has_open_meal boolean
)
returns table (
  allowed boolean,
  reason_code text,
  reason text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mark_type text := public.normalize_attendance_mark_type(p_mark_type);
begin
  case v_mark_type
    when 'entrada' then
      if coalesce(p_has_open_entry, false) then
        return query select
          false,
          'open_entry'::text,
          'Ya existe una entrada activa para este colaborador.'::text;
      else
        return query select true, 'allowed'::text, null::text;
      end if;

    when 'salida_comida' then
      if not coalesce(p_has_open_entry, false) then
        return query select
          false,
          'no_open_entry'::text,
          'No existe entrada activa para registrar salida a comida.'::text;
      elsif coalesce(p_has_open_meal, false) then
        return query select
          false,
          'open_meal'::text,
          'Ya existe una salida a comida pendiente de regreso.'::text;
      else
        return query select true, 'open_shift'::text, null::text;
      end if;

    when 'regreso_comida' then
      if not coalesce(p_has_open_meal, false) then
        return query select
          false,
          'no_open_meal'::text,
          'No existe salida a comida pendiente.'::text;
      else
        return query select true, 'open_shift'::text, null::text;
      end if;

    when 'salida_final' then
      if not coalesce(p_has_open_entry, false) then
        return query select
          false,
          'no_open_entry'::text,
          'No existe entrada activa para registrar salida final.'::text;
      elsif coalesce(p_has_open_meal, false) then
        return query select
          false,
          'open_meal'::text,
          'Registra el regreso de comida antes de la salida final.'::text;
      else
        return query select true, 'open_shift'::text, null::text;
      end if;

    else
      return query select
        false,
        'invalid_mark_type'::text,
        'Tipo de marcaje no valido.'::text;
  end case;
end;
$$;

revoke all on function public.evaluate_attendance_mark_chain(text, boolean, boolean) from public;

-- ---------------------------------------------------------------------------
-- resolve_attendance_mark_permission: single authority for mark permission
-- ---------------------------------------------------------------------------
create or replace function public.resolve_attendance_mark_permission(
  p_employee_id uuid,
  p_mark_type text,
  p_at timestamptz default now()
)
returns public.attendance_mark_permission
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mark_type text := public.normalize_attendance_mark_type(p_mark_type);
  v_ctx jsonb;
  v_class jsonb;
  v_chain record;
  v_labor_date date;
  v_has_open_entry boolean;
  v_has_open_meal boolean;
  v_open_entry_id uuid;
  v_open_entry_at timestamptz;
  v_open_meal_id uuid;
  v_next_expected_mark text;
  v_reason_code text;
  v_reason text;
  v_result public.attendance_mark_permission;
begin
  if v_mark_type not in ('entrada', 'salida_comida', 'regreso_comida', 'salida_final') then
    v_result.allowed := false;
    v_result.reason_code := 'invalid_mark_type';
    v_result.reason := 'Tipo de marcaje no valido.';
    v_result.has_open_entry := false;
    v_result.has_open_meal := false;
    v_result.open_entry_id := null;
    v_result.open_entry_at := null;
    v_result.open_meal_id := null;
    v_result.next_expected_mark := null;
    v_result.labor_date := (p_at at time zone 'America/Guatemala')::date;
    v_result.classification := null;
    v_result.approval_status := null;
    return v_result;
  end if;

  v_ctx := public.resolve_attendance_context(p_employee_id, v_mark_type, p_at);
  v_labor_date := (v_ctx ->> 'labor_date')::date;
  v_has_open_entry := coalesce((v_ctx ->> 'has_open_entry')::boolean, false);
  v_has_open_meal := coalesce((v_ctx ->> 'has_open_meal')::boolean, false);
  v_open_entry_id := nullif(v_ctx ->> 'open_entry_id', '')::uuid;
  v_open_entry_at := nullif(v_ctx ->> 'open_entry_marked_at', '')::timestamptz;
  v_open_meal_id := nullif(v_ctx ->> 'open_meal_id', '')::uuid;

  v_class := public.classify_attendance_mark(p_employee_id, v_labor_date, v_mark_type, p_at);

  select *
  into v_chain
  from public.evaluate_attendance_mark_chain(v_mark_type, v_has_open_entry, v_has_open_meal);

  v_reason_code := v_chain.reason_code;
  v_reason := v_chain.reason;

  if v_mark_type = 'entrada'
     and v_chain.allowed
     and v_class ->> 'reason_code' is not null
     and v_class ->> 'reason_code' <> 'allowed' then
    v_reason_code := v_class ->> 'reason_code';
  end if;

  if not v_has_open_entry then
    v_next_expected_mark := 'entrada';
  elsif v_has_open_meal then
    v_next_expected_mark := 'regreso_comida';
  else
    v_next_expected_mark := 'salida_comida';
  end if;

  v_result.allowed := v_chain.allowed;
  v_result.reason_code := v_reason_code;
  v_result.reason := v_reason;
  v_result.has_open_entry := v_has_open_entry;
  v_result.has_open_meal := v_has_open_meal;
  v_result.open_entry_id := v_open_entry_id;
  v_result.open_entry_at := v_open_entry_at;
  v_result.open_meal_id := v_open_meal_id;
  v_result.next_expected_mark := v_next_expected_mark;
  v_result.labor_date := v_labor_date;
  v_result.classification := v_class ->> 'classification';
  v_result.approval_status := coalesce(v_class ->> 'approval_status', 'not_required');

  return v_result;
end;
$$;

revoke all on function public.resolve_attendance_mark_permission(uuid, text, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- get_attendance_marking_state: UI wrapper over resolve_attendance_mark_permission
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
  v_mark_type text := public.normalize_attendance_mark_type(
    coalesce(nullif(trim(p_mark_type), ''), 'entrada')
  );
  v_perm public.attendance_mark_permission;
  v_schedule jsonb;
  v_class jsonb;
  v_calendar_date date;
  v_open_entry_label text;
  v_today_class jsonb;
  v_allowed_for_completion boolean;
  v_display_reason text;
  v_system_reason text;
  v_schedule_exception_id uuid;
begin
  v_perm := public.resolve_attendance_mark_permission(p_employee_id, v_mark_type, now());
  v_calendar_date := (now() at time zone 'America/Guatemala')::date;
  v_schedule := public.can_employee_mark_attendance(p_employee_id, v_perm.labor_date);
  v_class := public.classify_attendance_mark(
    p_employee_id,
    v_perm.labor_date,
    v_mark_type,
    now()
  );
  v_system_reason := v_class ->> 'system_reason';
  v_schedule_exception_id := nullif(v_class ->> 'schedule_exception_id', '')::uuid;

  if v_perm.open_entry_at is not null then
    v_open_entry_label := to_char(
      v_perm.open_entry_at at time zone 'America/Guatemala',
      'DD/MM/YYYY HH24:MI'
    );
  end if;

  v_allowed_for_completion := v_perm.has_open_entry and (
    (select c.allowed from public.evaluate_attendance_mark_chain('salida_comida', true, v_perm.has_open_meal) c)
    or (select c.allowed from public.evaluate_attendance_mark_chain('regreso_comida', true, v_perm.has_open_meal) c)
    or (select c.allowed from public.evaluate_attendance_mark_chain('salida_final', true, v_perm.has_open_meal) c)
  );

  if v_perm.has_open_entry and v_mark_type = 'entrada' and not v_perm.allowed then
    v_today_class := public.classify_attendance_mark(
      p_employee_id,
      v_calendar_date,
      'entrada',
      now()
    );

    v_display_reason := case
      when v_perm.labor_date < v_calendar_date
        and v_today_class ->> 'reason_code' = 'authorized_overtime' then
        format(
          'Turno abierto desde el %s. Registra salida final de ese turno antes de marcar entrada de tiempo extraordinario autorizado hoy (%s).',
          coalesce(v_open_entry_label, 'fecha anterior'),
          to_char(v_calendar_date, 'DD/MM/YYYY')
        )
      when v_perm.labor_date < v_calendar_date then
        format(
          'Turno abierto desde el %s (cruza medianoche). Registra salida final de ese turno antes de una nueva entrada.',
          coalesce(v_open_entry_label, 'fecha anterior')
        )
      when v_today_class ->> 'reason_code' = 'authorized_overtime'
        and v_perm.labor_date = v_calendar_date then
        format(
          'Ya existe una entrada activa hoy (%s). Registra salida final antes de otra entrada extraordinaria.',
          coalesce(v_open_entry_label, 'hoy')
        )
      else
        format(
          'Ya existe una entrada activa desde el %s. Registra salida final antes de marcar una nueva entrada.',
          coalesce(v_open_entry_label, 'turno actual')
        )
    end;

    return jsonb_build_object(
      'allowed', false,
      'allowed_for_entrada', false,
      'allowed_for_completion', v_allowed_for_completion,
      'reason', v_display_reason,
      'reason_code', 'open_entry',
      'classification', v_perm.classification,
      'approval_status', v_perm.approval_status,
      'system_reason', v_system_reason,
      'schedule_exception_id', v_schedule_exception_id,
      'labor_date', v_perm.labor_date,
      'calendar_date', v_calendar_date,
      'has_open_entry', true,
      'has_open_meal', v_perm.has_open_meal,
      'overnight_shift', v_perm.labor_date < v_calendar_date,
      'open_entry_marked_at', v_perm.open_entry_at,
      'open_entry_labor_date', v_perm.labor_date,
      'open_entry_id', v_perm.open_entry_id,
      'open_meal_id', v_perm.open_meal_id,
      'next_expected_mark', v_perm.next_expected_mark,
      'today_authorized_overtime', v_today_class ->> 'reason_code' = 'authorized_overtime',
      'schedule_id', v_schedule -> 'schedule_id',
      'schedule_status', v_schedule -> 'schedule_status',
      'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, true)
    );
  end if;

  if v_perm.has_open_entry then
    v_display_reason := case
      when v_perm.labor_date < v_calendar_date then
        format('Completando turno abierto del %s.', coalesce(v_open_entry_label, 'fecha anterior'))
      when v_perm.allowed then
        coalesce(v_schedule ->> 'reason', 'Completa el turno abierto con comida o salida final.')
      else
        coalesce(v_perm.reason, v_schedule ->> 'reason')
    end;

    return jsonb_build_object(
      'allowed', v_perm.allowed,
      'allowed_for_entrada', false,
      'allowed_for_completion', v_allowed_for_completion,
      'reason', v_display_reason,
      'reason_code', case when v_perm.allowed then 'open_shift' else v_perm.reason_code end,
      'classification', v_perm.classification,
      'approval_status', v_perm.approval_status,
      'system_reason', v_system_reason,
      'schedule_exception_id', v_schedule_exception_id,
      'labor_date', v_perm.labor_date,
      'calendar_date', v_calendar_date,
      'has_open_entry', true,
      'has_open_meal', v_perm.has_open_meal,
      'overnight_shift', v_perm.labor_date < v_calendar_date,
      'open_entry_marked_at', v_perm.open_entry_at,
      'open_entry_labor_date', v_perm.labor_date,
      'open_entry_id', v_perm.open_entry_id,
      'open_meal_id', v_perm.open_meal_id,
      'next_expected_mark', v_perm.next_expected_mark,
      'today_authorized_overtime', false,
      'schedule_id', v_schedule -> 'schedule_id',
      'schedule_status', v_schedule -> 'schedule_status',
      'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, true)
    );
  end if;

  v_display_reason := case
    when not v_perm.allowed then coalesce(v_perm.reason, v_schedule ->> 'reason')
    else v_schedule ->> 'reason'
  end;

  return jsonb_build_object(
    'allowed', v_perm.allowed,
    'allowed_for_entrada', true,
    'allowed_for_completion', false,
    'reason', v_display_reason,
    'reason_code', case
      when not v_perm.allowed then v_perm.reason_code
      else coalesce(v_schedule ->> 'reason_code', v_perm.reason_code)
    end,
    'classification', v_perm.classification,
    'approval_status', v_perm.approval_status,
    'system_reason', v_system_reason,
    'schedule_exception_id', v_schedule_exception_id,
    'labor_date', v_perm.labor_date,
    'calendar_date', v_calendar_date,
    'has_open_entry', false,
    'has_open_meal', false,
    'overnight_shift', v_perm.labor_date < v_calendar_date,
    'open_entry_marked_at', null,
    'open_entry_labor_date', null,
    'open_entry_id', null,
    'open_meal_id', null,
    'next_expected_mark', v_perm.next_expected_mark,
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
-- register_attendance_mark: consume resolve_attendance_mark_permission
-- ---------------------------------------------------------------------------
create or replace function public.register_attendance_mark(
  p_employee_id uuid,
  p_pin text,
  p_mark_type text,
  p_photo_path text,
  p_device_id text,
  p_device_name text,
  p_observation text default null,
  p_client_ip text default null
)
returns public.attendance_marks
language plpgsql
security definer
set search_path = '', extensions, public
as $$
declare
  employee public.profiles;
  credential public.attendance_credentials;
  mark public.attendance_marks;
  open_entry public.attendance_marks;
  open_meal public.attendance_marks;
  meal_minutes integer;
  unrecognized_device boolean;
  observation_text text := nullif(trim(p_observation), '');
  user_agent text;
  v_mark_type text;
  v_perm public.attendance_mark_permission;
  v_class jsonb;
begin
  perform public.assert_attendance_device_can_mark(
    p_device_id,
    p_employee_id,
    p_client_ip,
    null
  );

  if nullif(trim(p_photo_path), '') is null then
    raise exception 'Se requiere foto para registrar asistencia.';
  end if;

  v_mark_type := public.normalize_attendance_mark_type(p_mark_type);
  if v_mark_type not in ('entrada', 'salida_comida', 'regreso_comida', 'salida_final') then
    raise exception 'Tipo de marcaje no valido.';
  end if;

  select * into employee from public.profiles where id = p_employee_id and status = 'active';
  select * into credential from public.attendance_credentials where employee_id = p_employee_id;
  if employee.id is null or credential.employee_id is null
    or crypt(p_pin, credential.pin_hash) <> credential.pin_hash then
    raise exception 'PIN incorrecto o colaborador sin PIN configurado.';
  end if;

  v_perm := public.resolve_attendance_mark_permission(p_employee_id, v_mark_type, now());

  if not v_perm.allowed then
    raise exception '%', coalesce(
      v_perm.reason,
      'No se puede registrar esta marcación en el estado actual del turno.'
    );
  end if;

  v_class := public.classify_attendance_mark(
    p_employee_id,
    v_perm.labor_date,
    v_mark_type,
    now()
  );

  if v_perm.open_entry_id is not null then
    select m.* into open_entry
    from public.attendance_marks m
    where m.id = v_perm.open_entry_id;
  else
    open_entry := null;
  end if;

  if v_perm.open_meal_id is not null then
    select m.* into open_meal
    from public.attendance_marks m
    where m.id = v_perm.open_meal_id;
  else
    open_meal := null;
  end if;

  if v_mark_type = 'regreso_comida' then
    meal_minutes := greatest(
      0,
      floor(extract(epoch from (now() - open_meal.marked_at)) / 60)::integer
    );
  end if;

  unrecognized_device := employee.authorized_attendance_device is not null
    and employee.authorized_attendance_device <> p_device_id;

  insert into public.attendance_marks (
    employee_id, employee_name, mark_type, photo_path, device_id, device_name, device_alert,
    related_mark_id, duration_minutes, observation,
    labor_date, classification, approval_status, schedule_exception_id, system_reason
  )
  values (
    employee.id, coalesce(employee.full_name, employee.username, 'Colaborador'),
    v_mark_type, trim(p_photo_path), trim(p_device_id), trim(p_device_name), unrecognized_device,
    case when v_mark_type = 'regreso_comida' then open_meal.id else open_entry.id end,
    meal_minutes,
    observation_text,
    v_perm.labor_date,
    v_class ->> 'classification',
    coalesce(v_class ->> 'approval_status', 'not_required'),
    nullif(v_class ->> 'schedule_exception_id', '')::uuid,
    v_class ->> 'system_reason'
  )
  returning * into mark;

  perform public.log_attendance_security_event(
    trim(p_device_id),
    employee.id,
    'authorized_mark_attempt',
    p_client_ip,
    user_agent,
    jsonb_build_object(
      'mark_type', v_mark_type,
      'mark_id', mark.id,
      'labor_date', v_perm.labor_date,
      'calendar_date', (now() at time zone 'America/Guatemala')::date,
      'classification', mark.classification,
      'approval_status', mark.approval_status,
      'permission_reason_code', v_perm.reason_code,
      'next_expected_mark', v_perm.next_expected_mark
    )
  );

  return mark;
end;
$$;

revoke all on function public.register_attendance_mark(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.register_attendance_mark(uuid, text, text, text, text, text, text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Unit tests: chain rules (no DB fixtures required)
-- ---------------------------------------------------------------------------
create or replace function public.test_attendance_mark_chain_rules()
returns table (
  scenario text,
  mark_type text,
  has_open_entry boolean,
  has_open_meal boolean,
  expected_allowed boolean,
  expected_reason_code text,
  passed boolean,
  detail text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_allowed boolean;
  v_reason_code text;
begin
  for v in
    select *
    from (
      values
        ('entrada normal', 'entrada', false, false, true, 'allowed'),
        ('entrada bloqueada por turno abierto', 'entrada', true, false, false, 'open_entry'),
        ('salida_comida permitida con entrada abierta', 'salida_comida', true, false, true, 'open_shift'),
        ('salida_comida bloqueada sin entrada', 'salida_comida', false, false, false, 'no_open_entry'),
        ('salida_comida bloqueada con comida abierta', 'salida_comida', true, true, false, 'open_meal'),
        ('regreso_comida permitido con comida abierta', 'regreso_comida', true, true, true, 'open_shift'),
        ('regreso_comida bloqueado sin comida', 'regreso_comida', true, false, false, 'no_open_meal'),
        ('salida_final permitida con entrada abierta', 'salida_final', true, false, true, 'open_shift'),
        ('salida_final bloqueada sin entrada', 'salida_final', false, false, false, 'no_open_entry'),
        ('salida_final bloqueada con comida abierta', 'salida_final', true, true, false, 'open_meal')
    ) as t(scenario, mark_type, has_open_entry, has_open_meal, expected_allowed, expected_reason_code)
  loop
    select c.allowed, c.reason_code
    into v_allowed, v_reason_code
    from public.evaluate_attendance_mark_chain(
      v.mark_type,
      v.has_open_entry,
      v.has_open_meal
    ) c;

    scenario := v.scenario;
    mark_type := v.mark_type;
    has_open_entry := v.has_open_entry;
    has_open_meal := v.has_open_meal;
    expected_allowed := v.expected_allowed;
    expected_reason_code := v.expected_reason_code;
    passed := v_allowed = v.expected_allowed and v_reason_code = v.expected_reason_code;
    detail := format(
      'got allowed=%s reason_code=%s',
      v_allowed,
      v_reason_code
    );
    return next;
  end loop;
end;
$$;

revoke all on function public.test_attendance_mark_chain_rules() from public;
grant execute on function public.test_attendance_mark_chain_rules() to authenticated;

-- ---------------------------------------------------------------------------
-- Integration diagnostic: permission vs marking_state alignment per employee
-- ---------------------------------------------------------------------------
create or replace function public.diagnose_attendance_mark_permission(
  p_employee_id uuid
)
returns table (
  mark_type text,
  permission_allowed boolean,
  permission_reason_code text,
  permission_reason text,
  marking_state_allowed boolean,
  marking_state_reason_code text,
  aligned boolean,
  has_open_entry boolean,
  has_open_meal boolean,
  next_expected_mark text,
  labor_date date,
  classification text,
  approval_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_perm public.attendance_mark_permission;
  v_state jsonb;
begin
  foreach v_type in array array['entrada', 'salida_comida', 'regreso_comida', 'salida_final']
  loop
    v_perm := public.resolve_attendance_mark_permission(p_employee_id, v_type, now());
    v_state := public.get_attendance_marking_state(p_employee_id, v_type);

    mark_type := v_type;
    permission_allowed := v_perm.allowed;
    permission_reason_code := v_perm.reason_code;
    permission_reason := v_perm.reason;
    marking_state_allowed := coalesce((v_state ->> 'allowed')::boolean, false);
    marking_state_reason_code := v_state ->> 'reason_code';
    aligned := v_perm.allowed = coalesce((v_state ->> 'allowed')::boolean, false);
    has_open_entry := v_perm.has_open_entry;
    has_open_meal := v_perm.has_open_meal;
    next_expected_mark := v_perm.next_expected_mark;
    labor_date := v_perm.labor_date;
    classification := v_perm.classification;
    approval_status := v_perm.approval_status;
    return next;
  end loop;
end;
$$;

revoke all on function public.diagnose_attendance_mark_permission(uuid) from public;
grant execute on function public.diagnose_attendance_mark_permission(uuid) to authenticated;
