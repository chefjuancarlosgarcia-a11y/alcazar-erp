-- Non-work schedule blocks (vacaciones, permiso, descanso, etc.) must not store work times or employee area.
-- Apply after 061_fix_schedule_attendance_shift_windows.sql.

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
    when not v_is_work_day and selected_shift.id is not null then trim(selected_shift.name)
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
      start_time = case when v_is_work_day then nullif(p_data ->> 'start_time', '')::time else null end,
      end_time = case when v_is_work_day then nullif(p_data ->> 'end_time', '')::time else null end,
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
      case when v_is_work_day then nullif(p_data ->> 'start_time', '')::time else null end,
      case when v_is_work_day then nullif(p_data ->> 'end_time', '')::time else null end,
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

update public.employee_schedules s
set
  is_work_day = false,
  start_time = null,
  end_time = null,
  break_minutes = 0,
  position = null,
  area = st.name
from public.shift_types st
where s.shift_type_id = st.id
  and not st.counts_as_workday
  and (
    s.is_work_day = true
    or s.start_time is not null
    or s.end_time is not null
    or s.break_minutes <> 0
    or coalesce(s.area, '') <> st.name
  );

update public.employee_schedules
set
  is_work_day = false,
  start_time = null,
  end_time = null,
  break_minutes = 0,
  position = null,
  area = case when shift_type = 'asueto' then 'Asueto' else 'Descanso' end
where shift_type_id is null
  and shift_type in ('rest', 'asueto')
  and (
    is_work_day = true
    or start_time is not null
    or end_time is not null
    or break_minutes <> 0
  );

revoke all on function public.save_employee_schedule(jsonb) from public;
grant execute on function public.save_employee_schedule(jsonb) to authenticated;
