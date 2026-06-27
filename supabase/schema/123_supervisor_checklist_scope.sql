-- Scope supervisor / encargado_area checklist access to area, responsibility, and assignments.
-- Apply after 122_operational_process_view_permissions.sql.

create or replace function public.checklist_areas_match(p_left text, p_right text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    nullif(trim(coalesce(p_left, '')), '') is not null
    and nullif(trim(coalesce(p_right, '')), '') is not null
    and (
      lower(trim(p_left)) = lower(trim(p_right))
      or (
        lower(trim(p_left)) = 'cocina'
        and lower(trim(p_right)) like '%cocina%'
      )
      or (
        lower(trim(p_right)) = 'cocina'
        and lower(trim(p_left)) like '%cocina%'
      )
    );
$$;

create or replace function public.is_checklist_run_in_visible_operational_process(p_run_id uuid, p_profile_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.operational_process_run_steps oprs
    join public.operational_process_runs opr on opr.id = oprs.process_run_id
    join public.operational_process_templates opt on opt.id = opr.process_template_id
    where oprs.checklist_run_id = p_run_id
      and (
        opt.supervisor_profile_id = auth.uid()
        or public.operational_process_areas_match(
          coalesce(nullif(trim(opr.area), ''), opt.area),
          p_profile_area
        )
        or public.is_operational_process_manager()
      )
  );
$$;

create or replace function public.can_access_checklist_run(p_run public.checklist_runs)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.status = 'active'
      and (
        public.normalize_profile_role(pr.role) in (
          'admin', 'gerente_general', 'gerente', 'recursos_humanos', 'rrhh'
        )
        or p_run.assigned_profile_id = auth.uid()
        or p_run.original_assigned_profile_id = auth.uid()
        or p_run.supervisor_profile_id = auth.uid()
        or exists (
          select 1
          from public.checklist_templates ct
          where ct.id = p_run.template_id
            and ct.supervisor_profile_id = auth.uid()
        )
        or public.is_checklist_run_in_visible_operational_process(p_run.id, pr.area_name)
        or (
          public.normalize_profile_role(pr.role) not in ('supervisor', 'encargado_area')
          and (
            public.normalize_profile_role(pr.role) = public.normalize_profile_role(p_run.assigned_role)
            or public.checklist_areas_match(p_run.area, pr.area_name)
          )
        )
        or (
          public.normalize_profile_role(pr.role) in ('supervisor', 'encargado_area')
          and (
            public.checklist_areas_match(p_run.area, pr.area_name)
            or (
              p_run.assigned_profile_id is null
              and p_run.assigned_role is not null
              and public.normalize_profile_role(p_run.assigned_role) = public.normalize_profile_role(pr.role)
              and public.checklist_areas_match(p_run.area, pr.area_name)
            )
            or exists (
              select 1
              from public.profiles ap
              where ap.id = p_run.assigned_profile_id
                and (
                  ap.supervisor_profile_id = auth.uid()
                  or public.checklist_areas_match(ap.area_name, pr.area_name)
                )
            )
          )
        )
      )
  );
$$;

revoke all on function public.checklist_areas_match(text, text) from public;
grant execute on function public.checklist_areas_match(text, text) to authenticated;

revoke all on function public.is_checklist_run_in_visible_operational_process(uuid, text) from public;
grant execute on function public.is_checklist_run_in_visible_operational_process(uuid, text) to authenticated;

revoke all on function public.can_access_checklist_run(public.checklist_runs) from public;
grant execute on function public.can_access_checklist_run(public.checklist_runs) to authenticated;
