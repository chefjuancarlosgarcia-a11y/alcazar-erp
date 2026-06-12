-- Restrict checklist permanent delete to admin and gerente_general only.
-- Apply after 069_checklist_force_delete.sql.

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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
  );
$$;

grant execute on function public.is_checklist_template_deleter() to authenticated;
