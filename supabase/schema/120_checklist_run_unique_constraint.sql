-- One checklist run per template + operational date (regardless of assignee).
-- Apply after 119_checklist_pending_review_display_status.sql.

-- ---------------------------------------------------------------------------
-- Phase 1: Diagnostic queries (run manually before/after cleanup)
-- ---------------------------------------------------------------------------
/*
-- Duplicates grouped by template + run_date (active runs only)
SELECT
  r.template_id,
  t.title,
  r.run_date,
  COUNT(*) AS duplicate_count,
  array_agg(r.id ORDER BY r.created_at) AS run_ids,
  array_agg(r.status ORDER BY r.created_at) AS statuses,
  array_agg(COALESCE(r.assigned_profile_id::text, 'NO_PROFILE') ORDER BY r.created_at) AS profiles,
  array_agg(r.created_at ORDER BY r.created_at) AS created_at
FROM public.checklist_runs r
LEFT JOIN public.checklist_templates t ON t.id = r.template_id
WHERE r.status <> 'cancelled'
GROUP BY r.template_id, t.title, r.run_date
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, r.run_date DESC, t.title;

-- Detail for a specific template title / date
SELECT
  r.id,
  r.template_id,
  t.title,
  r.run_date,
  r.status,
  r.assigned_profile_id,
  r.assigned_role,
  r.area,
  r.earned_points,
  r.total_points,
  (
    SELECT count(*)
    FROM public.checklist_run_items ri
    WHERE ri.run_id = r.id
      AND public.checklist_run_item_has_answer(ri)
  ) AS answered_items,
  r.created_at
FROM public.checklist_runs r
JOIN public.checklist_templates t ON t.id = r.template_id
WHERE r.status <> 'cancelled'
  AND t.title ILIKE '%Panadería%Apertura%'
  AND r.run_date = public.get_checklist_operational_date()
ORDER BY r.created_at;
*/

-- ---------------------------------------------------------------------------
-- Helpers: transactional lock + answer count for dedupe ranking
-- ---------------------------------------------------------------------------

create or replace function public.checklist_run_template_date_lock(
  p_template_id uuid,
  p_run_date date
)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtext('checklist_run:' || p_template_id::text || '|' || p_run_date::text)
  );
$$;

