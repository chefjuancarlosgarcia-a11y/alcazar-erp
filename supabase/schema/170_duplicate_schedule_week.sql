-- Atomic weekly schedule duplication for HR (replaces client-side fail-fast loop).
-- Apply after 169_pos_pizza_variant_recipe_inventory_gate.sql.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_schedule_week_monday(p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(isodow from p_date) = 1;
$$;

create or replace function public.normalize_employee_schedule_fields(
  p_shift_type_id uuid,
  p_shift_type text,
  p_is_work_day boolean,
  p_area text,
  p_start_time time,
  p_end_time time,
  p_break_minutes integer,
  p_position text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_shift public.shift_types;
  v_is_work_day boolean := coalesce(p_is_work_day, true);
  v_shift_type text := coalesce(nullif(trim(p_shift_type), ''), 'full');
  v_shift_type_id uuid := p_shift_type_id;
  v_non_work_area text;
  v_area text;
begin
  if v_shift_type_id is not null then
    select * into selected_shift from public.shift_types where id = v_shift_type_id;
    if selected_shift.id is null or selected_shift.status <> 'active' then
      raise exception 'Tipo de turno invalido.';
    end if;
    v_is_work_day := selected_shift.counts_as_workday
      and not selected_shift.is_rest_day
      and not selected_shift.is_holiday;
    v_shift_type := selected_shift.id::text;
  elsif v_shift_type in ('rest', 'asueto') then
    v_is_work_day := false;
  end if;

  v_non_work_area := case
    when not v_is_work_day and selected_shift.id is not null then trim(selected_shift.name)
    when selected_shift.is_holiday or v_shift_type = 'asueto' then 'Asueto'
    when selected_shift.is_rest_day or v_shift_type = 'rest' then 'Descanso'
    else coalesce(nullif(trim(p_area), ''), 'Descanso')
  end;

  if v_is_work_day and (
    nullif(trim(p_area), '') is null
    or p_start_time is null
    or p_end_time is null
  ) then
    raise exception 'Area, entrada y salida son obligatorios para dias laborales.';
  end if;

  v_area := case when v_is_work_day then trim(p_area) else v_non_work_area end;

  return jsonb_build_object(
    'is_work_day', v_is_work_day,
    'shift_type', v_shift_type,
    'shift_type_id', v_shift_type_id,
    'area', v_area,
    'position', case when v_is_work_day then nullif(trim(p_position), '') else null end,
    'start_time', case when v_is_work_day then p_start_time else null end,
    'end_time', case when v_is_work_day then p_end_time else null end,
    'break_minutes', case when v_is_work_day then greatest(0, coalesce(p_break_minutes, 0)) else 0 end
  );
end;
$$;

create or replace function public.save_employee_schedule(p_data jsonb)
returns public.employee_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.employee_schedules;
  saved public.employee_schedules;
  schedule_id uuid;
  v_employee_id uuid := (p_data ->> 'employee_id')::uuid;
  v_shift_type_id uuid := nullif(p_data ->> 'shift_type_id', '')::uuid;
  v_is_work_day boolean := coalesce((p_data ->> 'is_work_day')::boolean, true);
  v_shift_type text := coalesce(nullif(p_data ->> 'shift_type', ''), 'full');
  normalized jsonb;
begin
  if not public.is_schedule_editor() then
    raise exception 'No tienes permiso para editar horarios.';
  end if;
  if v_employee_id is null then
    raise exception 'Colaborador es obligatorio.';
  end if;

  normalized := public.normalize_employee_schedule_fields(
    v_shift_type_id,
    v_shift_type,
    v_is_work_day,
    p_data ->> 'area',
    nullif(p_data ->> 'start_time', '')::time,
    nullif(p_data ->> 'end_time', '')::time,
    coalesce((p_data ->> 'break_minutes')::integer, 0),
    p_data ->> 'position'
  );

  schedule_id := nullif(p_data ->> 'id', '')::uuid;
  if schedule_id is not null then
    select * into existing from public.employee_schedules where id = schedule_id;
    if existing.id is null then raise exception 'Turno no encontrado.'; end if;
    if existing.status = 'published' and not public.is_schedule_publisher() then
      raise exception 'Solo Admin, Gerente General o RRHH pueden editar un horario publicado.';
    end if;
    update public.employee_schedules set
      employee_id = v_employee_id,
      area = normalized ->> 'area',
      position = nullif(normalized ->> 'position', ''),
      shift_date = (p_data ->> 'shift_date')::date,
      start_time = nullif(normalized ->> 'start_time', '')::time,
      end_time = nullif(normalized ->> 'end_time', '')::time,
      break_minutes = (normalized ->> 'break_minutes')::integer,
      notes = nullif(trim(p_data ->> 'notes'), ''),
      day_notes = nullif(trim(coalesce(p_data ->> 'day_notes', p_data ->> 'notes')), ''),
      is_work_day = (normalized ->> 'is_work_day')::boolean,
      shift_type = normalized ->> 'shift_type',
      shift_type_id = nullif(normalized ->> 'shift_type_id', '')::uuid,
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
      normalized ->> 'area',
      nullif(normalized ->> 'position', ''),
      (p_data ->> 'shift_date')::date,
      nullif(normalized ->> 'start_time', '')::time,
      nullif(normalized ->> 'end_time', '')::time,
      (normalized ->> 'break_minutes')::integer,
      nullif(trim(p_data ->> 'notes'), ''),
      'draft', auth.uid(), auth.uid(),
      (normalized ->> 'is_work_day')::boolean,
      normalized ->> 'shift_type',
      nullif(normalized ->> 'shift_type_id', '')::uuid,
      greatest(1, coalesce((p_data ->> 'block_order')::integer, 1)),
      nullif(trim(coalesce(p_data ->> 'day_notes', p_data ->> 'notes')), '')
    ) returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, new_value)
    values (saved.id, auth.uid(), 'created', to_jsonb(saved));
  end if;
  return saved;
