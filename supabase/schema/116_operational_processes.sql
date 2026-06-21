-- Operational Processes (Procesos Operativos): parent layer grouping checklist runs.
-- Does not modify checklist_templates / checklist_runs structure.
-- Apply after 115_catering_quote_template_sections.sql (or latest checklist migration 113+).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.operational_process_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  area text,
  process_type text not null default 'checklist_bundle'
    check (process_type in ('checklist_bundle')),
  completion_mode text not null default 'all_required'
    check (completion_mode in ('all_required', 'sequential')),
  allow_parallel_execution boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  supervisor_profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.operational_process_templates is
  'Operational Process template (parent). Groups child checklist templates without own items.';

create table if not exists public.operational_process_template_steps (
  id uuid primary key default gen_random_uuid(),
  process_template_id uuid not null references public.operational_process_templates(id) on delete cascade,
  child_template_id uuid not null references public.checklist_templates(id) on delete restrict,
  depends_on_step_id uuid references public.operational_process_template_steps(id) on delete set null,
  step_order integer not null default 0 check (step_order >= 0),
  step_label text not null,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  assigned_role text,
  area text,
  supervisor_profile_id uuid references public.profiles(id) on delete set null,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- depends_on_step_id same-process rule enforced by trigger (CHECK subqueries not allowed).
alter table public.operational_process_template_steps
  drop constraint if exists operational_process_template_steps_dep_same_process;

create unique index if not exists operational_process_template_steps_order_uq
  on public.operational_process_template_steps (process_template_id, step_order);

create index if not exists operational_process_template_steps_template_idx
  on public.operational_process_template_steps (process_template_id, step_order asc);

create index if not exists operational_process_template_steps_child_idx
  on public.operational_process_template_steps (child_template_id);

create table if not exists public.operational_process_runs (
  id uuid primary key default gen_random_uuid(),
  process_template_id uuid not null references public.operational_process_templates(id) on delete restrict,
  run_date date not null default (public.get_checklist_operational_date()),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  area text,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operational_process_runs_date_idx
  on public.operational_process_runs (run_date desc, status);

create index if not exists operational_process_runs_template_date_idx
  on public.operational_process_runs (process_template_id, run_date desc);

create table if not exists public.operational_process_run_steps (
  id uuid primary key default gen_random_uuid(),
  process_run_id uuid not null references public.operational_process_runs(id) on delete cascade,
  template_step_id uuid references public.operational_process_template_steps(id) on delete set null,
  checklist_run_id uuid not null references public.checklist_runs(id) on delete restrict,
  child_template_id uuid references public.checklist_templates(id) on delete set null,
  step_order integer not null default 0,
  step_label text not null,
  is_required boolean not null default true,
  depends_on_run_step_id uuid references public.operational_process_run_steps(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (process_run_id, checklist_run_id),
  unique (process_run_id, step_order)
);

create index if not exists operational_process_run_steps_run_idx
  on public.operational_process_run_steps (process_run_id, step_order asc);

create index if not exists operational_process_run_steps_checklist_idx
  on public.operational_process_run_steps (checklist_run_id);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.is_operational_process_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_checklist_library_admin();
$$;

create or replace function public.can_execute_operational_process()
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
        'admin', 'gerente_general', 'gerente', 'supervisor',
        'recursos_humanos', 'rrhh'
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
      public.normalize_profile_role(public.current_profile_role()) = 'supervisor'
      and p_template.status = 'active'
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
      public.normalize_profile_role(public.current_profile_role()) = 'supervisor'
      and (
        nullif(trim(coalesce(p_run.area, '')), '') is null
        or nullif(trim(coalesce(p_run.area, '')), '') = nullif(trim(coalesce(
          (select pr.area_name from public.profiles pr where pr.id = auth.uid()),
          ''
        )), '')
        or exists (
          select 1
          from public.operational_process_run_steps rs
          join public.checklist_runs cr on cr.id = rs.checklist_run_id
          where rs.process_run_id = p_run.id
            and public.can_access_checklist_run(cr)
        )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.operational_process_templates enable row level security;
alter table public.operational_process_template_steps enable row level security;
alter table public.operational_process_runs enable row level security;
alter table public.operational_process_run_steps enable row level security;

grant select on public.operational_process_templates, public.operational_process_template_steps to authenticated;
grant select on public.operational_process_runs, public.operational_process_run_steps to authenticated;
grant all on public.operational_process_templates, public.operational_process_template_steps to service_role;
grant all on public.operational_process_runs, public.operational_process_run_steps to service_role;

drop policy if exists "operational_process_templates_select" on public.operational_process_templates;
create policy "operational_process_templates_select"
  on public.operational_process_templates for select to authenticated
  using (public.can_read_operational_process_template(operational_process_templates));

drop policy if exists "operational_process_template_steps_select" on public.operational_process_template_steps;
create policy "operational_process_template_steps_select"
  on public.operational_process_template_steps for select to authenticated
  using (
    exists (
      select 1 from public.operational_process_templates t
      where t.id = operational_process_template_steps.process_template_id
        and public.can_read_operational_process_template(t)
    )
  );

drop policy if exists "operational_process_runs_select" on public.operational_process_runs;
create policy "operational_process_runs_select"
  on public.operational_process_runs for select to authenticated
  using (public.can_access_operational_process_run(operational_process_runs));

drop policy if exists "operational_process_run_steps_select" on public.operational_process_run_steps;
create policy "operational_process_run_steps_select"
  on public.operational_process_run_steps for select to authenticated
  using (
    exists (
      select 1 from public.operational_process_runs pr
      where pr.id = operational_process_run_steps.process_run_id
        and public.can_access_operational_process_run(pr)
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.validate_operational_process_template_step_deps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  dep_process uuid;
begin
  if new.depends_on_step_id is null then
    return new;
  end if;

  select process_template_id into dep_process
  from public.operational_process_template_steps
  where id = new.depends_on_step_id;

  if dep_process is null or dep_process <> new.process_template_id then
    raise exception 'depends_on_step_id must reference a step in the same process template.';
  end if;

  return new;
end;
$$;

drop trigger if exists operational_process_template_steps_dep_trg on public.operational_process_template_steps;
create trigger operational_process_template_steps_dep_trg
  before insert or update on public.operational_process_template_steps
  for each row execute function public.validate_operational_process_template_step_deps();

create or replace function public.operational_process_run_progress(p_process_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required integer := 0;
  v_completed integer := 0;
  v_in_progress integer := 0;
  v_pending integer := 0;
  v_cancelled integer := 0;
begin
  select
    count(*) filter (where rs.is_required),
    count(*) filter (where rs.is_required and cr.status = 'completed'),
    count(*) filter (where cr.status = 'in_progress'),
    count(*) filter (where cr.status in ('pending', 'rejected')),
    count(*) filter (where cr.status = 'cancelled')
  into v_required, v_completed, v_in_progress, v_pending, v_cancelled
  from public.operational_process_run_steps rs
  join public.checklist_runs cr on cr.id = rs.checklist_run_id
  where rs.process_run_id = p_process_run_id;

  return jsonb_build_object(
    'required_steps', coalesce(v_required, 0),
    'completed_steps', coalesce(v_completed, 0),
    'in_progress_steps', coalesce(v_in_progress, 0),
    'pending_steps', coalesce(v_pending, 0),
    'cancelled_steps', coalesce(v_cancelled, 0),
    'percent', case
      when coalesce(v_required, 0) = 0 then 100
      else round((coalesce(v_completed, 0)::numeric / v_required::numeric) * 100, 1)
    end
  );
end;
$$;

create or replace function public.recalculate_operational_process_run_status(p_process_run_id uuid)
returns public.operational_process_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.operational_process_runs;
  v_required integer := 0;
  v_completed integer := 0;
  v_any_active boolean := false;
  v_any_cancelled_required boolean := false;
begin
  if p_process_run_id is null then
    raise exception 'p_process_run_id es obligatorio.';
  end if;

  select * into v_run from public.operational_process_runs where id = p_process_run_id for update;
  if v_run.id is null then
    raise exception 'Proceso operativo no encontrado.';
  end if;

  if v_run.status = 'cancelled' then
    return v_run;
  end if;

  select
    count(*) filter (where rs.is_required),
    count(*) filter (where rs.is_required and cr.status = 'completed'),
    bool_or(cr.status in ('in_progress', 'completed', 'pending_review')),
    bool_or(rs.is_required and cr.status = 'cancelled')
  into v_required, v_completed, v_any_active, v_any_cancelled_required
  from public.operational_process_run_steps rs
  join public.checklist_runs cr on cr.id = rs.checklist_run_id
  where rs.process_run_id = p_process_run_id;

  if coalesce(v_required, 0) > 0 and v_completed = v_required then
    update public.operational_process_runs
    set status = 'completed',
        completed_at = coalesce(completed_at, now()),
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = p_process_run_id
    returning * into v_run;
  elsif v_any_active or v_completed > 0 then
    update public.operational_process_runs
    set status = 'in_progress',
        started_at = coalesce(started_at, now()),
        completed_at = null,
        updated_at = now()
    where id = p_process_run_id
    returning * into v_run;
  else
    update public.operational_process_runs
    set status = 'pending',
        completed_at = null,
        updated_at = now()
    where id = p_process_run_id
    returning * into v_run;
  end if;

  return v_run;
end;
$$;

create or replace function public.tg_recalculate_operational_process_on_checklist_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_process_run_id uuid;
begin
  if tg_op = 'UPDATE' and (old.status is distinct from new.status) then
    for v_process_run_id in
      select rs.process_run_id
      from public.operational_process_run_steps rs
      where rs.checklist_run_id = new.id
    loop
      perform public.recalculate_operational_process_run_status(v_process_run_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_runs_operational_process_status_trg on public.checklist_runs;
create trigger checklist_runs_operational_process_status_trg
  after update of status on public.checklist_runs
  for each row execute function public.tg_recalculate_operational_process_on_checklist_run();

-- ---------------------------------------------------------------------------
-- RPC: library + detail
-- ---------------------------------------------------------------------------

create or replace function public.get_operational_process_templates_library()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
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

create or replace function public.get_operational_process_template_detail(p_process_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template public.operational_process_templates;
  v_steps jsonb := '[]'::jsonb;
begin
  if p_process_template_id is null then
    raise exception 'p_process_template_id es obligatorio.';
  end if;

  select * into v_template
  from public.operational_process_templates
  where id = p_process_template_id;

  if v_template.id is null then
    raise exception 'Proceso operativo no encontrado.';
  end if;

  if not public.can_read_operational_process_template(v_template) then
    raise exception 'No tienes permiso para consultar este proceso.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'process_template_id', s.process_template_id,
      'child_template_id', s.child_template_id,
      'depends_on_step_id', s.depends_on_step_id,
      'step_order', s.step_order,
      'step_label', s.step_label,
      'assigned_profile_id', s.assigned_profile_id,
      'assigned_role', s.assigned_role,
      'area', s.area,
      'supervisor_profile_id', s.supervisor_profile_id,
      'is_required', s.is_required,
      'child_template', (
        select jsonb_build_object(
          'id', ct.id,
          'title', ct.title,
          'area', ct.area,
          'assigned_role', ct.assigned_role,
          'assigned_profile_id', ct.assigned_profile_id,
          'status', ct.status
        )
        from public.checklist_templates ct
        where ct.id = s.child_template_id
      )
    ) order by s.step_order asc, s.id asc
  ), '[]'::jsonb)
  into v_steps
  from public.operational_process_template_steps s
  where s.process_template_id = p_process_template_id;

  return jsonb_build_object(
    'template', to_jsonb(v_template),
    'steps', v_steps
  );
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
  v_new_steps jsonb := '[]'::jsonb;
begin
  if not public.is_operational_process_manager() then
    raise exception 'No tienes permiso para administrar procesos operativos.';
  end if;

  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;

  if v_id is null then
    insert into public.operational_process_templates (
      title, description, area, process_type, completion_mode,
      allow_parallel_execution, status, supervisor_profile_id, created_by
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

  -- Pass 1: insert steps without dependencies
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

  -- Pass 2: wire depends_on_step_id via client_key references
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

create or replace function public.deactivate_operational_process_template(p_process_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_operational_process_manager() then
    raise exception 'No tienes permiso para desactivar procesos operativos.';
  end if;

  update public.operational_process_templates
  set status = 'inactive', updated_at = now()
  where id = p_process_template_id;

  return public.get_operational_process_template_detail(p_process_template_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: manual execution
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
  limit 1;

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
    returning * into v_run_step;

    v_step_map := v_step_map || jsonb_build_object(v_step.id::text, v_run_step.id);
  end loop;

  perform public.recalculate_operational_process_run_status(v_process_run.id);

  return public.get_operational_process_run_detail(v_process_run.id);
end;
$$;

create or replace function public.get_operational_process_run_detail(p_process_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.operational_process_runs;
  v_template public.operational_process_templates;
  v_steps jsonb := '[]'::jsonb;
begin
  select * into v_run from public.operational_process_runs where id = p_process_run_id;
  if v_run.id is null then
    raise exception 'Ejecucion de proceso no encontrada.';
  end if;

  if not public.can_access_operational_process_run(v_run) then
    raise exception 'No tienes permiso para consultar este proceso.';
  end if;

  select * into v_template from public.operational_process_templates where id = v_run.process_template_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rs.id,
      'step_order', rs.step_order,
      'step_label', rs.step_label,
      'is_required', rs.is_required,
      'depends_on_run_step_id', rs.depends_on_run_step_id,
      'checklist_run_id', rs.checklist_run_id,
      'child_template_id', rs.child_template_id,
      'checklist_run', (
        select jsonb_build_object(
          'id', cr.id,
          'status', cr.status,
          'run_date', cr.run_date,
          'area', cr.area,
          'assigned_profile_id', cr.assigned_profile_id,
          'assigned_role', cr.assigned_role,
          'started_at', cr.started_at,
          'completed_at', cr.completed_at,
          'template_title', ct.title,
          'item_count', (select count(*) from public.checklist_run_items cri where cri.run_id = cr.id),
          'completed_items', (
            select count(*) from public.checklist_run_items cri
            where cri.run_id = cr.id and cri.completed_at is not null
          )
        )
        from public.checklist_runs cr
        left join public.checklist_templates ct on ct.id = cr.template_id
        where cr.id = rs.checklist_run_id
      )
    ) order by rs.step_order asc, rs.id asc
  ), '[]'::jsonb)
  into v_steps
  from public.operational_process_run_steps rs
  where rs.process_run_id = p_process_run_id;

  return jsonb_build_object(
    'process_run', to_jsonb(v_run),
    'template', to_jsonb(v_template),
    'steps', v_steps,
    'progress', public.operational_process_run_progress(p_process_run_id)
  );
end;
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
  if not public.can_execute_operational_process() then
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.is_operational_process_manager() from public;
revoke all on function public.can_execute_operational_process() from public;
revoke all on function public.can_read_operational_process_template(public.operational_process_templates) from public;
revoke all on function public.can_access_operational_process_run(public.operational_process_runs) from public;
revoke all on function public.operational_process_run_progress(uuid) from public;
revoke all on function public.recalculate_operational_process_run_status(uuid) from public;
revoke all on function public.get_operational_process_templates_library() from public;
revoke all on function public.get_operational_process_template_detail(uuid) from public;
revoke all on function public.upsert_operational_process_template(jsonb, jsonb) from public;
revoke all on function public.deactivate_operational_process_template(uuid) from public;
revoke all on function public.create_operational_process_run(uuid, date, text, text) from public;
revoke all on function public.get_operational_process_run_detail(uuid) from public;
revoke all on function public.get_operational_process_runs_for_date(date) from public;

grant execute on function public.is_operational_process_manager() to authenticated;
grant execute on function public.can_execute_operational_process() to authenticated;
grant execute on function public.can_read_operational_process_template(public.operational_process_templates) to authenticated;
grant execute on function public.can_access_operational_process_run(public.operational_process_runs) to authenticated;
grant execute on function public.operational_process_run_progress(uuid) to authenticated;
grant execute on function public.recalculate_operational_process_run_status(uuid) to authenticated;
grant execute on function public.get_operational_process_templates_library() to authenticated;
grant execute on function public.get_operational_process_template_detail(uuid) to authenticated;
grant execute on function public.upsert_operational_process_template(jsonb, jsonb) to authenticated;
grant execute on function public.deactivate_operational_process_template(uuid) to authenticated;
grant execute on function public.create_operational_process_run(uuid, date, text, text) to authenticated;
grant execute on function public.get_operational_process_run_detail(uuid) to authenticated;
grant execute on function public.get_operational_process_runs_for_date(date) to authenticated;