create or replace function public.checklist_run_answered_item_count(p_run_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.checklist_run_items ri
  where ri.run_id = p_run_id
    and public.checklist_run_item_has_answer(ri);
$$;

revoke all on function public.checklist_run_template_date_lock(uuid, date) from public;
grant execute on function public.checklist_run_template_date_lock(uuid, date) to authenticated;

revoke all on function public.checklist_run_answered_item_count(uuid) from public;
grant execute on function public.checklist_run_answered_item_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 2: Conservative cleanup — cancel lower-priority duplicates (no deletes)
-- Priority: answered items > earned_points > status > oldest created_at
-- ---------------------------------------------------------------------------

do $$
declare
  v_cancelled integer := 0;
begin
  with duplicate_groups as (
    select template_id, run_date
    from public.checklist_runs
    where status <> 'cancelled'
    group by template_id, run_date
    having count(*) > 1
  ),
  ranked as (
    select
      r.id,
      row_number() over (
        partition by r.template_id, r.run_date
        order by
          public.checklist_run_answered_item_count(r.id) desc,
          coalesce(r.earned_points, 0) desc,
          case r.status
            when 'completed' then 1
            when 'pending_review' then 2
            when 'in_progress' then 3
            when 'overdue' then 4
            when 'pending' then 5
            when 'rejected' then 6
            else 7
          end asc,
          r.created_at asc
      ) as keep_rank
    from public.checklist_runs r
    inner join duplicate_groups dg
      on dg.template_id = r.template_id
     and dg.run_date = r.run_date
    where r.status <> 'cancelled'
  )
  update public.checklist_runs r
  set
    status = 'cancelled',
    notes = concat_ws(
      E'\n',
      nullif(r.notes, ''),
      'Cancelada por migracion 120: duplicado de template_id + run_date (conservando la corrida canonica).'
    ),
    updated_at = now()
  from ranked d
  where r.id = d.id
    and d.keep_rank > 1;

  get diagnostics v_cancelled = row_count;
  raise notice 'checklist_run_unique_constraint: cancelled % duplicate run(s)', v_cancelled;
end;
$$;

-- ---------------------------------------------------------------------------
-- Phase 3: Partial unique index — one active run per template + date
-- ---------------------------------------------------------------------------

create unique index if not exists checklist_runs_template_date_active_unique
  on public.checklist_runs (template_id, run_date)
  where status <> 'cancelled';

create index if not exists checklist_runs_template_date_active_idx
  on public.checklist_runs (template_id, run_date)
  where status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Phase 4: Harden create_checklist_run_from_template
-- ---------------------------------------------------------------------------

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date default public.get_checklist_operational_date(),
  p_assignment_source text default 'manual',
  p_assigned_profile_id uuid default null,
  p_notes text default null,
  p_area text default null,
  p_assigned_role text default null
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  existing_run public.checklist_runs;
  created_run public.checklist_runs;
  effective_profile_id uuid;
  original_profile_id uuid;
  effective_area text;
  effective_role text;
begin
  select * into template_row
  from public.checklist_templates
  where id = p_template_id
    and status = 'active';

  if template_row.id is null then
    raise exception 'La plantilla no existe o esta inactiva.';
  end if;

  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para crear checklists.';
  end if;

  perform public.checklist_run_template_date_lock(template_row.id, p_run_date);

  select * into existing_run
  from public.checklist_runs
  where template_id = template_row.id
    and run_date = p_run_date
    and status <> 'cancelled'
  order by created_at asc
  limit 1
  for update;

  if existing_run.id is not null then
    return existing_run;
  end if;

  original_profile_id := coalesce(p_assigned_profile_id, template_row.assigned_profile_id);
  effective_profile_id := original_profile_id;
  effective_area := nullif(trim(coalesce(p_area, template_row.area, '')), '');
  effective_role := nullif(trim(coalesce(p_assigned_role, template_row.assigned_role, '')), '');

  if template_row.skip_non_work_days
    and effective_profile_id is not null
    and not public.is_profile_scheduled_to_work(effective_profile_id, p_run_date)
  then
    if template_row.backup_profile_id is not null
      and template_row.backup_profile_id <> effective_profile_id
      and public.is_profile_scheduled_to_work(template_row.backup_profile_id, p_run_date)
    then
      effective_profile_id := template_row.backup_profile_id;
    end if;
  end if;

  insert into public.checklist_runs (
    template_id, run_date, area, assigned_profile_id, assigned_role, status,
    total_points, earned_points, notes, supervisor_profile_id, reminder_time,
    due_time, assignment_source, original_assigned_profile_id
  )
  values (
    template_row.id, p_run_date, effective_area, effective_profile_id,
    effective_role, 'pending',
    coalesce((
      select sum(score_points)::integer
      from public.checklist_template_items
      where template_id = template_row.id
        and is_active = true
    ), 0),
    0, nullif(trim(coalesce(p_notes, '')), ''), template_row.supervisor_profile_id,
    template_row.reminder_time, template_row.due_time, coalesce(p_assignment_source, 'manual'),
    original_profile_id
  )
  on conflict (template_id, run_date) where (status <> 'cancelled')
  do nothing
  returning * into created_run;

  if created_run.id is null then
    select * into existing_run
    from public.checklist_runs
    where template_id = template_row.id
      and run_date = p_run_date
      and status <> 'cancelled'
    order by created_at asc
    limit 1;

    if existing_run.id is not null then
      return existing_run;
    end if;

    raise exception 'No se pudo crear ni recuperar la corrida de checklist.';
  end if;

  insert into public.checklist_run_items (
    run_id, template_item_id, item_order, title, response_type, is_required,
    requires_photo, requires_comment, score_points, options,
    require_comment_on_no, require_photo_on_no, generate_incident_on_no, rule_config,
    expected_response, triggers_incident, incident_severity, notify_roles, create_task_on_fail
  )
  select
    created_run.id, item.id, item.item_order, item.title, item.response_type,
    item.is_required, item.requires_photo, item.requires_comment, item.score_points,
    item.options, item.require_comment_on_no, item.require_photo_on_no,
    item.generate_incident_on_no, item.rule_config, item.expected_response,
    item.triggers_incident, item.incident_severity, item.notify_roles, item.create_task_on_fail
  from public.checklist_template_items item
  where item.template_id = template_row.id
    and item.is_active = true
  order by item.item_order;

  if coalesce(p_assignment_source, 'manual') <> 'recurrence' then
    begin
      perform public.create_checklist_run_notifications(created_run.id);
    exception
      when others then
        raise warning 'create_checklist_run_notifications failed for run %: %', created_run.id, sqlerrm;
    end;
  end if;

  return created_run;
end;
$$;

revoke all on function public.create_checklist_run_from_template(uuid, date, text, uuid, text, text, text) from public;
grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text, text, text) to authenticated;

