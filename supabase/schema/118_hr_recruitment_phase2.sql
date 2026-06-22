-- HR Recruitment Phase 2: employee conversion, onboarding, retention
-- Apply after 117_hr_recruitment.sql

-- ---------------------------------------------------------------------------
-- Extend recruitment_candidates
-- ---------------------------------------------------------------------------

alter table public.recruitment_candidates
  add column if not exists profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists hired_by uuid references public.profiles(id) on delete set null,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_by uuid references public.profiles(id) on delete set null,
  add column if not exists onboarding_status text not null default 'none'
    check (onboarding_status in (
      'none', 'pending_conversion', 'employee_created', 'expediente_created',
      'onboarding_active', 'onboarding_completed'
    )),
  add column if not exists hire_date date,
  add column if not exists final_area text,
  add column if not exists final_position text,
  add column if not exists erp_role text,
  add column if not exists contract_type text,
  add column if not exists agreed_salary text,
  add column if not exists initial_schedule text,
  add column if not exists supervisor_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists checklist_run_id uuid references public.checklist_runs(id) on delete set null;

create unique index if not exists recruitment_candidates_profile_uq
  on public.recruitment_candidates (profile_id)
  where profile_id is not null;

create index if not exists recruitment_candidates_onboarding_status_idx
  on public.recruitment_candidates (onboarding_status);

create index if not exists recruitment_candidates_profile_idx
  on public.recruitment_candidates (profile_id);

-- ---------------------------------------------------------------------------
-- Recruitment origin (expediente link)
-- ---------------------------------------------------------------------------

create table if not exists public.recruitment_employee_origins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  candidate_id uuid not null unique references public.recruitment_candidates(id) on delete restrict,
  vacancy_id uuid references public.recruitment_vacancies(id) on delete set null,
  source text,
  vacancy_title text,
  hire_reason text,
  evaluation_summary jsonb not null default '{}'::jsonb,
  interview_summary jsonb not null default '[]'::jsonb,
  recruitment_notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

create table if not exists public.recruitment_onboarding_checklists (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.recruitment_candidates(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'completed', 'overdue', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

create table if not exists public.recruitment_onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  onboarding_id uuid not null references public.recruitment_onboarding_checklists(id) on delete cascade,
  task_key text not null,
  title text not null,
  description text,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  assigned_role text,
  due_date date,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'overdue', 'skipped')),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_id, task_key)
);

create index if not exists recruitment_onboarding_tasks_onboarding_idx
  on public.recruitment_onboarding_tasks (onboarding_id, sort_order);

create index if not exists recruitment_onboarding_tasks_assignee_idx
  on public.recruitment_onboarding_tasks (assigned_profile_id, status);

-- ---------------------------------------------------------------------------
-- Retention 30/60/90
-- ---------------------------------------------------------------------------

create table if not exists public.recruitment_retention_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.recruitment_candidates(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  review_day integer not null check (review_day in (30, 60, 90)),
  active_status text not null default 'pending'
    check (active_status in ('pending', 'yes', 'no')),
  evaluation_notes text,
  exit_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, review_day)
);

create index if not exists recruitment_retention_reviews_profile_idx
  on public.recruitment_retention_reviews (profile_id, review_day);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists recruitment_onboarding_checklists_updated_at on public.recruitment_onboarding_checklists;
create trigger recruitment_onboarding_checklists_updated_at
  before update on public.recruitment_onboarding_checklists
  for each row execute procedure public.set_recruitment_updated_at();

drop trigger if exists recruitment_onboarding_tasks_updated_at on public.recruitment_onboarding_tasks;
create trigger recruitment_onboarding_tasks_updated_at
  before update on public.recruitment_onboarding_tasks
  for each row execute procedure public.set_recruitment_updated_at();

drop trigger if exists recruitment_retention_reviews_updated_at on public.recruitment_retention_reviews;
create trigger recruitment_retention_reviews_updated_at
  before update on public.recruitment_retention_reviews
  for each row execute procedure public.set_recruitment_updated_at();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_view_recruitment_onboarding()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.can_manage_recruitment()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and public.normalize_profile_role(p.role) = 'supervisor'
    );
$$;

create or replace function public.can_access_recruitment_onboarding(p_onboarding public.recruitment_onboarding_checklists)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.can_manage_recruitment()
    or exists (
      select 1
      from public.recruitment_onboarding_tasks t
      where t.onboarding_id = p_onboarding.id
        and t.assigned_profile_id = auth.uid()
    );
$$;

