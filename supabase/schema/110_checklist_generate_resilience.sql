-- Harden generate_due_checklist_runs: skip broken templates instead of aborting the batch.

create or replace function public.generate_due_checklist_runs(
  p_target_date date default public.get_checklist_operational_date()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  generated_count integer := 0;
begin
  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para generar checklists recurrentes.';
  end if;

  for template_row in
    select * from public.checklist_templates
    where status = 'active'
      and public.checklist_template_should_auto_generate(checklist_templates)
      and public.checklist_template_due_on_date(checklist_templates, p_target_date)
  loop
    begin
      perform public.create_checklist_run_from_template(
        template_row.id,
        p_target_date,
        'recurrence',
        null,
        'Generada automaticamente',
        template_row.area,
        template_row.assigned_role
      );
      generated_count := generated_count + 1;
    exception when others then
      raise warning 'generate_due_checklist_runs template % failed: %', template_row.id, sqlerrm;
    end;
  end loop;

  return generated_count;
end;
$$;

revoke all on function public.generate_due_checklist_runs(date) from public;
grant execute on function public.generate_due_checklist_runs(date) to authenticated;
