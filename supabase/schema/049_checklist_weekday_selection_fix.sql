-- Normalize weekly checklist weekday selection semantics.
-- Apply after 048_sales_goals_and_motivational_reports.sql.

update public.checklist_templates
set
  recurrence_days = array[1, 2, 3, 4, 5, 6, 7]::integer[],
  recurrence_rule = coalesce(nullif(trim(recurrence_rule), ''), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU')
where frequency = 'semanal'
  and auto_generate = true
  and coalesce(array_length(recurrence_days, 1), 0) = 0;

update public.checklist_template_change_requests
set
  recurrence_days = array[1, 2, 3, 4, 5, 6, 7]::integer[],
  recurrence_rule = coalesce(nullif(trim(recurrence_rule), ''), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU')
where frequency = 'semanal'
  and auto_generate = true
  and coalesce(array_length(recurrence_days, 1), 0) = 0;

create or replace function public.checklist_template_due_on_date(p_template public.checklist_templates, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_template.status <> 'active' or not p_template.auto_generate then false
    when p_template.frequency = 'diaria' then true
    when p_template.frequency = 'semanal' then
      coalesce(array_length(p_template.recurrence_days, 1), 0) > 0
      and extract(isodow from p_date)::integer = any(p_template.recurrence_days)
    when p_template.frequency = 'mensual' then
      coalesce(p_template.recurrence_month_day, 1) = extract(day from p_date)::integer
    when p_template.frequency in ('apertura', 'cierre', 'por_turno') then true
    else false
  end;
$$;
