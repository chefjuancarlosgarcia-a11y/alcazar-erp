-- Align get_open_attendance_shifts with resolve_attendance_context open-entry detection.
-- Apply after 153_attendance_terminal_diagnostics.sql.

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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz constant text := 'America/Guatemala';
  v_calendar_date date := (now() at time zone v_tz)::date;
begin
  if not public.is_schedule_publisher() then
    return;
  end if;

  return query
  with open_entries as (
    select distinct on (m.employee_id)
      m.id as entrada_id,
      m.employee_id,
      m.employee_name,
      m.marked_at as entrada_at,
      coalesce(m.labor_date, (m.marked_at at time zone v_tz)::date) as labor_date,
      m.classification,
      m.approval_status
    from public.attendance_marks m
    where m.mark_type = 'entrada'
      and not exists (
        select 1
        from public.attendance_marks out_mark
        where out_mark.employee_id = m.employee_id
          and out_mark.mark_type in ('salida_final', 'salida')
          and out_mark.marked_at > m.marked_at
      )
    order by m.employee_id, m.marked_at desc
  ),
  open_meals as (
    select distinct on (oe.employee_id)
      oe.employee_id,
      m.id as meal_id,
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
    v_calendar_date,
    oe.labor_date < v_calendar_date,
    om.meal_id is not null,
    om.meal_started_at,
    oe.classification,
    oe.approval_status
  from open_entries oe
  join public.profiles p on p.id = oe.employee_id
  left join open_meals om on om.employee_id = oe.employee_id
  order by oe.entrada_at;
end;
$$;

revoke all on function public.get_open_attendance_shifts() from public;
grant execute on function public.get_open_attendance_shifts() to authenticated;
