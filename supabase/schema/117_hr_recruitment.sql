-- HR Recruitment pipeline (Fase 1)
-- Apply after 116_operational_processes.sql

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_recruitment()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin',
        'gerente_general',
        'gerente',
        'recursos_humanos',
        'rrhh'
      )
  );
$$;

create or replace function public.can_create_recruitment_vacancy()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin',
        'gerente_general',
        'gerente',
        'recursos_humanos',
        'rrhh',
        'supervisor'
      )
  );
$$;

-- can_read_recruitment_vacancy defined after recruitment_vacancies table

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.recruitment_vacancies (
  id uuid primary key default gen_random_uuid(),
  position_title text not null,
  area text,
  quantity_required integer not null default 1 check (quantity_required >= 1),
  quantity_filled integer not null default 0 check (quantity_filled >= 0),
  requested_by uuid references public.profiles(id) on delete set null,
  request_date date not null default (now() at time zone 'America/Guatemala')::date,
  target_date date,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  reason text not null default 'replacement'
    check (reason in (
      'resignation', 'replacement', 'expansion', 'temporary', 'operational_reinforcement'
    )),
  status text not null default 'open'
    check (status in ('open', 'recruiting', 'interviewing', 'filled', 'cancelled')),
  notes text,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.recruitment_candidates (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.recruitment_vacancies(id) on delete restrict,
  full_name text not null,
  phone text,
  whatsapp text,
  age integer check (age is null or (age >= 16 and age <= 99)),
  address text,
  position_applied text,
  source text not null default 'other'
    check (source in (
      'facebook', 'empleo_restaurantes_xela', 'referral', 'walk_in', 'whatsapp', 'other'
    )),
  prior_experience text,
  schedule_availability text,
  salary_expectation text,
  pipeline_status text not null default 'applied'
    check (pipeline_status in (
      'applied', 'contacted', 'interview_scheduled', 'interviewed',
      'offer', 'hired', 'discarded'
    )),
  applied_at date not null default (now() at time zone 'America/Guatemala')::date,
  notes text,
  discard_reason text
    check (discard_reason is null or discard_reason in (
      'no_response', 'no_show', 'salary', 'schedule', 'no_experience',
      'far_location', 'bad_attitude', 'bad_presentation', 'profile_mismatch', 'other'
    )),
  discard_notes text,
  internal_notes text,
  hired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.recruitment_candidate_contacts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.recruitment_candidates(id) on delete cascade,
  contacted_at timestamptz not null default now(),
  contact_type text not null default 'call'
    check (contact_type in ('call', 'whatsapp', 'in_person', 'other')),
  result text not null default 'no_answer'
    check (result in (
      'answered', 'no_answer', 'wrong_number', 'callback_requested', 'not_interested'
    )),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

create table if not exists public.recruitment_interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.recruitment_candidates(id) on delete cascade,
  scheduled_date date not null,
  scheduled_time time,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  location_modality text,
  notes text,
  result text
    check (result is null or result in ('attended', 'no_show', 'rescheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.recruitment_interview_evaluations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.recruitment_interviews(id) on delete cascade,
  presentation_score smallint not null check (presentation_score between 1 and 5),
  communication_score smallint not null check (communication_score between 1 and 5),
  experience_score smallint not null check (experience_score between 1 and 5),
  attitude_score smallint not null check (attitude_score between 1 and 5),
  availability_score smallint not null check (availability_score between 1 and 5),
  comments text,
  recommendation text not null
    check (recommendation in ('hire', 'second_interview', 'discard')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

create table if not exists public.recruitment_candidate_status_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.recruitment_candidates(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  notes text,
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists recruitment_vacancies_status_idx
  on public.recruitment_vacancies (status);

create index if not exists recruitment_vacancies_area_idx
  on public.recruitment_vacancies (area);

create index if not exists recruitment_vacancies_priority_idx
  on public.recruitment_vacancies (priority);

create index if not exists recruitment_vacancies_request_date_idx
  on public.recruitment_vacancies (request_date desc);

create index if not exists recruitment_vacancies_requested_by_idx
  on public.recruitment_vacancies (requested_by);

create index if not exists recruitment_candidates_vacancy_idx
  on public.recruitment_candidates (vacancy_id);

create index if not exists recruitment_candidates_pipeline_idx
  on public.recruitment_candidates (pipeline_status);

create index if not exists recruitment_candidates_source_idx
  on public.recruitment_candidates (source);

create index if not exists recruitment_candidates_applied_at_idx
  on public.recruitment_candidates (applied_at desc);

create index if not exists recruitment_candidate_contacts_candidate_idx
  on public.recruitment_candidate_contacts (candidate_id, contacted_at desc);

create index if not exists recruitment_interviews_candidate_idx
  on public.recruitment_interviews (candidate_id, scheduled_date desc);

create index if not exists recruitment_status_history_candidate_idx
  on public.recruitment_candidate_status_history (candidate_id, changed_at desc);

create or replace function public.can_read_recruitment_vacancy(p_vacancy public.recruitment_vacancies)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.can_manage_recruitment()
    or (
      public.can_create_recruitment_vacancy()
      and p_vacancy.requested_by = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_recruitment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recruitment_vacancies_updated_at on public.recruitment_vacancies;
create trigger recruitment_vacancies_updated_at
  before update on public.recruitment_vacancies
  for each row execute procedure public.set_recruitment_updated_at();

drop trigger if exists recruitment_candidates_updated_at on public.recruitment_candidates;
create trigger recruitment_candidates_updated_at
  before update on public.recruitment_candidates
  for each row execute procedure public.set_recruitment_updated_at();

drop trigger if exists recruitment_interviews_updated_at on public.recruitment_interviews;
create trigger recruitment_interviews_updated_at
  before update on public.recruitment_interviews
  for each row execute procedure public.set_recruitment_updated_at();

-- ---------------------------------------------------------------------------
-- Status history trigger
-- ---------------------------------------------------------------------------

create or replace function public.tg_recruitment_candidate_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.pipeline_status is distinct from new.pipeline_status then
    insert into public.recruitment_candidate_status_history (
      candidate_id, from_status, to_status, reason, notes, changed_by
    )
    values (
      new.id,
      old.pipeline_status,
      new.pipeline_status,
      new.discard_reason,
      coalesce(new.discard_notes, new.internal_notes),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists recruitment_candidate_status_history_trg on public.recruitment_candidates;
create trigger recruitment_candidate_status_history_trg
  after update of pipeline_status on public.recruitment_candidates
  for each row execute function public.tg_recruitment_candidate_status_history();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.recruitment_vacancies enable row level security;
alter table public.recruitment_candidates enable row level security;
alter table public.recruitment_candidate_contacts enable row level security;
alter table public.recruitment_interviews enable row level security;
alter table public.recruitment_interview_evaluations enable row level security;
alter table public.recruitment_candidate_status_history enable row level security;

grant select, insert, update on public.recruitment_vacancies to authenticated;
grant select, insert, update on public.recruitment_candidates to authenticated;
grant select, insert on public.recruitment_candidate_contacts to authenticated;
grant select, insert, update on public.recruitment_interviews to authenticated;
grant select, insert, update on public.recruitment_interview_evaluations to authenticated;
grant select on public.recruitment_candidate_status_history to authenticated;
grant all on public.recruitment_vacancies, public.recruitment_candidates,
  public.recruitment_candidate_contacts, public.recruitment_interviews,
  public.recruitment_interview_evaluations, public.recruitment_candidate_status_history
  to service_role;

drop policy if exists recruitment_vacancies_select on public.recruitment_vacancies;
create policy recruitment_vacancies_select on public.recruitment_vacancies
  for select to authenticated
  using (public.can_read_recruitment_vacancy(recruitment_vacancies));

drop policy if exists recruitment_vacancies_insert on public.recruitment_vacancies;
create policy recruitment_vacancies_insert on public.recruitment_vacancies
  for insert to authenticated
  with check (public.can_create_recruitment_vacancy());

drop policy if exists recruitment_vacancies_update on public.recruitment_vacancies;
create policy recruitment_vacancies_update on public.recruitment_vacancies
  for update to authenticated
  using (public.can_manage_recruitment() or requested_by = auth.uid())
  with check (public.can_manage_recruitment() or requested_by = auth.uid());

drop policy if exists recruitment_candidates_all on public.recruitment_candidates;
create policy recruitment_candidates_all on public.recruitment_candidates
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_contacts_all on public.recruitment_candidate_contacts;
create policy recruitment_contacts_all on public.recruitment_candidate_contacts
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_interviews_all on public.recruitment_interviews;
create policy recruitment_interviews_all on public.recruitment_interviews
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_evaluations_all on public.recruitment_interview_evaluations;
create policy recruitment_evaluations_all on public.recruitment_interview_evaluations
  for all to authenticated
  using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());

drop policy if exists recruitment_status_history_select on public.recruitment_candidate_status_history;
create policy recruitment_status_history_select on public.recruitment_candidate_status_history
  for select to authenticated
  using (public.can_manage_recruitment());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.recruitment_vacancy_pending(p_vacancy public.recruitment_vacancies)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(p_vacancy.quantity_required - p_vacancy.quantity_filled, 0);
$$;

create or replace function public.recruitment_vacancy_days_open(p_vacancy public.recruitment_vacancies)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    ((now() at time zone 'America/Guatemala')::date - p_vacancy.request_date),
    0
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: vacancies
-- ---------------------------------------------------------------------------

create or replace function public.list_recruitment_vacancies(
  p_status text default null,
  p_area text default null,
  p_priority text default null
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
  if not public.can_create_recruitment_vacancy() then
    raise exception 'No tienes permiso para consultar vacantes.';
  end if;

  select coalesce(jsonb_agg(row order by row ->> 'request_date' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', v.id,
      'position_title', v.position_title,
      'area', v.area,
      'quantity_required', v.quantity_required,
      'quantity_filled', v.quantity_filled,
      'pending', public.recruitment_vacancy_pending(v),
      'requested_by', v.requested_by,
      'requested_by_name', rp.full_name,
      'request_date', v.request_date,
      'target_date', v.target_date,
      'days_open', public.recruitment_vacancy_days_open(v),
      'priority', v.priority,
      'reason', v.reason,
      'status', v.status,
      'notes', v.notes,
      'filled_at', v.filled_at,
      'candidate_count', (
        select count(*) from public.recruitment_candidates c where c.vacancy_id = v.id
      )
    ) as row
    from public.recruitment_vacancies v
    left join public.profiles rp on rp.id = v.requested_by
    where (public.can_manage_recruitment() or v.requested_by = auth.uid())
      and (p_status is null or v.status = p_status)
      and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%')
      and (p_priority is null or v.priority = p_priority)
  ) sub;

  return v_rows;
end;
$$;

create or replace function public.upsert_recruitment_vacancy(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.recruitment_vacancies;
begin
  if not public.can_create_recruitment_vacancy() then
    raise exception 'No tienes permiso para guardar vacantes.';
  end if;

  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;

  if v_id is null then
    insert into public.recruitment_vacancies (
      position_title, area, quantity_required, requested_by, request_date,
      target_date, priority, reason, status, notes, created_by, updated_by
    )
    values (
      trim(p_payload ->> 'position_title'),
      nullif(trim(coalesce(p_payload ->> 'area', '')), ''),
      greatest(coalesce((p_payload ->> 'quantity_required')::integer, 1), 1),
      coalesce(
        nullif(trim(coalesce(p_payload ->> 'requested_by', '')), '')::uuid,
        auth.uid()
      ),
      coalesce(nullif(trim(coalesce(p_payload ->> 'request_date', '')), '')::date, (now() at time zone 'America/Guatemala')::date),
      nullif(trim(coalesce(p_payload ->> 'target_date', '')), '')::date,
      coalesce(nullif(trim(p_payload ->> 'priority'), ''), 'medium'),
      coalesce(nullif(trim(p_payload ->> 'reason'), ''), 'replacement'),
      coalesce(nullif(trim(p_payload ->> 'status'), ''), 'open'),
      nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
      auth.uid(),
      auth.uid()
    )
    returning * into v_row;
  else
    if not public.can_manage_recruitment() then
      select * into v_row from public.recruitment_vacancies where id = v_id and requested_by = auth.uid();
      if v_row.id is null then
        raise exception 'No tienes permiso para editar esta vacante.';
      end if;
    end if;

    update public.recruitment_vacancies
    set
      position_title = trim(p_payload ->> 'position_title'),
      area = nullif(trim(coalesce(p_payload ->> 'area', '')), ''),
      quantity_required = greatest(coalesce((p_payload ->> 'quantity_required')::integer, quantity_required), 1),
      requested_by = coalesce(
        nullif(trim(coalesce(p_payload ->> 'requested_by', '')), '')::uuid,
        requested_by
      ),
      request_date = coalesce(nullif(trim(coalesce(p_payload ->> 'request_date', '')), '')::date, request_date),
      target_date = nullif(trim(coalesce(p_payload ->> 'target_date', '')), '')::date,
      priority = coalesce(nullif(trim(p_payload ->> 'priority'), ''), priority),
      reason = coalesce(nullif(trim(p_payload ->> 'reason'), ''), reason),
      status = coalesce(nullif(trim(p_payload ->> 'status'), ''), status),
      notes = nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
      updated_by = auth.uid()
    where id = v_id
    returning * into v_row;
  end if;

  return (select row from (
    select jsonb_build_object(
      'id', v_row.id,
      'position_title', v_row.position_title,
      'status', v_row.status
    ) as row
  ) q);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: candidates
-- ---------------------------------------------------------------------------

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
      'schedule_availability', c.schedule_availability
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
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para consultar candidatos.';
  end if;

  select * into v_candidate from public.recruitment_candidates where id = p_candidate_id;
  if v_candidate.id is null then
    raise exception 'Candidato no encontrado.';
  end if;

  select * into v_vacancy from public.recruitment_vacancies where id = v_candidate.vacancy_id;

  return jsonb_build_object(
    'candidate', to_jsonb(v_candidate),
    'vacancy', to_jsonb(v_vacancy),
    'contacts', coalesce((
      select jsonb_agg(to_jsonb(ct) order by ct.contacted_at desc)
      from public.recruitment_candidate_contacts ct
      where ct.candidate_id = p_candidate_id
    ), '[]'::jsonb),
    'interviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'interview', to_jsonb(i),
          'responsible_name', rp.full_name,
          'evaluation', (
            select to_jsonb(ev)
            from public.recruitment_interview_evaluations ev
            where ev.interview_id = i.id
          )
        ) order by i.scheduled_date desc, i.scheduled_time desc nulls last
      )
      from public.recruitment_interviews i
      left join public.profiles rp on rp.id = i.responsible_profile_id
      where i.candidate_id = p_candidate_id
    ), '[]'::jsonb),
    'status_history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.changed_at desc)
      from public.recruitment_candidate_status_history h
      where h.candidate_id = p_candidate_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_recruitment_candidate(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.recruitment_candidates;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para guardar candidatos.';
  end if;

  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;

  if v_id is null then
    insert into public.recruitment_candidates (
      vacancy_id, full_name, phone, whatsapp, age, address, position_applied,
      source, prior_experience, schedule_availability, salary_expectation,
      pipeline_status, applied_at, notes, internal_notes, created_by, updated_by
    )
    values (
      nullif(trim(p_payload ->> 'vacancy_id'), '')::uuid,
      trim(p_payload ->> 'full_name'),
      nullif(trim(coalesce(p_payload ->> 'phone', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'whatsapp', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'age', '')), '')::integer,
      nullif(trim(coalesce(p_payload ->> 'address', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'position_applied', '')), ''),
      coalesce(nullif(trim(p_payload ->> 'source'), ''), 'other'),
      nullif(trim(coalesce(p_payload ->> 'prior_experience', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'schedule_availability', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'salary_expectation', '')), ''),
      coalesce(nullif(trim(p_payload ->> 'pipeline_status'), ''), 'applied'),
      coalesce(nullif(trim(coalesce(p_payload ->> 'applied_at', '')), '')::date, (now() at time zone 'America/Guatemala')::date),
      nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), ''),
      auth.uid(),
      auth.uid()
    )
    returning * into v_row;
  else
    update public.recruitment_candidates
    set
      vacancy_id = coalesce(nullif(trim(p_payload ->> 'vacancy_id'), '')::uuid, vacancy_id),
      full_name = coalesce(nullif(trim(p_payload ->> 'full_name'), ''), full_name),
      phone = nullif(trim(coalesce(p_payload ->> 'phone', '')), ''),
      whatsapp = nullif(trim(coalesce(p_payload ->> 'whatsapp', '')), ''),
      age = nullif(trim(coalesce(p_payload ->> 'age', '')), '')::integer,
      address = nullif(trim(coalesce(p_payload ->> 'address', '')), ''),
      position_applied = nullif(trim(coalesce(p_payload ->> 'position_applied', '')), ''),
      source = coalesce(nullif(trim(p_payload ->> 'source'), ''), source),
      prior_experience = nullif(trim(coalesce(p_payload ->> 'prior_experience', '')), ''),
      schedule_availability = nullif(trim(coalesce(p_payload ->> 'schedule_availability', '')), ''),
      salary_expectation = nullif(trim(coalesce(p_payload ->> 'salary_expectation', '')), ''),
      notes = nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
      internal_notes = nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), ''),
      updated_by = auth.uid()
    where id = v_id
    returning * into v_row;
  end if;

  return jsonb_build_object('id', v_row.id);
end;
$$;

create or replace function public.update_recruitment_candidate_pipeline(
  p_candidate_id uuid,
  p_pipeline_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.recruitment_candidates;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para actualizar candidatos.';
  end if;

  update public.recruitment_candidates
  set
    pipeline_status = p_pipeline_status,
    internal_notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), internal_notes),
    updated_by = auth.uid()
  where id = p_candidate_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Candidato no encontrado.';
  end if;

  return jsonb_build_object('id', v_row.id, 'pipeline_status', v_row.pipeline_status);
end;
$$;

create or replace function public.register_recruitment_contact(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.recruitment_candidate_contacts;
  v_candidate_id uuid;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para registrar contactos.';
  end if;

  v_candidate_id := nullif(trim(p_payload ->> 'candidate_id'), '')::uuid;

  insert into public.recruitment_candidate_contacts (
    candidate_id, contacted_at, contact_type, result, notes, created_by
  )
  values (
    v_candidate_id,
    coalesce(nullif(trim(coalesce(p_payload ->> 'contacted_at', '')), '')::timestamptz, now()),
    coalesce(nullif(trim(p_payload ->> 'contact_type'), ''), 'call'),
    coalesce(nullif(trim(p_payload ->> 'result'), ''), 'no_answer'),
    nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
    auth.uid()
  )
  returning * into v_contact;

  update public.recruitment_candidates
  set pipeline_status = case
        when pipeline_status = 'applied' then 'contacted'
        else pipeline_status
      end,
      updated_by = auth.uid()
  where id = v_candidate_id
    and pipeline_status = 'applied';

  return to_jsonb(v_contact);
end;
$$;

create or replace function public.schedule_recruitment_interview(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.recruitment_interviews;
  v_candidate_id uuid;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para programar entrevistas.';
  end if;

  v_candidate_id := nullif(trim(p_payload ->> 'candidate_id'), '')::uuid;

  insert into public.recruitment_interviews (
    candidate_id, scheduled_date, scheduled_time, responsible_profile_id,
    location_modality, notes, created_by, updated_by
  )
  values (
    v_candidate_id,
    nullif(trim(p_payload ->> 'scheduled_date'), '')::date,
    nullif(trim(coalesce(p_payload ->> 'scheduled_time', '')), '')::time,
    nullif(trim(coalesce(p_payload ->> 'responsible_profile_id', '')), '')::uuid,
    nullif(trim(coalesce(p_payload ->> 'location_modality', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning * into v_interview;

  update public.recruitment_candidates
  set pipeline_status = 'interview_scheduled',
      updated_by = auth.uid()
  where id = v_candidate_id
    and pipeline_status in ('applied', 'contacted', 'interview_scheduled');

  return to_jsonb(v_interview);
end;
$$;

create or replace function public.update_recruitment_interview_result(
  p_interview_id uuid,
  p_result text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interview public.recruitment_interviews;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para actualizar entrevistas.';
  end if;

  update public.recruitment_interviews
  set
    result = p_result,
    notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
    updated_by = auth.uid()
  where id = p_interview_id
  returning * into v_interview;

  if v_interview.id is null then
    raise exception 'Entrevista no encontrada.';
  end if;

  if p_result = 'attended' then
    update public.recruitment_candidates
    set pipeline_status = 'interviewed', updated_by = auth.uid()
    where id = v_interview.candidate_id;
  elsif p_result = 'no_show' then
    update public.recruitment_candidates
    set
      discard_reason = 'no_show',
      discard_notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), discard_notes),
      pipeline_status = 'discarded',
      updated_by = auth.uid()
    where id = v_interview.candidate_id;
  end if;

  return to_jsonb(v_interview);
end;
$$;

create or replace function public.save_recruitment_interview_evaluation(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eval public.recruitment_interview_evaluations;
  v_interview_id uuid;
  v_recommendation text;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para guardar evaluaciones.';
  end if;

  v_interview_id := nullif(trim(p_payload ->> 'interview_id'), '')::uuid;
  v_recommendation := coalesce(nullif(trim(p_payload ->> 'recommendation'), ''), 'second_interview');

  insert into public.recruitment_interview_evaluations (
    interview_id, presentation_score, communication_score, experience_score,
    attitude_score, availability_score, comments, recommendation, created_by
  )
  values (
    v_interview_id,
    (p_payload ->> 'presentation_score')::smallint,
    (p_payload ->> 'communication_score')::smallint,
    (p_payload ->> 'experience_score')::smallint,
    (p_payload ->> 'attitude_score')::smallint,
    (p_payload ->> 'availability_score')::smallint,
    nullif(trim(coalesce(p_payload ->> 'comments', '')), ''),
    v_recommendation,
    auth.uid()
  )
  on conflict (interview_id) do update set
    presentation_score = excluded.presentation_score,
    communication_score = excluded.communication_score,
    experience_score = excluded.experience_score,
    attitude_score = excluded.attitude_score,
    availability_score = excluded.availability_score,
    comments = excluded.comments,
    recommendation = excluded.recommendation
  returning * into v_eval;

  if v_recommendation = 'hire' then
    update public.recruitment_candidates c
    set pipeline_status = 'offer', updated_by = auth.uid()
    from public.recruitment_interviews i
    where i.id = v_interview_id and c.id = i.candidate_id;
  elsif v_recommendation = 'discard' then
    update public.recruitment_candidates c
    set pipeline_status = 'discarded', discard_reason = 'profile_mismatch', updated_by = auth.uid()
    from public.recruitment_interviews i
    where i.id = v_interview_id and c.id = i.candidate_id;
  end if;

  return to_jsonb(v_eval);
end;
$$;

create or replace function public.discard_recruitment_candidate(
  p_candidate_id uuid,
  p_reason text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.recruitment_candidates;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para descartar candidatos.';
  end if;

  update public.recruitment_candidates
  set
    pipeline_status = 'discarded',
    discard_reason = p_reason,
    discard_notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid()
  where id = p_candidate_id
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'pipeline_status', v_row.pipeline_status);
end;
$$;

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
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para contratar candidatos.';
  end if;

  select * into v_candidate from public.recruitment_candidates where id = p_candidate_id for update;
  if v_candidate.id is null then
    raise exception 'Candidato no encontrado.';
  end if;

  update public.recruitment_candidates
  set pipeline_status = 'hired', hired_at = now(), updated_by = auth.uid()
  where id = p_candidate_id
  returning * into v_candidate;

  select * into v_vacancy from public.recruitment_vacancies where id = v_candidate.vacancy_id for update;

  update public.recruitment_vacancies
  set
    quantity_filled = least(quantity_filled + 1, quantity_required),
    updated_by = auth.uid(),
    filled_at = case
      when quantity_filled + 1 >= quantity_required then coalesce(filled_at, now())
      else filled_at
    end,
    status = case
      when quantity_filled + 1 >= quantity_required then 'filled'
      else status
    end
  where id = v_vacancy.id
  returning * into v_vacancy;

  v_pending := public.recruitment_vacancy_pending(v_vacancy);
  v_suggest_close := v_pending = 0;

  return jsonb_build_object(
    'candidate_id', v_candidate.id,
    'vacancy_id', v_vacancy.id,
    'quantity_filled', v_vacancy.quantity_filled,
    'pending', v_pending,
    'suggest_close_vacancy', v_suggest_close,
    'vacancy_status', v_vacancy.status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: KPIs
-- ---------------------------------------------------------------------------

create or replace function public.get_recruitment_kpis(
  p_date_from date default null,
  p_date_to date default null,
  p_position text default null,
  p_area text default null,
  p_source text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_date_from, ((now() at time zone 'America/Guatemala')::date - interval '30 days')::date);
  v_to date := coalesce(p_date_to, (now() at time zone 'America/Guatemala')::date);
  v_open_vacancies integer := 0;
  v_critical_vacancies integer := 0;
  v_applications integer := 0;
  v_contacted integer := 0;
  v_responded integer := 0;
  v_interviews_scheduled integer := 0;
  v_interviews_done integer := 0;
  v_no_shows integer := 0;
  v_offers integer := 0;
  v_hired integer := 0;
  v_discarded integer := 0;
  v_avg_coverage numeric := null;
begin
  if not public.can_manage_recruitment() then
    raise exception 'No tienes permiso para consultar KPIs de reclutamiento.';
  end if;

  select count(*) into v_open_vacancies
  from public.recruitment_vacancies v
  where v.status in ('open', 'recruiting', 'interviewing')
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%')
    and (p_position is null or nullif(trim(p_position), '') is null or v.position_title ilike '%' || trim(p_position) || '%');

  select count(*) into v_critical_vacancies
  from public.recruitment_vacancies v
  where v.status in ('open', 'recruiting', 'interviewing')
    and v.priority = 'critical'
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_applications
  from public.recruitment_candidates c
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where c.applied_at between v_from and v_to
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%')
    and (p_position is null or nullif(trim(p_position), '') is null or v.position_title ilike '%' || trim(p_position) || '%');

  select count(distinct ct.candidate_id) into v_contacted
  from public.recruitment_candidate_contacts ct
  join public.recruitment_candidates c on c.id = ct.candidate_id
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where ct.contacted_at::date between v_from and v_to
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_responded
  from public.recruitment_candidate_contacts ct
  join public.recruitment_candidates c on c.id = ct.candidate_id
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where ct.contacted_at::date between v_from and v_to
    and ct.result in ('answered', 'callback_requested')
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_interviews_scheduled
  from public.recruitment_interviews i
  join public.recruitment_candidates c on c.id = i.candidate_id
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where i.scheduled_date between v_from and v_to
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_interviews_done
  from public.recruitment_interviews i
  join public.recruitment_candidates c on c.id = i.candidate_id
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where i.scheduled_date between v_from and v_to
    and i.result = 'attended'
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_no_shows
  from public.recruitment_interviews i
  join public.recruitment_candidates c on c.id = i.candidate_id
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where i.scheduled_date between v_from and v_to
    and i.result = 'no_show'
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_offers
  from public.recruitment_candidates c
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where c.pipeline_status = 'offer'
    and c.applied_at between v_from and v_to
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_hired
  from public.recruitment_candidates c
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where c.pipeline_status = 'hired'
    and coalesce(c.hired_at::date, c.applied_at) between v_from and v_to
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select count(*) into v_discarded
  from public.recruitment_candidates c
  join public.recruitment_vacancies v on v.id = c.vacancy_id
  where c.pipeline_status = 'discarded'
    and c.applied_at between v_from and v_to
    and (p_source is null or c.source = p_source)
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  select round(avg((v.filled_at::date - v.request_date)), 1)
  into v_avg_coverage
  from public.recruitment_vacancies v
  where v.status = 'filled'
    and v.filled_at is not null
    and v.filled_at::date between v_from and v_to
    and (p_area is null or nullif(trim(p_area), '') is null or v.area ilike '%' || trim(p_area) || '%');

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'open_vacancies', coalesce(v_open_vacancies, 0),
    'critical_vacancies', coalesce(v_critical_vacancies, 0),
    'applications_received', coalesce(v_applications, 0),
    'candidates_contacted', coalesce(v_contacted, 0),
    'candidates_responded', coalesce(v_responded, 0),
    'interviews_scheduled', coalesce(v_interviews_scheduled, 0),
    'interviews_completed', coalesce(v_interviews_done, 0),
    'no_shows', coalesce(v_no_shows, 0),
    'offers_made', coalesce(v_offers, 0),
    'hired', coalesce(v_hired, 0),
    'discarded', coalesce(v_discarded, 0),
    'response_rate', case when coalesce(v_contacted, 0) = 0 then 0 else round((v_responded::numeric / v_contacted) * 100, 1) end,
    'attendance_rate', case when coalesce(v_interviews_scheduled, 0) = 0 then 0 else round((v_interviews_done::numeric / v_interviews_scheduled) * 100, 1) end,
    'no_show_rate', case when coalesce(v_interviews_scheduled, 0) = 0 then 0 else round((v_no_shows::numeric / v_interviews_scheduled) * 100, 1) end,
    'hire_rate', case when coalesce(v_applications, 0) = 0 then 0 else round((v_hired::numeric / v_applications) * 100, 1) end,
    'avg_coverage_days', v_avg_coverage
  );
end;
$$;

create or replace function public.get_recruitment_weekly_report(p_weeks integer default 8)
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
    raise exception 'No tienes permiso para consultar reportes de reclutamiento.';
  end if;

  select coalesce(jsonb_agg(row order by row ->> 'week_start' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'week_start', w.week_start,
      'week_label', to_char(w.week_start, 'DD Mon') || ' - ' || to_char(w.week_start + 6, 'DD Mon YYYY'),
      'open_vacancies', (
        select count(*) from public.recruitment_vacancies v
        where v.status in ('open', 'recruiting', 'interviewing')
          and v.request_date <= w.week_end
          and (v.filled_at is null or v.filled_at::date > w.week_end)
      ),
      'applications_received', (
        select count(*) from public.recruitment_candidates c
        where c.applied_at between w.week_start and w.week_end
      ),
      'contacted', (
        select count(distinct ct.candidate_id)
        from public.recruitment_candidate_contacts ct
        where ct.contacted_at::date between w.week_start and w.week_end
      ),
      'responded', (
        select count(*)
        from public.recruitment_candidate_contacts ct
        where ct.contacted_at::date between w.week_start and w.week_end
          and ct.result in ('answered', 'callback_requested')
      ),
      'interviews_scheduled', (
        select count(*) from public.recruitment_interviews i
        where i.scheduled_date between w.week_start and w.week_end
      ),
      'interviews_completed', (
        select count(*) from public.recruitment_interviews i
        where i.scheduled_date between w.week_start and w.week_end and i.result = 'attended'
      ),
      'no_shows', (
        select count(*) from public.recruitment_interviews i
        where i.scheduled_date between w.week_start and w.week_end and i.result = 'no_show'
      ),
      'hired', (
        select count(*) from public.recruitment_candidates c
        where c.pipeline_status = 'hired'
          and coalesce(c.hired_at::date, c.applied_at) between w.week_start and w.week_end
      ),
      'pending_positions', (
        select coalesce(sum(public.recruitment_vacancy_pending(v)), 0)
        from public.recruitment_vacancies v
        where v.status in ('open', 'recruiting', 'interviewing')
      )
    ) as row
    from (
      select
        ((now() at time zone 'America/Guatemala')::date - (n * 7)) - extract(dow from ((now() at time zone 'America/Guatemala')::date - (n * 7)))::integer + 1 as week_start,
        ((now() at time zone 'America/Guatemala')::date - (n * 7)) - extract(dow from ((now() at time zone 'America/Guatemala')::date - (n * 7)))::integer + 7 as week_end
      from generate_series(0, greatest(coalesce(p_weeks, 8), 1) - 1) as n
    ) w
  ) sub;

  return v_rows;
end;
$$;

create or replace function public.list_recruitment_profiles()
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
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'username', p.username,
      'role', p.role
    ) order by p.full_name)
    from public.profiles p
    where p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'gerente', 'recursos_humanos', 'rrhh', 'supervisor'
      )
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.can_manage_recruitment() from public;
revoke all on function public.can_create_recruitment_vacancy() from public;
revoke all on function public.can_read_recruitment_vacancy(public.recruitment_vacancies) from public;
revoke all on function public.recruitment_vacancy_pending(public.recruitment_vacancies) from public;
revoke all on function public.recruitment_vacancy_days_open(public.recruitment_vacancies) from public;
revoke all on function public.list_recruitment_vacancies(text, text, text) from public;
revoke all on function public.upsert_recruitment_vacancy(jsonb) from public;
revoke all on function public.list_recruitment_candidates(uuid, text, text, text, date, date) from public;
revoke all on function public.get_recruitment_candidate_detail(uuid) from public;
revoke all on function public.upsert_recruitment_candidate(jsonb) from public;
revoke all on function public.update_recruitment_candidate_pipeline(uuid, text, text) from public;
revoke all on function public.register_recruitment_contact(jsonb) from public;
revoke all on function public.schedule_recruitment_interview(jsonb) from public;
revoke all on function public.update_recruitment_interview_result(uuid, text, text) from public;
revoke all on function public.save_recruitment_interview_evaluation(jsonb) from public;
revoke all on function public.discard_recruitment_candidate(uuid, text, text) from public;
revoke all on function public.hire_recruitment_candidate(uuid) from public;
revoke all on function public.get_recruitment_kpis(date, date, text, text, text) from public;
revoke all on function public.get_recruitment_weekly_report(integer) from public;
revoke all on function public.list_recruitment_profiles() from public;

grant execute on function public.can_manage_recruitment() to authenticated;
grant execute on function public.can_create_recruitment_vacancy() to authenticated;
grant execute on function public.can_read_recruitment_vacancy(public.recruitment_vacancies) to authenticated;
grant execute on function public.recruitment_vacancy_pending(public.recruitment_vacancies) to authenticated;
grant execute on function public.recruitment_vacancy_days_open(public.recruitment_vacancies) to authenticated;
grant execute on function public.list_recruitment_vacancies(text, text, text) to authenticated;
grant execute on function public.upsert_recruitment_vacancy(jsonb) to authenticated;
grant execute on function public.list_recruitment_candidates(uuid, text, text, text, date, date) to authenticated;
grant execute on function public.get_recruitment_candidate_detail(uuid) to authenticated;
grant execute on function public.upsert_recruitment_candidate(jsonb) to authenticated;
grant execute on function public.update_recruitment_candidate_pipeline(uuid, text, text) to authenticated;
grant execute on function public.register_recruitment_contact(jsonb) to authenticated;
grant execute on function public.schedule_recruitment_interview(jsonb) to authenticated;
grant execute on function public.update_recruitment_interview_result(uuid, text, text) to authenticated;
grant execute on function public.save_recruitment_interview_evaluation(jsonb) to authenticated;
grant execute on function public.discard_recruitment_candidate(uuid, text, text) to authenticated;
grant execute on function public.hire_recruitment_candidate(uuid) to authenticated;
grant execute on function public.get_recruitment_kpis(date, date, text, text, text) to authenticated;
grant execute on function public.get_recruitment_weekly_report(integer) to authenticated;
grant execute on function public.list_recruitment_profiles() to authenticated;
