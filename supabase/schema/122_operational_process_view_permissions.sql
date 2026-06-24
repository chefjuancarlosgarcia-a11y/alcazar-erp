-- Operational process view permissions: managerial/supervisory only, not operational staff.
-- Apply after 121_operational_process_auto_schedule.sql.

create or replace function public.operational_process_areas_match(p_left text, p_right text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(trim(coalesce(p_left, '')), '') is not null
    and nullif(trim(coalesce(p_right, '')), '') is not null
    and lower(trim(p_left)) = lower(trim(p_right));
$$;

create or replace function public.can_view_operational_process_groups()
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
      and public.normalize_profile_role(role) in (
        'admin', 'gerente_general', 'gerente',
        'recursos_humanos', 'rrhh',
        'supervisor', 'encargado_area'
      )
  );
$$;

create or replace function public.can_read_operational_process_template(p_template public.operational_process_templates)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_operational_process_manager()
    or (
      public.can_view_operational_process_groups()
      and p_template.status = 'active'
      and (
        p_template.supervisor_profile_id = auth.uid()
        or public.operational_process_areas_match(
          p_template.area,
          (select pr.area_name from public.profiles pr where pr.id = auth.uid())
        )
        or (
          public.normalize_profile_role(public.current_profile_role()) = 'supervisor'
          and nullif(trim(coalesce(p_template.area, '')), '') is null
        )
      )
    );
$$;

create or replace function public.can_access_operational_process_run(p_run public.operational_process_runs)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_operational_process_manager()
    or (
      public.can_view_operational_process_groups()
      and exists (
        select 1
        from public.operational_process_templates t
        where t.id = p_run.process_template_id
          and (
            t.supervisor_profile_id = auth.uid()
            or public.operational_process_areas_match(
              coalesce(nullif(trim(p_run.area), ''), t.area),
              (select pr.area_name from public.profiles pr where pr.id = auth.uid())
            )
            or (
              public.normalize_profile_role(public.current_profile_role()) = 'supervisor'
              and nullif(trim(coalesce(coalesce(nullif(trim(p_run.area), ''), t.area), '')), '') is null
            )
          )
      )
    );
$$;

create or replace function public.get_operational_process_runs_for_date(p_run_date date default public.get_checklist_operational_date())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
begin
  if not public.can_view_operational_process_groups() then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(
    public.get_operational_process_run_detail(r.id)
    order by (r.process_template_id), r.created_at
  ), '[]'::jsonb)
  into v_rows
  from public.operational_process_runs r
  where r.run_date = p_run_date
    and r.status <> 'cancelled'
    and public.can_access_operational_process_run(r);

  return v_rows;
end;
$$;

create or replace function public.get_operational_process_templates_library()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.can_view_operational_process_groups() then
    raise exception 'No tienes permiso para consultar procesos operativos.';
  end if;

  select coalesce(jsonb_agg(row order by row ->> 'title'), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'description', t.description,
      'area', t.area,
      'process_type', t.process_type,
      'completion_mode', t.completion_mode,
      'allow_parallel_execution', t.allow_parallel_execution,
      'status', t.status,
      'supervisor_profile_id', t.supervisor_profile_id,
      'frequency_type', coalesce(t.frequency_type, 'manual'),
      'recurrence_days', coalesce(t.recurrence_days, '{}'::integer[]),
      'recurrence_month_day', t.recurrence_month_day,
      'step_count', (
        select count(*) from public.operational_process_template_steps s
        where s.process_template_id = t.id
      ),
      'created_at', t.created_at,
      'updated_at', t.updated_at
    ) as row
    from public.operational_process_templates t
    where public.can_read_operational_process_template(t)
    order by t.title
  ) sub;

  return v_rows;
end;
$$;

revoke all on function public.operational_process_areas_match(text, text) from public;
grant execute on function public.operational_process_areas_match(text, text) to authenticated;

revoke all on function public.can_view_operational_process_groups() from public;
grant execute on function public.can_view_operational_process_groups() to authenticated;

revoke all on function public.can_read_operational_process_template(public.operational_process_templates) from public;
grant execute on function public.can_read_operational_process_template(public.operational_process_templates) to authenticated;

revoke all on function public.can_access_operational_process_run(public.operational_process_runs) from public;
grant execute on function public.can_access_operational_process_run(public.operational_process_runs) to authenticated;

revoke all on function public.get_operational_process_runs_for_date(date) from public;
grant execute on function public.get_operational_process_runs_for_date(date) to authenticated;

revoke all on function public.get_operational_process_templates_library() from public;
grant execute on function public.get_operational_process_templates_library() to authenticated;
