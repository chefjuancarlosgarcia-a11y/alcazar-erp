-- Align operational status: pending_review is not "pendiente_atrasada" once submitted.
-- Apply after 107_checklist_operational_status_and_replacement.sql

create or replace function public.get_checklist_operational_status(
  p_run public.checklist_runs,
  p_at timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  due_at timestamptz;
  completed_at timestamptz := coalesce(p_run.completed_at, p_run.submitted_at);
begin
  if p_run.status = 'completed' then
    due_at := public.get_checklist_expected_due_at(p_run);
    if p_run.completion_timing = 'on_time' then
      return 'completada_a_tiempo';
    elsif p_run.completion_timing = 'late' then
      return 'completada_tarde';
    elsif due_at is not null and completed_at is not null and completed_at <= due_at then
      return 'completada_a_tiempo';
    elsif due_at is not null and completed_at is not null then
      return 'completada_tarde';
    end if;
    return 'completada_a_tiempo';
  end if;

  if p_run.status = 'pending_review' then
    return 'pendiente_revision';
  end if;

  if p_run.status = 'overdue'
    or (
      p_run.status in ('pending', 'in_progress', 'rejected')
      and not public.is_checklist_operational_window_open(p_run.run_date, p_at)
    ) then
    return 'vencida';
  end if;

  due_at := public.get_checklist_expected_due_at(p_run);
  if due_at is not null and p_at > due_at then
    return 'pendiente_atrasada';
  end if;

  return 'pendiente';
end;
$$;

revoke all on function public.get_checklist_operational_status(public.checklist_runs, timestamptz) from public;
grant execute on function public.get_checklist_operational_status(public.checklist_runs, timestamptz) to authenticated;
