-- Hotfix: list_recruitment_candidates must stay read-only (STABLE).
-- Purge moved out of list RPC; auto-purge only when discard history exists.

create or replace function public.purge_stale_discarded_recruitment_candidates(
  p_retention_days integer default 60
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'p_retention_days debe ser mayor o igual a 1.';
  end if;

  delete from public.recruitment_candidates c
  where c.pipeline_status = 'discarded'
    and not exists (
      select 1
      from public.recruitment_employee_origins o
      where o.candidate_id = c.id
    )
    and exists (
      select 1
      from public.recruitment_candidate_status_history h
      where h.candidate_id = c.id
        and h.to_status = 'discarded'
        and h.changed_at < now() - make_interval(days => p_retention_days)
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.list_recruitment_candidates(
  p_vacancy_id uuid default null,
  p_pipeline_status text default null,
  p_source text default null,
  p_area text default null,
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para consultar candidatos.';
  end if;

  select coalesce(jsonb_agg(row order by row ->> 'applied_at' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'phone', c.phone,
      'whatsapp', c.whatsapp,
      'vacancy_id', c.vacancy_id,
      'vacancy_title', v.position_title,
      'vacancy_area', v.area,
      'position_applied', c.position_applied,
      'source', c.source,
      'pipeline_status', c.pipeline_status,
      'applied_at', c.applied_at,
      'salary_expectation', c.salary_expectation,
      'schedule_availability', c.schedule_availability,
      'profile_id', c.profile_id,
      'onboarding_status', c.onboarding_status,
      'hire_date', c.hire_date,
      'converted_at', c.converted_at
    ) as row
    from public.recruitment_candidates c
    join public.recruitment_vacancies v on v.id = c.vacancy_id
    where (p_vacancy_id is null or c.vacancy_id = p_vacancy_id)
      and (p_pipeline_status is null or c.pipeline_status = p_pipeline_status)
      and (p_source is null or c.source = p_source)
      and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%')
      and (p_date_from is null or c.applied_at >= p_date_from)
      and (p_date_to is null or c.applied_at <= p_date_to)
  ) sub;

  return v_rows;
end;
$$;

grant execute on function public.purge_stale_discarded_recruitment_candidates(integer) to authenticated;