create or replace function public.can_access_recruitment_onboarding_task(p_task public.recruitment_onboarding_tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.can_manage_recruitment()
    or p_task.assigned_profile_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.recruitment_employee_origins enable row level security;
alter table public.recruitment_onboarding_checklists enable row level security;
alter table public.recruitment_onboarding_tasks enable row level security;
alter table public.recruitment_retention_reviews enable row level security;

grant select, insert, update on public.recruitment_employee_origins to authenticated;
grant select, insert, update on public.recruitment_onboarding_checklists to authenticated;
grant select, insert, update on public.recruitment_onboarding_tasks to authenticated;
grant select, insert, update on public.recruitment_retention_reviews to authenticated;
grant all on public.recruitment_employee_origins, public.recruitment_onboarding_checklists,
  public.recruitment_onboarding_tasks, public.recruitment_retention_reviews to service_role;

drop policy if exists recruitment_origins_select on public.recruitment_employee_origins;
create policy recruitment_origins_select on public.recruitment_employee_origins
  for select to authenticated
  using (public.can_manage_recruitment() or public.can_read_employee_expedientes());

drop policy if exists recruitment_origins_write on public.recruitment_employee_origins;
create policy recruitment_origins_write on public.recruitment_employee_origins
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_onboarding_select on public.recruitment_onboarding_checklists;
create policy recruitment_onboarding_select on public.recruitment_onboarding_checklists
  for select to authenticated
  using (public.can_access_recruitment_onboarding(recruitment_onboarding_checklists));

drop policy if exists recruitment_onboarding_write on public.recruitment_onboarding_checklists;
create policy recruitment_onboarding_write on public.recruitment_onboarding_checklists
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_onboarding_tasks_select on public.recruitment_onboarding_tasks;
create policy recruitment_onboarding_tasks_select on public.recruitment_onboarding_tasks
  for select to authenticated
  using (public.can_access_recruitment_onboarding_task(recruitment_onboarding_tasks));

drop policy if exists recruitment_onboarding_tasks_update on public.recruitment_onboarding_tasks;
create policy recruitment_onboarding_tasks_update on public.recruitment_onboarding_tasks
  for update to authenticated
  using (public.can_access_recruitment_onboarding_task(recruitment_onboarding_tasks))
  with check (public.can_access_recruitment_onboarding_task(recruitment_onboarding_tasks));

drop policy if exists recruitment_onboarding_tasks_insert on public.recruitment_onboarding_tasks;
create policy recruitment_onboarding_tasks_insert on public.recruitment_onboarding_tasks
  for insert to authenticated
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_retention_select on public.recruitment_retention_reviews;
create policy recruitment_retention_select on public.recruitment_retention_reviews
  for select to authenticated
  using (public.can_manage_recruitment());

drop policy if exists recruitment_retention_write on public.recruitment_retention_reviews;
create policy recruitment_retention_write on public.recruitment_retention_reviews
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.recruitment_notify(
  p_user_id uuid,
  p_target_role text,
  p_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id text,
  p_action_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_notification(
    p_user_id, p_target_role, p_type, p_title, p_message,
    p_entity_type, p_entity_id, p_action_url
  );
exception when others then
  null;
end;
$$;

create or replace function public.recruitment_default_onboarding_tasks(
  p_onboarding_id uuid,
  p_hr_profile_id uuid,
  p_supervisor_profile_id uuid,
  p_hire_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hire date := coalesce(p_hire_date, (now() at time zone 'America/Guatemala')::date);
begin
  insert into public.recruitment_onboarding_tasks (
    onboarding_id, task_key, title, description, assigned_profile_id, due_date, sort_order
  ) values
    (p_onboarding_id, 'confirm_dpi', 'Confirmar DPI', 'Validar documento de identidad.', p_hr_profile_id, v_hire + 3, 1),
    (p_onboarding_id, 'confirm_background', 'Confirmar antecedentes', 'Verificar antecedentes penales/policiacos.', p_hr_profile_id, v_hire + 7, 2),
    (p_onboarding_id, 'confirm_contact_info', 'Confirmar dirección y teléfono', 'Actualizar datos de contacto.', p_hr_profile_id, v_hire + 2, 3),
    (p_onboarding_id, 'deliver_uniform', 'Entregar uniforme', 'Registrar entrega de uniforme.', p_supervisor_profile_id, v_hire + 1, 4),
    (p_onboarding_id, 'explain_schedule', 'Explicar horario', 'Revisar horario inicial acordado.', p_supervisor_profile_id, v_hire + 1, 5),
    (p_onboarding_id, 'explain_internal_rules', 'Explicar reglamento interno', 'Firmar/confirmar reglamento.', p_hr_profile_id, v_hire + 3, 6),
    (p_onboarding_id, 'create_attendance_pin', 'Crear PIN de asistencia', 'Configurar PIN de marcaje.', p_hr_profile_id, v_hire + 1, 7),
    (p_onboarding_id, 'area_training', 'Capacitación de área', 'Capacitación operativa del puesto.', p_supervisor_profile_id, v_hire + 5, 8),
    (p_onboarding_id, 'supervisor_intro', 'Presentación con supervisor', 'Introducción con supervisor responsable.', p_supervisor_profile_id, v_hire + 1, 9),
    (p_onboarding_id, 'evaluation_7_days', 'Primera evaluación (7 días)', 'Evaluación inicial de desempeño.', p_supervisor_profile_id, v_hire + 7, 10),
    (p_onboarding_id, 'evaluation_30_days', 'Evaluación de 30 días', 'Evaluación al cumplir 30 días.', p_supervisor_profile_id, v_hire + 30, 11)
  on conflict (onboarding_id, task_key) do nothing;
end;
$$;

create or replace function public.recruitment_seed_retention_reviews(
  p_candidate_id uuid,
  p_profile_id uuid,
  p_hire_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hire date := coalesce(p_hire_date, (now() at time zone 'America/Guatemala')::date);
begin
  insert into public.recruitment_retention_reviews (candidate_id, profile_id, review_day)
  values
    (p_candidate_id, p_profile_id, 30),
    (p_candidate_id, p_profile_id, 60),
    (p_candidate_id, p_profile_id, 90)
  on conflict (candidate_id, review_day) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Update hire to track hired_by + pending conversion
-- ---------------------------------------------------------------------------

create or replace function public.hire_recruitment_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.recruitment_candidates;
  v_vacancy public.recruitment_vacancies;
  v_pending integer;
  v_suggest_close boolean := false;
  v_was_hired boolean := false;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para contratar candidatos.';
  end if;

  select * into v_candidate from public.recruitment_candidates where id = p_candidate_id for update;
  if v_candidate.id is null then
    raise exception 'Candidato no encontrado.';
  end if;

  if v_candidate.profile_id is not null then
    raise exception 'Este candidato ya fue convertido a colaborador.';
  end if;

  v_was_hired := v_candidate.pipeline_status = 'hired';

  if not v_was_hired then
    update public.recruitment_candidates
    set
      pipeline_status = 'hired',
      hired_at = coalesce(hired_at, now()),
      hired_by = coalesce(hired_by, auth.uid()),
      onboarding_status = case when onboarding_status = 'none' then 'pending_conversion' else onboarding_status end,
      updated_by = auth.uid()
    where id = p_candidate_id
    returning * into v_candidate;

    select * into v_vacancy from public.recruitment_vacancies where id = v_candidate.vacancy_id for update;
    update public.recruitment_vacancies
    set
      quantity_filled = least(quantity_filled + 1, quantity_required),
      updated_at = now(),
      filled_at = case when quantity_filled + 1 >= quantity_required then coalesce(filled_at, now()) else filled_at end,
      status = case when quantity_filled + 1 >= quantity_required then 'filled' else status end
    where id = v_vacancy.id
    returning * into v_vacancy;

    v_pending := public.recruitment_vacancy_pending(v_vacancy);
    v_suggest_close := v_pending = 0;

    if v_suggest_close then
      perform public.recruitment_notify(
        null, 'recursos_humanos', 'recruitment',
        'Vacante cubierta',
        'La vacante ' || coalesce(v_vacancy.position_title, '') || ' quedó cubierta.',
        'recruitment_vacancy', v_vacancy.id::text,
        '/hr?section=reclutamiento&tab=vacancies'
      );
    end if;

    perform public.recruitment_notify(
      null, 'recursos_humanos', 'recruitment',
      'Nueva contratación',
      'Candidato ' || v_candidate.full_name || ' marcado como contratado.',
      'recruitment_candidate', v_candidate.id::text,
      '/hr?section=reclutamiento&tab=pipeline&candidateId=' || v_candidate.id::text
    );
  end if;

  return jsonb_build_object(
    'candidate_id', v_candidate.id,
    'vacancy_id', v_candidate.vacancy_id,
    'onboarding_status', v_candidate.onboarding_status,
    'suggest_close_vacancy', v_suggest_close,
    'pending_conversion', v_candidate.onboarding_status = 'pending_conversion',
    'already_hired', v_was_hired
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Convert candidate to employee (profile must exist — created via Edge Function)
-- ---------------------------------------------------------------------------

create or replace function public.convert_recruitment_candidate_to_employee(
  p_candidate_id uuid,
  p_profile_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.recruitment_candidates;
  v_vacancy public.recruitment_vacancies;
  v_profile public.profiles;
  v_onboarding public.recruitment_onboarding_checklists;
  v_checklist_run public.checklist_runs;
  v_hire_date date;
  v_create_expediente boolean := coalesce((p_payload ->> 'create_expediente')::boolean, true);
  v_create_onboarding boolean := coalesce((p_payload ->> 'create_onboarding')::boolean, true);
  v_template_id uuid;
  v_eval jsonb;
  v_interviews jsonb := '[]'::jsonb;
  v_expediente_notes text;
  v_onboarding_status text := 'employee_created';
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para convertir candidatos.';
  end if;

  if p_profile_id is null then
    raise exception 'profile_id es obligatorio.';
  end if;

  select * into v_candidate from public.recruitment_candidates where id = p_candidate_id for update;
  if v_candidate.id is null then
    raise exception 'Candidato no encontrado.';
  end if;

  if v_candidate.profile_id is not null and v_candidate.profile_id <> p_profile_id then
    raise exception 'Este candidato ya está vinculado a otro colaborador.';
  end if;

  if exists (
    select 1 from public.recruitment_candidates c
    where c.profile_id = p_profile_id and c.id <> p_candidate_id
  ) then
    raise exception 'Este colaborador ya está vinculado a otro candidato.';
  end if;

  if v_candidate.pipeline_status not in ('offer', 'hired') then
    raise exception 'El candidato debe estar en oferta o contratado antes de convertir.';
  end if;

  select * into v_profile from public.profiles where id = p_profile_id;
  if v_profile.id is null then
    raise exception 'Colaborador no encontrado.';
  end if;

  select * into v_vacancy from public.recruitment_vacancies where id = v_candidate.vacancy_id;

  v_hire_date := coalesce(
    nullif(trim(coalesce(p_payload ->> 'hire_date', '')), '')::date,
    v_candidate.hire_date,
    (now() at time zone 'America/Guatemala')::date
  );

  update public.profiles
  set
    role = coalesce(nullif(trim(p_payload ->> 'erp_role'), ''), role),
    area_id = coalesce(nullif(trim(p_payload ->> 'area_id'), ''), area_id),
    area_name = coalesce(nullif(trim(p_payload ->> 'area'), ''), area_name, v_vacancy.area),
    phone = coalesce(nullif(trim(v_candidate.phone), ''), phone),
    employee_id = coalesce(nullif(trim(p_payload ->> 'employee_id'), ''), employee_id),
    status = coalesce(nullif(trim(p_payload ->> 'profile_status'), ''), status),
    updated_at = now()
  where id = p_profile_id;

  if v_candidate.pipeline_status <> 'hired' then
    perform public.hire_recruitment_candidate(p_candidate_id);
    select * into v_candidate from public.recruitment_candidates where id = p_candidate_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(ev)), '[]'::jsonb)
  into v_eval
  from public.recruitment_interview_evaluations ev
  join public.recruitment_interviews i on i.id = ev.interview_id
  where i.candidate_id = p_candidate_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'scheduled_date', i.scheduled_date,
    'scheduled_time', i.scheduled_time,
    'result', i.result,
    'notes', i.notes
  ) order by i.scheduled_date desc), '[]'::jsonb)
  into v_interviews
  from public.recruitment_interviews i
  where i.candidate_id = p_candidate_id;

  v_expediente_notes := trim(both E'\n' from concat_ws(E'\n',
    nullif(v_candidate.notes, ''),
    nullif(v_candidate.internal_notes, ''),
    'Fuente: ' || coalesce(v_candidate.source, ''),
    'Salario acordado: ' || coalesce(nullif(trim(p_payload ->> 'agreed_salary'), ''), v_candidate.salary_expectation, 'N/D')
  ));

  if v_create_expediente and public.can_write_employee_expedientes() then
    perform public.upsert_employee_expediente_profile(p_profile_id, jsonb_build_object(
      'address', v_candidate.address,
      'personal_email', v_profile.email,
      'job_title', coalesce(nullif(trim(p_payload ->> 'final_position'), ''), v_candidate.position_applied, v_vacancy.position_title),
      'hire_date', v_hire_date,
      'labor_status', 'active',
      'notes', v_expediente_notes
    ));
    v_onboarding_status := 'expediente_created';
  end if;

  insert into public.recruitment_employee_origins (
    profile_id, candidate_id, vacancy_id, source, vacancy_title,
    hire_reason, evaluation_summary, interview_summary, recruitment_notes, created_by
  )
  values (
    p_profile_id,
    p_candidate_id,
    v_vacancy.id,
    v_candidate.source,
    v_vacancy.position_title,
    coalesce(nullif(trim(p_payload ->> 'hire_reason'), ''), v_vacancy.reason),
    coalesce(v_eval, '[]'::jsonb),
    coalesce(v_interviews, '[]'::jsonb),
    v_expediente_notes,
    auth.uid()
  )
  on conflict (profile_id) do update set
    candidate_id = excluded.candidate_id,
    vacancy_id = excluded.vacancy_id,
    source = excluded.source,
    vacancy_title = excluded.vacancy_title,
    hire_reason = excluded.hire_reason,
    evaluation_summary = excluded.evaluation_summary,
    interview_summary = excluded.interview_summary,
    recruitment_notes = excluded.recruitment_notes;

  v_template_id := nullif(trim(coalesce(p_payload ->> 'checklist_template_id', '')), '')::uuid;
  if v_template_id is not null then
    begin
      v_checklist_run := public.create_checklist_run_from_template(
        v_template_id,
        v_hire_date,
        'manual',
        p_profile_id,
        'Onboarding reclutamiento',
        coalesce(nullif(trim(p_payload ->> 'area'), ''), v_vacancy.area),
        coalesce(nullif(trim(p_payload ->> 'erp_role'), ''), v_profile.role)
      );
    exception when others then
      v_checklist_run := null;
    end;
  end if;

  if v_create_onboarding then
    insert into public.recruitment_onboarding_checklists (
      candidate_id, profile_id, status, due_date, created_by
    )
    values (
      p_candidate_id,
      p_profile_id,
      'active',
      v_hire_date + 30,
      auth.uid()
    )
    on conflict (candidate_id) do update set
      profile_id = excluded.profile_id,
      updated_at = now()
    returning * into v_onboarding;

    perform public.recruitment_default_onboarding_tasks(
      v_onboarding.id,
      auth.uid(),
      nullif(trim(coalesce(p_payload ->> 'supervisor_profile_id', '')), '')::uuid,
      v_hire_date
    );

    perform public.recruitment_seed_retention_reviews(p_candidate_id, p_profile_id, v_hire_date);
    v_onboarding_status := 'onboarding_active';

    perform public.recruitment_notify(
      nullif(trim(coalesce(p_payload ->> 'supervisor_profile_id', '')), '')::uuid,
      null,
      'recruitment',
      'Onboarding pendiente',
      'Nuevo colaborador ' || v_candidate.full_name || ' requiere onboarding.',
      'recruitment_onboarding', v_onboarding.id::text,
      '/hr?section=reclutamiento&tab=onboarding'
    );
  end if;

  update public.recruitment_candidates
  set
    profile_id = p_profile_id,
    converted_at = coalesce(converted_at, now()),
    converted_by = auth.uid(),
    onboarding_status = v_onboarding_status,
    hire_date = v_hire_date,
    final_area = coalesce(nullif(trim(p_payload ->> 'area'), ''), v_vacancy.area),
    final_position = coalesce(nullif(trim(p_payload ->> 'final_position'), ''), v_candidate.position_applied, v_vacancy.position_title),
    erp_role = coalesce(nullif(trim(p_payload ->> 'erp_role'), ''), v_profile.role),
    contract_type = nullif(trim(coalesce(p_payload ->> 'contract_type', '')), ''),
    agreed_salary = nullif(trim(coalesce(p_payload ->> 'agreed_salary', '')), ''),
    initial_schedule = nullif(trim(coalesce(p_payload ->> 'initial_schedule'), ''), v_candidate.schedule_availability),
    supervisor_profile_id = nullif(trim(coalesce(p_payload ->> 'supervisor_profile_id', '')), '')::uuid,
    checklist_run_id = coalesce(v_checklist_run.id, checklist_run_id),
    updated_by = auth.uid()
  where id = p_candidate_id
  returning * into v_candidate;

  perform public.recruitment_notify(
    p_profile_id,
    null,
    'recruitment',
    'Bienvenido al equipo',
    'Tu proceso de incorporación ha iniciado.',
    'recruitment_onboarding', coalesce(v_onboarding.id, p_candidate_id)::text,
    '/hr?section=expedientes&profileId=' || p_profile_id::text
  );

  return jsonb_build_object(
    'candidate_id', v_candidate.id,
    'profile_id', p_profile_id,
    'onboarding_status', v_candidate.onboarding_status,
    'onboarding_id', v_onboarding.id,
    'checklist_run_id', v_checklist_run.id,
    'expediente_created', v_create_expediente,
    'retention_seeded', v_create_onboarding
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding task status
-- ---------------------------------------------------------------------------

create or replace function public.update_recruitment_onboarding_task_status(
  p_task_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.recruitment_onboarding_tasks;
  v_onboarding public.recruitment_onboarding_checklists;
  v_pending integer;
begin
  select * into v_task from public.recruitment_onboarding_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Tarea no encontrada.';
  end if;

  if not public.can_access_recruitment_onboarding_task(v_task) then
    raise exception 'No tienes permiso para actualizar esta tarea.';
  end if;

  update public.recruitment_onboarding_tasks
  set
    status = p_status,
    description = coalesce(nullif(trim(coalesce(p_notes, '')), ''), description),
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    completed_by = case when p_status = 'completed' then auth.uid() else completed_by end,
    updated_at = now()
  where id = p_task_id
  returning * into v_task;

  select count(*) into v_pending
  from public.recruitment_onboarding_tasks t
  where t.onboarding_id = v_task.onboarding_id
    and t.status in ('pending', 'overdue');

  if v_pending = 0 then
    update public.recruitment_onboarding_checklists
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = v_task.onboarding_id
    returning * into v_onboarding;

    update public.recruitment_candidates
    set onboarding_status = 'onboarding_completed', updated_at = now()
    where id = v_onboarding.candidate_id;
  end if;

  return to_jsonb(v_task);
end;
$$;

create or replace function public.list_recruitment_onboardings(
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_recruitment_onboarding() then
    raise exception 'No tienes permiso.';
  end if;

  return coalesce((
    select jsonb_agg(row order by row ->> 'created_at' desc)
    from (
      select jsonb_build_object(
        'id', o.id,
        'candidate_id', o.candidate_id,
        'profile_id', o.profile_id,
        'status', o.status,
        'due_date', o.due_date,
        'completed_at', o.completed_at,
        'created_at', o.created_at,
        'employee_name', p.full_name,
        'position', c.final_position,
        'area', c.final_area,
        'pending_tasks', (
          select count(*) from public.recruitment_onboarding_tasks t
          where t.onboarding_id = o.id and t.status in ('pending', 'overdue')
        ),
        'total_tasks', (
          select count(*) from public.recruitment_onboarding_tasks t where t.onboarding_id = o.id
        ),
        'tasks', coalesce((
          select jsonb_agg(to_jsonb(t) order by t.sort_order)
          from public.recruitment_onboarding_tasks t
          where t.onboarding_id = o.id
            and (public.can_manage_recruitment() or t.assigned_profile_id = auth.uid())
        ), '[]'::jsonb)
      ) as row
      from public.recruitment_onboarding_checklists o
      join public.recruitment_candidates c on c.id = o.candidate_id
      join public.profiles p on p.id = o.profile_id
      where (p_status is null or o.status = p_status)
        and (
          public.can_manage_recruitment()
          or exists (
            select 1 from public.recruitment_onboarding_tasks t
            where t.onboarding_id = o.id and t.assigned_profile_id = auth.uid()
          )
        )
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention reviews
-- ---------------------------------------------------------------------------

create or replace function public.record_recruitment_retention_review(
  p_candidate_id uuid,
  p_review_day integer,
  p_active_status text,
  p_evaluation_notes text default null,
  p_exit_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.recruitment_retention_reviews;
  v_candidate public.recruitment_candidates;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para registrar retención.';
  end if;

  select * into v_candidate from public.recruitment_candidates where id = p_candidate_id;
  if v_candidate.profile_id is null then
    raise exception 'El candidato no tiene colaborador vinculado.';
  end if;

  insert into public.recruitment_retention_reviews (
    candidate_id, profile_id, review_day, active_status,
    evaluation_notes, exit_reason, reviewed_at, reviewed_by
  )
  values (
    p_candidate_id,
    v_candidate.profile_id,
    p_review_day,
    p_active_status,
    nullif(trim(coalesce(p_evaluation_notes, '')), ''),
    nullif(trim(coalesce(p_exit_reason, '')), ''),
    now(),
    auth.uid()
  )
  on conflict (candidate_id, review_day) do update set
    active_status = excluded.active_status,
    evaluation_notes = excluded.evaluation_notes,
    exit_reason = excluded.exit_reason,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.list_recruitment_retention_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso.';
  end if;

  return coalesce((
    select jsonb_agg(row order by row ->> 'hire_date' desc)
    from (
      select jsonb_build_object(
        'candidate_id', c.id,
        'profile_id', c.profile_id,
        'full_name', c.full_name,
        'position', c.final_position,
        'area', c.final_area,
        'hire_date', c.hire_date,
        'source', c.source,
        'reviews', coalesce((
          select jsonb_agg(to_jsonb(r) order by r.review_day)
          from public.recruitment_retention_reviews r
          where r.candidate_id = c.id
        ), '[]'::jsonb)
      ) as row
      from public.recruitment_candidates c
      where c.profile_id is not null
        and c.pipeline_status = 'hired'
    ) sub
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_recruitment_origin_for_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_origin public.recruitment_employee_origins;
begin
  if not public.can_read_employee_expedientes() and not public.can_manage_recruitment() then
    raise exception 'No tienes permiso.';
  end if;

  select * into v_origin from public.recruitment_employee_origins where profile_id = p_profile_id;
  if v_origin.profile_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'origin', to_jsonb(v_origin),
    'candidate', (
      select to_jsonb(c) from public.recruitment_candidates c where c.id = v_origin.candidate_id
    ),
    'vacancy', (
      select to_jsonb(v) from public.recruitment_vacancies v where v.id = v_origin.vacancy_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Phase 2 dashboard KPIs
-- ---------------------------------------------------------------------------

create or replace function public.get_recruitment_phase2_dashboard(
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
  v_from date := coalesce(p_date_from, ((now() at time zone 'America/Guatemala')::date - interval '90 days')::date);
  v_to date := coalesce(p_date_to, (now() at time zone 'America/Guatemala')::date);
  v_converted integer := 0;
  v_onboarding_open integer := 0;
  v_onboarding_done integer := 0;
  v_onboarding_overdue integer := 0;
  v_hired_without_expediente integer := 0;
  v_eligible_30 integer := 0;
  v_active_30 integer := 0;
  v_eligible_60 integer := 0;
  v_active_60 integer := 0;
  v_eligible_90 integer := 0;
  v_active_90 integer := 0;
  v_early_exits integer := 0;
  v_best_source text;
  v_worst_position text;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso.';
  end if;

  select count(*) into v_converted
  from public.recruitment_candidates c
  where c.profile_id is not null
    and coalesce(c.converted_at::date, c.hire_date) between v_from and v_to;

  select count(*) into v_onboarding_open
  from public.recruitment_onboarding_checklists o
  where o.status = 'active';

  select count(*) into v_onboarding_done
  from public.recruitment_onboarding_checklists o
  where o.status = 'completed';

  select count(*) into v_onboarding_overdue
  from public.recruitment_onboarding_checklists o
  where o.status = 'overdue'
     or (o.status = 'active' and o.due_date is not null and o.due_date < current_date);

  select count(*) into v_hired_without_expediente
  from public.recruitment_candidates c
  where c.pipeline_status = 'hired'
    and c.profile_id is null;

  select count(*) into v_eligible_30
  from public.recruitment_candidates c
  where c.profile_id is not null
    and c.hire_date is not null
    and c.hire_date <= current_date - 30;

  select count(*) into v_active_30
  from public.recruitment_retention_reviews r
  join public.recruitment_candidates c on c.id = r.candidate_id
  where r.review_day = 30 and r.active_status = 'yes';

  select count(*) into v_eligible_60
  from public.recruitment_candidates c
  where c.profile_id is not null and c.hire_date <= current_date - 60;

  select count(*) into v_active_60
  from public.recruitment_retention_reviews r
  where r.review_day = 60 and r.active_status = 'yes';

  select count(*) into v_eligible_90
  from public.recruitment_candidates c
  where c.profile_id is not null and c.hire_date <= current_date - 90;

  select count(*) into v_active_90
  from public.recruitment_retention_reviews r
  where r.review_day = 90 and r.active_status = 'yes';

  select count(*) into v_early_exits
  from public.recruitment_retention_reviews r
  where r.active_status = 'no';

  select c.source into v_best_source
  from public.recruitment_candidates c
  join public.recruitment_retention_reviews r on r.candidate_id = c.id and r.review_day = 90 and r.active_status = 'yes'
  group by c.source
  order by count(*) desc
  limit 1;

  select c.final_position into v_worst_position
  from public.recruitment_candidates c
  join public.recruitment_retention_reviews r on r.candidate_id = c.id and r.active_status = 'no'
  group by c.final_position
  order by count(*) desc
  limit 1;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'converted_to_employees', coalesce(v_converted, 0),
    'onboardings_open', coalesce(v_onboarding_open, 0),
    'onboardings_completed', coalesce(v_onboarding_done, 0),
    'onboardings_overdue', coalesce(v_onboarding_overdue, 0),
    'hired_pending_conversion', coalesce(v_hired_without_expediente, 0),
    'retention_30_eligible', coalesce(v_eligible_30, 0),
    'retention_30_active', coalesce(v_active_30, 0),
    'retention_30_rate', case when coalesce(v_eligible_30, 0) = 0 then 0 else round((v_active_30::numeric / v_eligible_30) * 100, 1) end,
    'retention_60_eligible', coalesce(v_eligible_60, 0),
    'retention_60_active', coalesce(v_active_60, 0),
    'retention_60_rate', case when coalesce(v_eligible_60, 0) = 0 then 0 else round((v_active_60::numeric / v_eligible_60) * 100, 1) end,
    'retention_90_eligible', coalesce(v_eligible_90, 0),
    'retention_90_active', coalesce(v_active_90, 0),
    'retention_90_rate', case when coalesce(v_eligible_90, 0) = 0 then 0 else round((v_active_90::numeric / v_eligible_90) * 100, 1) end,
    'early_exits', coalesce(v_early_exits, 0),
    'best_retention_source', v_best_source,
    'highest_early_turnover_position', v_worst_position
  );
end;
$$;

-- Extend candidate detail with conversion + onboarding summary
create or replace function public.get_recruitment_candidate_detail(p_candidate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_candidate public.recruitment_candidates;
  v_vacancy public.recruitment_vacancies;
  v_base jsonb;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para consultar candidatos.';
  end if;

  select * into v_candidate from public.recruitment_candidates where id = p_candidate_id;
  if v_candidate.id is null then
    raise exception 'Candidato no encontrado.';
  end if;

  select * into v_vacancy from public.recruitment_vacancies where id = v_candidate.vacancy_id;

  v_base := jsonb_build_object(
    'candidate', to_jsonb(v_candidate),
    'vacancy', to_jsonb(v_vacancy),
    'contacts', coalesce((
      select jsonb_agg(to_jsonb(ct) order by ct.contacted_at desc)
      from public.recruitment_candidate_contacts ct where ct.candidate_id = p_candidate_id
    ), '[]'::jsonb),
    'interviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'interview', to_jsonb(i),
          'responsible_name', rp.full_name,
          'evaluation', (select to_jsonb(ev) from public.recruitment_interview_evaluations ev where ev.interview_id = i.id)
        ) order by i.scheduled_date desc, i.scheduled_time desc nulls last
      )
      from public.recruitment_interviews i
      left join public.profiles rp on rp.id = i.responsible_profile_id
      where i.candidate_id = p_candidate_id
    ), '[]'::jsonb),
    'status_history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.changed_at desc)
      from public.recruitment_candidate_status_history h where h.candidate_id = p_candidate_id
    ), '[]'::jsonb),
    'onboarding', (
      select to_jsonb(o) from public.recruitment_onboarding_checklists o where o.candidate_id = p_candidate_id
    ),
    'retention_reviews', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.review_day)
      from public.recruitment_retention_reviews r where r.candidate_id = p_candidate_id
    ), '[]'::jsonb),
    'employee_profile', (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'username', p.username, 'role', p.role, 'area_name', p.area_name)
      from public.profiles p where p.id = v_candidate.profile_id
    )
  );

  return v_base;
end;
$$;

-- Extend list candidates with conversion fields
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.can_view_recruitment_onboarding() from public;
revoke all on function public.can_access_recruitment_onboarding(public.recruitment_onboarding_checklists) from public;
revoke all on function public.can_access_recruitment_onboarding_task(public.recruitment_onboarding_tasks) from public;
revoke all on function public.recruitment_notify(uuid, text, text, text, text, text, text, text) from public;
revoke all on function public.recruitment_default_onboarding_tasks(uuid, uuid, uuid, date) from public;
revoke all on function public.recruitment_seed_retention_reviews(uuid, uuid, date) from public;
revoke all on function public.convert_recruitment_candidate_to_employee(uuid, uuid, jsonb) from public;
revoke all on function public.update_recruitment_onboarding_task_status(uuid, text, text) from public;
revoke all on function public.list_recruitment_onboardings(text) from public;
revoke all on function public.record_recruitment_retention_review(uuid, integer, text, text, text) from public;
revoke all on function public.list_recruitment_retention_cases() from public;
revoke all on function public.get_recruitment_origin_for_profile(uuid) from public;
revoke all on function public.get_recruitment_phase2_dashboard(date, date) from public;

grant execute on function public.can_view_recruitment_onboarding() to authenticated;
grant execute on function public.can_access_recruitment_onboarding(public.recruitment_onboarding_checklists) to authenticated;
grant execute on function public.can_access_recruitment_onboarding_task(public.recruitment_onboarding_tasks) to authenticated;
grant execute on function public.recruitment_notify(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.recruitment_default_onboarding_tasks(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.recruitment_seed_retention_reviews(uuid, uuid, date) to authenticated;
grant execute on function public.convert_recruitment_candidate_to_employee(uuid, uuid, jsonb) to authenticated;
grant execute on function public.update_recruitment_onboarding_task_status(uuid, text, text) to authenticated;
grant execute on function public.list_recruitment_onboardings(text) to authenticated;
grant execute on function public.record_recruitment_retention_review(uuid, integer, text, text, text) to authenticated;
grant execute on function public.list_recruitment_retention_cases() to authenticated;
grant execute on function public.get_recruitment_origin_for_profile(uuid) to authenticated;
grant execute on function public.get_recruitment_phase2_dashboard(date, date) to authenticated;