end;
$$;

create or replace function public.duplicate_schedule_week(
  p_source_week_start date,
  p_target_week_start date,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_start date := p_source_week_start;
  v_target_start date := p_target_week_start;
  v_source_end date;
  v_target_end date;
  v_day_offset integer;
  v_destination_mode text := coalesce(nullif(trim(p_options ->> 'destination_mode'), ''), 'replace_drafts');
  v_dry_run boolean := coalesce((p_options ->> 'dry_run')::boolean, false);
  v_skip_inactive boolean := coalesce((p_options ->> 'skip_inactive_employees')::boolean, false);
  v_copy_statuses text[] := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_options -> 'copy_statuses', '["draft","published"]'::jsonb))),
    array['draft', 'published']
  );
  v_row public.employee_schedules;
  v_profile public.profiles;
  v_shift_type public.shift_types;
  v_normalized jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_source_by_day jsonb := '{}'::jsonb;
  v_copied_by_day jsonb := '{}'::jsonb;
  v_target_existing jsonb;
  v_target_draft_count integer := 0;
  v_target_published_count integer := 0;
  v_total_source integer := 0;
  v_copied_count integer := 0;
  v_skipped_count integer := 0;
  v_deleted_draft_count integer := 0;
  v_distinct_source_days integer := 0;
  v_day_key text;
  v_day_count integer;
  v_error jsonb;
  v_label text;
