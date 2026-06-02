-- Delete permissions for checklist templates.
-- Apply after 030_checklist_notifications.sql.

grant delete on public.checklist_templates to authenticated;

create or replace function public.is_checklist_template_deleter()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente')
  );
$$;

drop policy if exists "checklist_templates_managers_delete" on public.checklist_templates;
create policy "checklist_templates_managers_delete"
  on public.checklist_templates for delete to authenticated
  using (public.is_checklist_template_deleter());

revoke all on function public.is_checklist_template_deleter() from public;
grant execute on function public.is_checklist_template_deleter() to authenticated;