-- Legacy 5-arg wrapper (older clients)
drop function if exists public.create_checklist_run_from_template(uuid, date, text, uuid, text);

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date,
  p_assignment_source text,
  p_assigned_profile_id uuid,
  p_notes text
)
returns public.checklist_runs
language sql
security definer
set search_path = ''
as $$
  select public.create_checklist_run_from_template(
    p_template_id,
    p_run_date,
    p_assignment_source,
    p_assigned_profile_id,
    p_notes,
    null,
    null
  );
$$;

revoke all on function public.create_checklist_run_from_template(uuid, date, text, uuid, text) from public;
grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 5: Operational process run — lock + reuse existing child checklist runs
-- ---------------------------------------------------------------------------

create or replace function public.create_operational_process_run(
  p_process_template_id uuid,
  p_run_date date default public.get_checklist_operational_date(),
  p_area text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.operational_process_templates;
  v_existing public.operational_process_runs;
  v_process_run public.operational_process_runs;
  v_step public.operational_process_template_steps;
  v_child_run public.checklist_runs;
  v_run_step public.operational_process_run_steps;
  v_dep_run_step_id uuid;
  v_step_map jsonb := '{}'::jsonb;
begin
  if not public.can_execute_operational_process() then
    raise exception 'No tienes permiso para ejecutar procesos operativos.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('operational_process_run:' || p_process_template_id::text || '|' || p_run_date::text)
  );

  select * into v_template
  from public.operational_process_templates
  where id = p_process_template_id and status = 'active';

  if v_template.id is null then
    raise exception 'Proceso operativo no encontrado o inactivo.';
  end if;

  select * into v_existing
  from public.operational_process_runs
  where process_template_id = p_process_template_id
    and run_date = p_run_date
    and status <> 'cancelled'
  order by created_at asc
  limit 1
  for update;

  if v_existing.id is not null then
    return public.get_operational_process_run_detail(v_existing.id);
  end if;

  insert into public.operational_process_runs (
    process_template_id, run_date, status, area, notes, created_by
  )
  values (
    p_process_template_id,
    p_run_date,
    'pending',
    nullif(trim(coalesce(p_area, v_template.area, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_process_run;

  for v_step in
    select * from public.operational_process_template_steps
    where process_template_id = p_process_template_id
    order by step_order asc, id asc
  loop
    -- create_checklist_run_from_template dedupes by template_id + run_date (migration 120).
    v_child_run := public.create_checklist_run_from_template(
      v_step.child_template_id,
      p_run_date,
      'manual',
      v_step.assigned_profile_id,
      null,
      coalesce(v_step.area, v_process_run.area),
      v_step.assigned_role
    );

    v_dep_run_step_id := null;
    if v_step.depends_on_step_id is not null then
      v_dep_run_step_id := nullif(v_step_map ->> v_step.depends_on_step_id::text, '')::uuid;
    end if;

    insert into public.operational_process_run_steps (
      process_run_id, template_step_id, checklist_run_id, child_template_id,
      step_order, step_label, is_required, depends_on_run_step_id
    )
    values (
      v_process_run.id,
      v_step.id,
      v_child_run.id,
      v_step.child_template_id,
      v_step.step_order,
      v_step.step_label,
      v_step.is_required,
      v_dep_run_step_id
    )
    on conflict (process_run_id, checklist_run_id) do nothing
    returning * into v_run_step;

    if v_run_step.id is null then
      select * into v_run_step
      from public.operational_process_run_steps
      where process_run_id = v_process_run.id
        and checklist_run_id = v_child_run.id
      limit 1;
    end if;

    v_step_map := v_step_map || jsonb_build_object(v_step.id::text, v_run_step.id);
  end loop;

  perform public.recalculate_operational_process_run_status(v_process_run.id);

  return public.get_operational_process_run_detail(v_process_run.id);
end;
$$;

revoke all on function public.create_operational_process_run(uuid, date, text, text) from public;
grant execute on function public.create_operational_process_run(uuid, date, text, text) to authenticated;