begin
  if not public.is_schedule_editor() then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'permission_denied',
        'severity', 'blocking',
        'message', 'No tienes permiso para duplicar horarios.'
      ))
    );
  end if;

  if not public.is_schedule_week_monday(v_source_start) or not public.is_schedule_week_monday(v_target_start) then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'invalid_week_start',
        'severity', 'blocking',
        'message', 'La semana origen y destino deben iniciar en lunes.'
      ))
    );
  end if;

  if v_source_start = v_target_start then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'same_week',
        'severity', 'blocking',
        'message', 'La semana destino debe ser distinta a la semana origen.'
      ))
    );
  end if;

  v_source_end := v_source_start + 6;
  v_target_end := v_target_start + 6;
  v_day_offset := v_target_start - v_source_start;

  perform pg_advisory_xact_lock(hashtext('duplicate_schedule_week:' || v_target_start::text));

  select
    count(*) filter (where status = 'draft'),
    count(*) filter (where status = 'published'),
    count(*)
  into v_target_draft_count, v_target_published_count, v_day_count
  from public.employee_schedules
  where shift_date between v_target_start and v_target_end;

  v_target_existing := jsonb_build_object(
    'draft', v_target_draft_count,
    'published', v_target_published_count,
    'total', v_target_draft_count + v_target_published_count
  );

  if v_target_published_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', v_dry_run,
      'source_week_start', v_source_start,
      'target_week_start', v_target_start,
      'destination_mode', v_destination_mode,
      'total_source', 0,
      'copied_count', 0,
      'skipped_count', 0,
      'target_existing_before', v_target_existing,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'target_has_published',
        'severity', 'blocking',
        'message', 'La semana destino ya tiene horarios publicados. Desbloquea la edicion o elige otra semana.'
      ))
    );
  end if;

  if v_destination_mode = 'block' and (v_target_draft_count + v_target_published_count) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', v_dry_run,
      'source_week_start', v_source_start,
      'target_week_start', v_target_start,
      'destination_mode', v_destination_mode,
      'total_source', 0,
      'copied_count', 0,
      'skipped_count', 0,
      'target_existing_before', v_target_existing,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'destination_blocked',
        'severity', 'blocking',
        'message', 'La semana destino ya tiene horarios. Usa reemplazar borradores o vacia la semana.'
      ))
    );
  end if;

  for v_row in
    select s.*
    from public.employee_schedules s
    where s.shift_date between v_source_start and v_source_end
      and s.status = any (v_copy_statuses)
    order by s.shift_date, s.employee_id, s.block_order, s.start_time nulls last
  loop
    v_total_source := v_total_source + 1;
    v_day_key := v_row.shift_date::text;
    v_source_by_day := v_source_by_day || jsonb_build_object(
      v_day_key,
      coalesce((v_source_by_day ->> v_day_key)::integer, 0) + 1
    );

    select * into v_profile from public.profiles where id = v_row.employee_id;
    v_label := coalesce(v_profile.full_name, v_profile.username, 'Colaborador');

    if v_profile.id is null or v_profile.status <> 'active' then
      if v_skip_inactive then
        v_skipped_count := v_skipped_count + 1;
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'inactive_employee_skipped',
          'message', format('Se omitio un bloque de %s el %s.', v_label, to_char(v_row.shift_date, 'DD Mon')),
          'employee_id', v_row.employee_id,
          'shift_date', v_row.shift_date,
          'schedule_id', v_row.id
        ));
        continue;
      end if;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'inactive_employee',
        'severity', 'blocking',
        'message', format('%s esta inactivo pero tiene turnos en la semana origen (%s).', v_label, to_char(v_row.shift_date, 'DD Mon')),
        'employee_id', v_row.employee_id,
        'shift_date', v_row.shift_date,
        'schedule_id', v_row.id
      ));
      continue;
    end if;

    if v_row.shift_type_id is not null then
      select * into v_shift_type from public.shift_types where id = v_row.shift_type_id;
      if v_shift_type.id is null or v_shift_type.status <> 'active' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'inactive_shift_type',
          'severity', 'blocking',
          'message', format('%s tiene un tipo de turno inactivo el %s.', v_label, to_char(v_row.shift_date, 'DD Mon')),
          'employee_id', v_row.employee_id,
          'shift_date', v_row.shift_date,
          'schedule_id', v_row.id,
          'shift_type_id', v_row.shift_type_id
        ));
        continue;
      end if;
    elsif coalesce(v_row.is_work_day, true) and v_row.shift_type not in ('rest', 'asueto') then
      if nullif(trim(v_row.area), '') is null or v_row.start_time is null or v_row.end_time is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'invalid_work_shift',
          'severity', 'blocking',
          'message', format('%s tiene un turno laboral incompleto el %s.', v_label, to_char(v_row.shift_date, 'DD Mon')),
          'employee_id', v_row.employee_id,
          'shift_date', v_row.shift_date,
          'schedule_id', v_row.id
        ));
        continue;
      end if;
    end if;

    begin
      v_normalized := public.normalize_employee_schedule_fields(
        v_row.shift_type_id,
        v_row.shift_type,
        v_row.is_work_day,
        v_row.area,
        v_row.start_time,
        v_row.end_time,
        v_row.break_minutes,
        v_row.position
      );
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'normalize_failed',
        'severity', 'blocking',
        'message', format('%s el %s: %s', v_label, to_char(v_row.shift_date, 'DD Mon'), sqlerrm),
        'employee_id', v_row.employee_id,
        'shift_date', v_row.shift_date,
        'schedule_id', v_row.id
      ));
      continue;
    end;

    v_copied_count := v_copied_count + 1;
    v_day_key := (v_row.shift_date + v_day_offset)::text;
    v_copied_by_day := v_copied_by_day || jsonb_build_object(
      v_day_key,
      coalesce((v_copied_by_day ->> v_day_key)::integer, 0) + 1
    );
  end loop;

  select count(distinct shift_date) into v_distinct_source_days
  from public.employee_schedules
  where shift_date between v_source_start and v_source_end
    and status = any (v_copy_statuses);

  if v_total_source = 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', v_dry_run,
      'source_week_start', v_source_start,
      'target_week_start', v_target_start,
      'destination_mode', v_destination_mode,
      'total_source', 0,
      'copied_count', 0,
      'skipped_count', 0,
      'target_existing_before', v_target_existing,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'source_empty',
        'severity', 'blocking',
        'message', 'La semana origen no tiene horarios para copiar.'
      ))
    );
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', v_dry_run,
      'source_week_start', v_source_start,
      'target_week_start', v_target_start,
      'destination_mode', v_destination_mode,
      'total_source', v_total_source,
      'copied_count', 0,
      'skipped_count', v_skipped_count,
      'deleted_draft_count', 0,
      'target_existing_before', v_target_existing,
      'source_by_day', v_source_by_day,
      'copied_by_day', '{}'::jsonb,
      'errors', v_errors,
      'warnings', v_warnings
    );
  end if;

  if v_distinct_source_days > 0 and v_distinct_source_days < 7 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'source_partial_week',
      'message', format('La semana origen solo tiene planificacion en %s dias distintos.', v_distinct_source_days)
    ));
  end if;

  if v_dry_run then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'source_week_start', v_source_start,
      'target_week_start', v_target_start,
      'destination_mode', v_destination_mode,
      'total_source', v_total_source,
      'copied_count', v_copied_count,
      'skipped_count', v_skipped_count,
      'deleted_draft_count', case when v_destination_mode = 'replace_drafts' then v_target_draft_count else 0 end,
      'target_existing_before', v_target_existing,
      'source_by_day', v_source_by_day,
      'copied_by_day', v_copied_by_day,
      'errors', '[]'::jsonb,
      'warnings', v_warnings
    );
  end if;

  if v_destination_mode = 'replace_drafts' and v_target_draft_count > 0 then
    delete from public.employee_schedules
    where shift_date between v_target_start and v_target_end
      and status = 'draft';
    get diagnostics v_deleted_draft_count = row_count;
  end if;

  for v_row in
    select s.*
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id and p.status = 'active'
    where s.shift_date between v_source_start and v_source_end
      and s.status = any (v_copy_statuses)
    order by s.shift_date, s.employee_id, s.block_order, s.start_time nulls last
  loop
    if v_skip_inactive then
      -- inactive already filtered by join
      null;
    end if;

    v_normalized := public.normalize_employee_schedule_fields(
      v_row.shift_type_id,
      v_row.shift_type,
      v_row.is_work_day,
      v_row.area,
      v_row.start_time,
      v_row.end_time,
      v_row.break_minutes,
      v_row.position
    );

    insert into public.employee_schedules (
      employee_id, area, position, shift_date, start_time, end_time, break_minutes, notes,
      status, created_by, updated_by, is_work_day, shift_type, shift_type_id, block_order, day_notes
    ) values (
      v_row.employee_id,
      v_normalized ->> 'area',
      nullif(v_normalized ->> 'position', ''),
      v_row.shift_date + v_day_offset,
      nullif(v_normalized ->> 'start_time', '')::time,
      nullif(v_normalized ->> 'end_time', '')::time,
      (v_normalized ->> 'break_minutes')::integer,
      v_row.notes,
      'draft', auth.uid(), auth.uid(),
      (v_normalized ->> 'is_work_day')::boolean,
      v_normalized ->> 'shift_type',
      nullif(v_normalized ->> 'shift_type_id', '')::uuid,
      greatest(1, coalesce(v_row.block_order, 1)),
      v_row.day_notes
    );
  end loop;

  insert into public.schedule_change_logs (schedule_id, changed_by, change_type, new_value)
  values (
    null,
    auth.uid(),
    'week_duplicated',
    jsonb_build_object(
      'source_week_start', v_source_start,
      'target_week_start', v_target_start,
      'destination_mode', v_destination_mode,
      'total_source', v_total_source,
      'copied_count', v_copied_count,
      'skipped_count', v_skipped_count,
      'deleted_draft_count', v_deleted_draft_count,
      'source_by_day', v_source_by_day,
      'copied_by_day', v_copied_by_day
    )
  );

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'source_week_start', v_source_start,
    'target_week_start', v_target_start,
    'destination_mode', v_destination_mode,
    'total_source', v_total_source,
    'copied_count', v_copied_count,
    'skipped_count', v_skipped_count,
    'deleted_draft_count', v_deleted_draft_count,
    'target_existing_before', v_target_existing,
    'source_by_day', v_source_by_day,
    'copied_by_day', v_copied_by_day,
    'errors', '[]'::jsonb,
    'warnings', v_warnings
  );
end;
$$;

revoke all on function public.is_schedule_week_monday(date) from public;
revoke all on function public.normalize_employee_schedule_fields(uuid, text, boolean, text, time without time zone, time without time zone, integer, text) from public;
revoke all on function public.duplicate_schedule_week(date, date, jsonb) from public;

grant execute on function public.is_schedule_week_monday(date) to authenticated;
grant execute on function public.normalize_employee_schedule_fields(uuid, text, boolean, text, time without time zone, time without time zone, integer, text) to authenticated;
grant execute on function public.duplicate_schedule_week(date, date, jsonb) to authenticated;
