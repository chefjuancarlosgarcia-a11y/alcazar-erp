-- Wix "Trabaja con Nosotros" → recruitment_candidates
-- Apply after 123_supervisor_checklist_scope.sql

-- ---------------------------------------------------------------------------
-- Extend recruitment_candidates for website applications
-- ---------------------------------------------------------------------------

alter table public.recruitment_candidates
  add column if not exists email text,
  add column if not exists application_payload jsonb not null default '{}'::jsonb,
  add column if not exists attachment_url text;

alter table public.recruitment_candidates
  drop constraint if exists recruitment_candidates_source_check;

alter table public.recruitment_candidates
  add constraint recruitment_candidates_source_check
  check (source in (
    'facebook', 'empleo_restaurantes_xela', 'referral', 'walk_in', 'whatsapp', 'website', 'other'
  ));

create index if not exists recruitment_candidates_email_idx
  on public.recruitment_candidates (lower(trim(email)))
  where email is not null and trim(email) <> '';

create index if not exists recruitment_candidates_phone_norm_idx
  on public.recruitment_candidates (regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'))
  where phone is not null and trim(phone) <> '';

-- Vacante interna para aplicaciones del sitio web sin vacante específica
insert into public.recruitment_vacancies (
  position_title,
  area,
  quantity_required,
  reason,
  status,
  priority,
  notes
)
select
  'Aplicaciones sitio web',
  'General',
  1,
  'operational_reinforcement',
  'recruiting',
  'medium',
  'Vacante interna para candidatos del formulario Wix sin vacante abierta coincidente.'
where not exists (
  select 1
  from public.recruitment_vacancies v
  where v.position_title = 'Aplicaciones sitio web'
    and v.status in ('open', 'recruiting', 'interviewing')
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.recruitment_application_notification_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'admin',
    'gerente_general',
    'gerente',
    'recursos_humanos',
    'rrhh'
  ]::text[];
$$;

create or replace function public.recruitment_normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
$$;

create or replace function public.recruitment_website_vacancy_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
  from public.recruitment_vacancies v
  where v.position_title = 'Aplicaciones sitio web'
    and v.status in ('open', 'recruiting', 'interviewing')
  order by v.created_at desc
  limit 1;
$$;

create or replace function public.recruitment_resolve_vacancy_for_application(p_position text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_position text := nullif(trim(coalesce(p_position, '')), '');
  v_vacancy_id uuid;
begin
  if v_position is not null then
    select v.id
    into v_vacancy_id
    from public.recruitment_vacancies v
    where v.status in ('open', 'recruiting', 'interviewing')
      and v.position_title ilike '%' || v_position || '%'
    order by
      case v.status when 'recruiting' then 0 when 'open' then 1 else 2 end,
      v.request_date desc
    limit 1;
  end if;

  return coalesce(v_vacancy_id, public.recruitment_website_vacancy_id());
end;
$$;

create or replace function public.recruitment_parse_data_consent(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(trim(coalesce(p_value, '')));
begin
  return v in ('true', '1', 'yes', 'si', 'sí', 'on', 'acepto', 'accepted');
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification: new website application
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_recruitment_application(p_candidate_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.recruitment_candidates;
  v_message text;
  v_action_url text;
  v_inserted integer := 0;
begin
  if p_candidate_id is null then
    return 0;
  end if;

  select *
  into v_candidate
  from public.recruitment_candidates
  where id = p_candidate_id;

  if not found then
    return 0;
  end if;

  v_message := coalesce(v_candidate.full_name, 'Un candidato')
    || ' aplicó para '
    || coalesce(nullif(trim(v_candidate.position_applied), ''), 'un puesto')
    || ' desde el sitio web.';
  v_action_url := '/hr?section=reclutamiento&tab=pipeline&candidateId=' || v_candidate.id::text;

  with recipients as (
    select distinct p.id as profile_id
    from public.profiles p
    where p.status = 'active'
      and public.normalize_profile_role(p.role) = any(public.recruitment_application_notification_roles())
  ),
  inserted as (
    insert into public.notifications (
      user_id,
      target_role,
      type,
      title,
      message,
      entity_type,
      entity_id,
      action_url
    )
    select
      recipients.profile_id,
      null,
      'recruitment',
      'Nuevo candidato recibido',
      v_message,
      'recruitment_candidate',
      v_candidate.id::text,
      v_action_url
    from recipients
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = recipients.profile_id
        and n.type = 'recruitment'
        and n.entity_type = 'recruitment_candidate'
        and n.entity_id = v_candidate.id::text
        and n.title = 'Nuevo candidato recibido'
        and n.created_at > now() - interval '1 hour'
    )
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
exception
  when others then
    raise warning 'notify_new_recruitment_application failed for %: %', p_candidate_id, sqlerrm;
    return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_recruitment_application_from_website (service role / edge function)
-- ---------------------------------------------------------------------------

create or replace function public.create_recruitment_application_from_website(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_name text := nullif(trim(coalesce(p_data ->> 'first_name', '')), '');
  v_last_name text := nullif(trim(coalesce(p_data ->> 'last_name', '')), '');
  v_full_name text := nullif(trim(coalesce(p_data ->> 'full_name', '')), '');
  v_phone_raw text := nullif(trim(coalesce(p_data ->> 'phone', '')), '');
  v_phone text := public.recruitment_normalize_phone(v_phone_raw);
  v_email text := nullif(lower(trim(coalesce(p_data ->> 'email', ''))), '');
  v_applied_position text := nullif(trim(coalesce(
    p_data ->> 'applied_position',
    p_data ->> 'position_applied',
    ''
  )), '');
  v_data_consent boolean := public.recruitment_parse_data_consent(p_data ->> 'data_consent');
  v_age integer;
  v_submitted_at date;
  v_vacancy_id uuid;
  v_existing public.recruitment_candidates;
  v_row public.recruitment_candidates;
  v_payload jsonb;
  v_prior_experience text;
  v_motivation text;
  v_attachment_url text;
  v_is_duplicate boolean := false;
begin
  if auth.uid() is not null then
    raise exception 'Solo disponible para integraciones del sistema.';
  end if;

  if v_full_name is null then
    v_full_name := nullif(trim(concat_ws(' ', v_first_name, v_last_name)), '');
  end if;

  if v_full_name is null then
    raise exception 'first_name/last_name o full_name es obligatorio.';
  end if;

  if v_phone is null then
    raise exception 'phone es obligatorio.';
  end if;

  if v_applied_position is null then
    raise exception 'applied_position es obligatorio.';
  end if;

  if not v_data_consent then
    raise exception 'data_consent es obligatorio.';
  end if;

  if nullif(trim(coalesce(p_data ->> 'age', '')), '') is not null then
    v_age := nullif(trim(p_data ->> 'age'), '')::integer;
    if v_age is not null and (v_age < 16 or v_age > 99) then
      raise exception 'age debe estar entre 16 y 99.';
    end if;
  end if;

  if nullif(trim(coalesce(p_data ->> 'submitted_at', '')), '') is not null then
    begin
      v_submitted_at := nullif(trim(p_data ->> 'submitted_at'), '')::date;
    exception when others then
      v_submitted_at := (now() at time zone 'America/Guatemala')::date;
    end;
  else
    v_submitted_at := (now() at time zone 'America/Guatemala')::date;
  end if;

  v_attachment_url := nullif(trim(coalesce(
    p_data ->> 'attachment_url',
    p_data ->> 'document_url',
    ''
  )), '');

  v_prior_experience := nullif(trim(coalesce(
    p_data ->> 'prior_experience',
    p_data ->> 'has_experience',
    ''
  )), '');

  v_motivation := nullif(trim(coalesce(p_data ->> 'motivation', '')), '');

  v_payload := coalesce(p_data, '{}'::jsonb)
    || jsonb_build_object(
      'first_name', v_first_name,
      'last_name', v_last_name,
      'municipality', nullif(trim(coalesce(p_data ->> 'municipality', '')), ''),
      'education_level', nullif(trim(coalesce(p_data ->> 'education_level', '')), ''),
      'availability', nullif(trim(coalesce(p_data ->> 'availability', '')), ''),
      'available_start_date', nullif(trim(coalesce(p_data ->> 'available_start_date', '')), ''),
      'has_experience', nullif(trim(coalesce(p_data ->> 'has_experience', '')), ''),
      'motivation', v_motivation,
      'data_consent', v_data_consent,
      'source', 'website',
      'submitted_at', coalesce(p_data ->> 'submitted_at', v_submitted_at::text)
    );

  select c.*
  into v_existing
  from public.recruitment_candidates c
  where c.applied_at >= ((now() at time zone 'America/Guatemala')::date - 30)
    and (
      (v_email is not null and lower(trim(c.email)) = v_email)
      or (
        public.recruitment_normalize_phone(c.phone) = v_phone
        or public.recruitment_normalize_phone(c.whatsapp) = v_phone
      )
    )
  order by c.created_at desc
  limit 1;

  if v_existing.id is not null then
    v_is_duplicate := true;

    update public.recruitment_candidates
    set
      full_name = v_full_name,
      phone = v_phone_raw,
      email = coalesce(v_email, email),
      age = coalesce(v_age, age),
      address = coalesce(nullif(trim(coalesce(p_data ->> 'municipality', '')), ''), address),
      position_applied = v_applied_position,
      source = 'website',
      prior_experience = coalesce(v_prior_experience, prior_experience),
      schedule_availability = coalesce(nullif(trim(coalesce(p_data ->> 'availability', '')), ''), schedule_availability),
      salary_expectation = coalesce(nullif(trim(coalesce(p_data ->> 'salary_expectation', '')), ''), salary_expectation),
      attachment_url = coalesce(v_attachment_url, attachment_url),
      application_payload = coalesce(application_payload, '{}'::jsonb) || v_payload,
      notes = coalesce(v_motivation, notes),
      updated_at = now()
    where id = v_existing.id
    returning * into v_row;

    insert into public.recruitment_candidate_status_history (
      candidate_id, from_status, to_status, reason, notes, changed_by
    )
    values (
      v_row.id,
      v_row.pipeline_status,
      v_row.pipeline_status,
      'website_reapplication',
      'Nueva aplicación desde sitio web (' || v_submitted_at::text || ').',
      null
    );

    return jsonb_build_object(
      'id', v_row.id,
      'duplicate', true,
      'pipeline_status', v_row.pipeline_status,
      'vacancy_id', v_row.vacancy_id,
      'notification_count', 0
    );
  end if;

  v_vacancy_id := public.recruitment_resolve_vacancy_for_application(v_applied_position);
  if v_vacancy_id is null then
    raise exception 'No hay vacante disponible para registrar la aplicación.';
  end if;

  insert into public.recruitment_candidates (
    vacancy_id,
    full_name,
    phone,
    email,
    age,
    address,
    position_applied,
    source,
    prior_experience,
    schedule_availability,
    salary_expectation,
    pipeline_status,
    applied_at,
    notes,
    attachment_url,
    application_payload,
    created_by,
    updated_by
  )
  values (
    v_vacancy_id,
    v_full_name,
    v_phone_raw,
    v_email,
    v_age,
    nullif(trim(coalesce(p_data ->> 'municipality', '')), ''),
    v_applied_position,
    'website',
    v_prior_experience,
    nullif(trim(coalesce(p_data ->> 'availability', '')), ''),
    nullif(trim(coalesce(p_data ->> 'salary_expectation', '')), ''),
    'applied',
    v_submitted_at,
    v_motivation,
    v_attachment_url,
    v_payload,
    null,
    null
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'duplicate', false,
    'pipeline_status', v_row.pipeline_status,
    'vacancy_id', v_row.vacancy_id,
    'notification_count', public.notify_new_recruitment_application(v_row.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (service role only for public webhook)
-- ---------------------------------------------------------------------------

revoke all on function public.recruitment_application_notification_roles() from public;
revoke all on function public.recruitment_normalize_phone(text) from public;
revoke all on function public.recruitment_website_vacancy_id() from public;
revoke all on function public.recruitment_resolve_vacancy_for_application(text) from public;
revoke all on function public.recruitment_parse_data_consent(text) from public;
revoke all on function public.notify_new_recruitment_application(uuid) from public;
revoke all on function public.create_recruitment_application_from_website(jsonb) from public;

grant execute on function public.recruitment_application_notification_roles() to authenticated, service_role;
grant execute on function public.recruitment_normalize_phone(text) to authenticated, service_role;
grant execute on function public.recruitment_website_vacancy_id() to authenticated, service_role;
grant execute on function public.recruitment_resolve_vacancy_for_application(text) to authenticated, service_role;
grant execute on function public.recruitment_parse_data_consent(text) to authenticated, service_role;
grant execute on function public.notify_new_recruitment_application(uuid) to service_role;
grant execute on function public.create_recruitment_application_from_website(jsonb) to service_role;
