-- Align checklist_template_due_on_date with checklist_template_should_auto_generate (109).
-- Daily/weekly templates were skipped when auto_generate=false even though should_auto_generate matched.

create or replace function public.checklist_template_due_on_date(p_template public.checklist_templates, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_template.status <> 'active' then false
    when not public.checklist_template_should_auto_generate(p_template) then false
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

revoke all on function public.checklist_template_due_on_date(public.checklist_templates, date) from public;
grant execute on function public.checklist_template_due_on_date(public.checklist_templates, date) to authenticated;
