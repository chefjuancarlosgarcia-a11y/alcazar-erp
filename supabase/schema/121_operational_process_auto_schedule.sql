-- Operational process auto-scheduling (mirror checklist recurrence).
-- Apply after 120_checklist_run_unique_constraint.sql.

alter table public.operational_process_templates
  add column if not exists frequency_type text not null default 'manual'
    check (frequency_type in ('manual', 'daily', 'weekly', 'monthly')),
  add column if not exists recurrence_days integer[] not null default '{}'::integer[],
  add column if not exists recurrence_month_day integer
    check (recurrence_month_day is null or (recurrence_month_day between 1 and 31));

comment on column public.operational_process_templates.frequency_type is
  'manual = Ejecutar hoy only; daily/weekly/monthly = auto-generate process + child runs.';

create unique index if not exists operational_process_runs_template_date_active_uq
  on public.operational_process_runs (process_template_id, run_date)
  where status <> 'cancelled';

create or replace function public.operational_process_template_should_auto_generate(
  p_template public.operational_process_templates
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_template.frequency_type, 'manual') <> 'manual';
$$;

create or replace function public.operational_process_template_due_on_date(
  p_template public.operational_process_templates,
  p_date date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_template.status <> 'active' then false
    when not public.operational_process_template_should_auto_generate(p_template) then false
    when p_template.frequency_type = 'daily' then true
    when p_template.frequency_type = 'weekly' then
      coalesce(array_length(p_template.recurrence_days, 1), 0) > 0
      and extract(isodow from p_date)::integer = any(p_template.recurrence_days)
    when p_template.frequency_type = 'monthly' then
      coalesce(p_template.recurrence_month_day, 1) = extract(day from p_date)::integer
    else false
  end;
$$;

create or replace function public.ensure_operational_process_run(
  p_process_template_id uuid,
  p_run_date date default public.get_checklist_operational_date(),
  p_area text default null,
  p_notes text default null,
  p_assignment_source text default 'recurrence'
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
  v_source text := coalesce(nullif(trim(p_assignment_source), ''), 'recurrence');
begin
  if v_source not in ('manual', 'recurrence') then
    raise exception 'assignment_source invalido.';
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
    v_child_run := public.create_checklist_run_from_template(
      v_step.child_template_id,
      p_run_date,
      v_source,
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
begin
  if not public.can_execute_operational_process() then
    raise exception 'No tienes permiso para ejecutar procesos operativos.';
  end if;

  return public.ensure_operational_process_run(
    p_process_template_id,
    p_run_date,
    p_area,
    p_notes,
    'manual'
  );
end;
$$;

create or replace function public.generate_due_operational_process_runs(
  p_target_date date default public.get_checklist_operational_date()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.operational_process_templates;
  v_generated integer := 0;
begin
  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para generar procesos operativos programados.';
  end if;

  for v_template in
    select * from public.operational_process_templates
    where status = 'active'
      and public.operational_process_template_should_auto_generate(operational_process_templates)
      and public.operational_process_template_due_on_date(operational_process_templates, p_target_date)
  loop
    begin
      perform public.ensure_operational_process_run(
        v_template.id,
        p_target_date,
        v_template.area,
        'Generada automaticamente',
        'recurrence'
      );
      v_generated := v_generated + 1;
    exception when others then
      raise warning 'generate_due_operational_process_runs template % failed: %', v_template.id, sqlerrm;
    end;
  end loop;

  return v_generated;
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
  if not public.can_execute_operational_process() then
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
    where t.status = 'active'
       or public.is_operational_process_manager()
    order by t.title
  ) sub;

  return v_rows;
end;
$$;

create or replace function public.upsert_operational_process_template(
  p_payload jsonb,
  p_steps jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_template public.operational_process_templates;
  v_step jsonb;
  v_sort integer := 0;
  v_step_id uuid;
  v_dep uuid;
  v_old_to_new jsonb := '{}'::jsonb;
  v_frequency text := coalesce(nullif(trim(p_payload ->> 'frequency_type'), ''), 'manual');
  v_recurrence_days integer[];
  v_recurrence_month_day integer;
begin
  if not public.is_operational_process_manager() then
    raise exception 'No tienes permiso para administrar procesos operativos.';
  end if;

  if v_frequency not in ('manual', 'daily', 'weekly', 'monthly') then
    raise exception 'frequency_type invalido.';
  end if;

  v_recurrence_days := coalesce(
    (
      select array_agg(value::integer order by value::integer)
      from jsonb_array_elements_text(coalesce(p_payload -> 'recurrence_days', '[]'::jsonb)) as value
      where value ~ '^[1-7]$'
    ),
    '{}'::integer[]
  );

  v_recurrence_month_day := nullif(trim(coalesce(p_payload ->> 'recurrence_month_day', '')), '')::integer;

  if v_frequency = 'weekly' and coalesce(array_length(v_recurrence_days, 1), 0) = 0 then
    raise exception 'Selecciona al menos un dia de la semana para frecuencia semanal.';
  end if;

  if v_frequency = 'monthly' and v_recurrence_month_day is null then
    v_recurrence_month_day := 1;
  end if;

  if v_frequency in ('manual', 'daily') then
    v_recurrence_days := '{}'::integer[];
    v_recurrence_month_day := null;
  elsif v_frequency = 'weekly' then
    v_recurrence_month_day := null;
  elsif v_frequency = 'monthly' then
    v_recurrence_days := '{}'::integer[];
  end if;

  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;

  if v_id is null then
    insert into public.operational_process_templates (
      title, description, area, process_type, completion_mode,
      allow_parallel_execution, status, supervisor_profile_id,
      frequency_type, recurrence_days, recurrence_month_day,
      created_by
    )
    values (
      trim(p_payload ->> 'title'),
      nullif(trim(coalesce(p_payload ->> 'description', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'area', '')), ''),
      coalesce(nullif(trim(p_payload ->> 'process_type'), ''), 'checklist_bundle'),
      coalesce(nullif(trim(p_payload ->> 'completion_mode'), ''), 'all_required'),
      coalesce((p_payload ->> 'allow_parallel_execution')::boolean, true),
      coalesce(nullif(trim(p_payload ->> 'status'), ''), 'active'),
      nullif(trim(coalesce(p_payload ->> 'supervisor_profile_id', '')), '')::uuid,
      v_frequency,
      v_recurrence_days,
      v_recurrence_month_day,
      auth.uid()
    )
    returning * into v_template;
    v_id := v_template.id;
  else
    update public.operational_process_templates
    set
      title = trim(p_payload ->> 'title'),
      description = nullif(trim(coalesce(p_payload ->> 'description', '')), ''),
      area = nullif(trim(coalesce(p_payload ->> 'area', '')), ''),
      process_type = coalesce(nullif(trim(p_payload ->> 'process_type'), ''), 'checklist_bundle'),
      completion_mode = coalesce(nullif(trim(p_payload ->> 'completion_mode'), ''), 'all_required'),
      allow_parallel_execution = coalesce((p_payload ->> 'allow_parallel_execution')::boolean, allow_parallel_execution),
      status = coalesce(nullif(trim(p_payload ->> 'status'), ''), status),
      supervisor_profile_id = nullif(trim(coalesce(p_payload ->> 'supervisor_profile_id', '')), '')::uuid,
      frequency_type = v_frequency,
      recurrence_days = v_recurrence_days,
      recurrence_month_day = v_recurrence_month_day,
      updated_at = now()
    where id = v_id
    returning * into v_template;

    if v_template.id is null then
      raise exception 'Proceso operativo no encontrado.';
    end if;

    delete from public.operational_process_template_steps
    where process_template_id = v_id;
  end if;

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'p_steps debe ser un arreglo.';
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) as value loop
    v_sort := v_sort + 1;
    insert into public.operational_process_template_steps (
      process_template_id, child_template_id, depends_on_step_id,
      step_order, step_label, assigned_profile_id, assigned_role, area,
      supervisor_profile_id, is_required
    )
    values (
      v_id,
      nullif(trim(v_step ->> 'child_template_id'), '')::uuid,
      null,
      coalesce(nullif(v_step ->> 'step_order', '')::integer, v_sort),
      trim(v_step ->> 'step_label'),
      nullif(trim(coalesce(v_step ->> 'assigned_profile_id', '')), '')::uuid,
      nullif(trim(coalesce(v_step ->> 'assigned_role', '')), ''),
      nullif(trim(coalesce(v_step ->> 'area', '')), ''),
      nullif(trim(coalesce(v_step ->> 'supervisor_profile_id', '')), '')::uuid,
      coalesce((v_step ->> 'is_required')::boolean, true)
    )
    returning id into v_step_id;

    v_old_to_new := v_old_to_new || jsonb_build_object(
      coalesce(nullif(trim(v_step ->> 'client_key'), ''), v_step_id::text),
      v_step_id
    );
  end loop;

  for v_step in select value from jsonb_array_elements(p_steps) as value loop
    v_dep := nullif(trim(coalesce(v_step ->> 'depends_on_client_key', '')), '');
    if v_dep is null then
      continue;
    end if;

    v_step_id := nullif(v_old_to_new ->> coalesce(nullif(trim(v_step ->> 'client_key'), ''), ''), '')::uuid;
    if v_step_id is null then
      continue;
    end if;

    update public.operational_process_template_steps s
    set depends_on_step_id = nullif(v_old_to_new ->> v_dep, '')::uuid,
        updated_at = now()
    where s.id = v_step_id
      and s.process_template_id = v_id;
  end loop;

  return public.get_operational_process_template_detail(v_id);
end;
$$;

revoke all on function public.operational_process_template_should_auto_generate(public.operational_process_templates) from public;
grant execute on function public.operational_process_template_should_auto_generate(public.operational_process_templates) to authenticated;

revoke all on function public.operational_process_template_due_on_date(public.operational_process_templates, date) from public;
grant execute on function public.operational_process_template_due_on_date(public.operational_process_templates, date) to authenticated;

revoke all on function public.ensure_operational_process_run(uuid, date, text, text, text) from public;
grant execute on function public.ensure_operational_process_run(uuid, date, text, text, text) to authenticated;

revoke all on function public.generate_due_operational_process_runs(date) from public;
grant execute on function public.generate_due_operational_process_runs(date) to authenticated;

revoke all on function public.create_operational_process_run(uuid, date, text, text) from public;
grant execute on function public.create_operational_process_run(uuid, date, text, text) to authenticated;
