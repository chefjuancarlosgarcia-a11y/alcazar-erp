-- Employee expedientes: discipline & incidents
-- Apply after 092_employee_expedientes_document_ux.sql

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.employee_incidents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reference_code text,
  title text not null,
  description text,
  category text not null default 'other'
    check (category in ('attendance', 'conduct', 'performance', 'safety', 'policy', 'other')),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'under_review', 'closed')),
  incident_date date not null default current_date,
  location text,
  reported_by uuid references public.profiles(id) on delete set null,
  parent_incident_id uuid references public.employee_incidents(id) on delete set null,
  is_recurrence boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closure_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_incidents_profile_idx
  on public.employee_incidents (profile_id, incident_date desc);

create index if not exists employee_incidents_status_idx
  on public.employee_incidents (profile_id, status)
  where status in ('open', 'under_review');

create index if not exists employee_incidents_recurrence_idx
  on public.employee_incidents (profile_id, is_recurrence)
  where is_recurrence = true;

create table if not exists public.employee_disciplinary_actions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  incident_id uuid references public.employee_incidents(id) on delete set null,
  action_type text not null
    check (action_type in ('verbal_warning', 'memorandum', 'suspension', 'other')),
  title text not null,
  description text,
  effective_date date not null default current_date,
  end_date date,
  duration_days integer,
  status text not null default 'active'
    check (status in ('active', 'completed', 'revoked')),
  is_permanent_record boolean not null default true,
  issued_by uuid references public.profiles(id) on delete set null,
  document_storage_path text,
  document_file_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_disciplinary_actions_profile_idx
  on public.employee_disciplinary_actions (profile_id, effective_date desc);

create index if not exists employee_disciplinary_actions_incident_idx
  on public.employee_disciplinary_actions (incident_id);

create index if not exists employee_disciplinary_actions_type_idx
  on public.employee_disciplinary_actions (profile_id, action_type);

create table if not exists public.employee_incident_evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.employee_incidents(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  description text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_incident_evidence_incident_idx
  on public.employee_incident_evidence (incident_id, created_at desc);

-- ---------------------------------------------------------------------------
-- KPI helpers
-- ---------------------------------------------------------------------------

create or replace function public.employee_discipline_profile_kpis(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'verbal_warnings', (
      select count(*)
      from public.employee_disciplinary_actions a
      where a.profile_id = p_profile_id
        and a.action_type = 'verbal_warning'
        and a.status <> 'revoked'
    ),
    'memorandums', (
      select count(*)
      from public.employee_disciplinary_actions a
      where a.profile_id = p_profile_id
        and a.action_type = 'memorandum'
        and a.status <> 'revoked'
    ),
    'suspensions', (
      select count(*)
      from public.employee_disciplinary_actions a
      where a.profile_id = p_profile_id
        and a.action_type = 'suspension'
        and a.status <> 'revoked'
    ),
    'recurrences', (
      select count(*)
      from public.employee_incidents i
      where i.profile_id = p_profile_id
        and i.is_recurrence = true
    ),
    'open_incidents', (
      select count(*)
      from public.employee_incidents i
      where i.profile_id = p_profile_id
        and i.status in ('open', 'under_review')
    )
  );
$$;

create or replace function public.employee_discipline_global_kpis()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'verbal_warnings', (
      select count(*)
      from public.employee_disciplinary_actions a
      join public.profiles p on p.id = a.profile_id and p.status = 'active'
      where a.action_type = 'verbal_warning'
        and a.status <> 'revoked'
    ),
    'memorandums', (
      select count(*)
      from public.employee_disciplinary_actions a
      join public.profiles p on p.id = a.profile_id and p.status = 'active'
      where a.action_type = 'memorandum'
        and a.status <> 'revoked'
    ),
    'suspensions', (
      select count(*)
      from public.employee_disciplinary_actions a
      join public.profiles p on p.id = a.profile_id and p.status = 'active'
      where a.action_type = 'suspension'
        and a.status <> 'revoked'
    ),
    'recurrences', (
      select count(*)
      from public.employee_incidents i
      join public.profiles p on p.id = i.profile_id and p.status = 'active'
      where i.is_recurrence = true
    ),
    'open_incidents', (
      select count(*)
      from public.employee_incidents i
      join public.profiles p on p.id = i.profile_id and p.status = 'active'
      where i.status in ('open', 'under_review')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: discipline detail for expediente tab
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_discipline_detail(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para consultar disciplina.';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Colaborador no encontrado.';
  end if;

  return jsonb_build_object(
    'kpis', public.employee_discipline_profile_kpis(p_profile_id),
    'incidents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'incident', to_jsonb(i),
          'reported_by_name', rp.full_name,
          'closed_by_name', cp.full_name,
          'parent_title', pp.title,
          'evidence', coalesce((
            select jsonb_agg(to_jsonb(e) order by e.created_at desc)
            from public.employee_incident_evidence e
            where e.incident_id = i.id
          ), '[]'::jsonb),
          'actions', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'action', to_jsonb(a),
                'issued_by_name', ip.full_name
              ) order by a.effective_date desc, a.created_at desc
            )
            from public.employee_disciplinary_actions a
            left join public.profiles ip on ip.id = a.issued_by
            where a.incident_id = i.id
          ), '[]'::jsonb)
        ) order by i.incident_date desc, i.created_at desc
      )
      from public.employee_incidents i
      left join public.profiles rp on rp.id = i.reported_by
      left join public.profiles cp on cp.id = i.closed_by
      left join public.employee_incidents pp on pp.id = i.parent_incident_id
      where i.profile_id = p_profile_id
    ), '[]'::jsonb),
    'disciplinary_actions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'action', to_jsonb(a),
          'issued_by_name', ip.full_name,
          'incident_title', i.title,
          'incident_status', i.status,
          'incident_reference', i.reference_code
        ) order by a.effective_date desc, a.created_at desc
      )
      from public.employee_disciplinary_actions a
      left join public.profiles ip on ip.id = a.issued_by
      left join public.employee_incidents i on i.id = a.incident_id
      where a.profile_id = p_profile_id
        and a.status <> 'revoked'
    ), '[]'::jsonb),
    'can_write', public.can_write_employee_expedientes()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: upsert incident
-- ---------------------------------------------------------------------------

create or replace function public.upsert_employee_incident(
  p_profile_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(trim(coalesce(p_data ->> 'id', '')), '')::uuid;
  v_category text := lower(trim(coalesce(p_data ->> 'category', 'other')));
  v_incident public.employee_incidents;
  v_parent_id uuid;
  v_ref text;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para registrar incidentes.';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id and status = 'active') then
    raise exception 'Colaborador no encontrado o inactivo.';
  end if;

  if v_id is not null then
    select * into v_incident
    from public.employee_incidents
    where id = v_id and profile_id = p_profile_id;

    if not found then
      raise exception 'Incidente no encontrado.';
    end if;

    if v_incident.status = 'closed' then
      raise exception 'No se puede editar un incidente cerrado.';
    end if;

    update public.employee_incidents
    set
      title = coalesce(nullif(trim(p_data ->> 'title'), ''), title),
      description = coalesce(p_data ->> 'description', description),
      category = coalesce(nullif(v_category, ''), category),
      severity = coalesce(nullif(trim(p_data ->> 'severity'), ''), severity),
      status = coalesce(nullif(trim(p_data ->> 'status'), ''), status),
      incident_date = coalesce((p_data ->> 'incident_date')::date, incident_date),
      location = coalesce(p_data ->> 'location', location),
      updated_at = now()
    where id = v_id
    returning * into v_incident;

    return to_jsonb(v_incident);
  end if;

  select i.id into v_parent_id
  from public.employee_incidents i
  where i.profile_id = p_profile_id
    and i.category = v_category
    and i.status = 'closed'
  order by i.closed_at desc nulls last, i.incident_date desc
  limit 1;

  v_ref := 'INC-' || to_char(current_date, 'YYYY') || '-'
    || lpad((
      select count(*) + 1
      from public.employee_incidents
      where profile_id = p_profile_id
        and extract(year from created_at) = extract(year from current_date)
    )::text, 4, '0');

  insert into public.employee_incidents (
    profile_id, reference_code, title, description, category, severity, status,
    incident_date, location, reported_by, parent_incident_id, is_recurrence
  )
  values (
    p_profile_id,
    v_ref,
    coalesce(nullif(trim(p_data ->> 'title'), ''), 'Incidente laboral'),
    nullif(trim(coalesce(p_data ->> 'description', '')), ''),
    v_category,
    coalesce(nullif(trim(p_data ->> 'severity'), ''), 'medium'),
    coalesce(nullif(trim(p_data ->> 'status'), ''), 'open'),
    coalesce((p_data ->> 'incident_date')::date, current_date),
    nullif(trim(coalesce(p_data ->> 'location', '')), ''),
    auth.uid(),
    v_parent_id,
    v_parent_id is not null
  )
  returning * into v_incident;

  return to_jsonb(v_incident);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: close incident (actions remain in expediente)
-- ---------------------------------------------------------------------------

create or replace function public.close_employee_incident(
  p_incident_id uuid,
  p_closure_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.employee_incidents;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para cerrar incidentes.';
  end if;

  select * into v_incident
  from public.employee_incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incidente no encontrado.';
  end if;

  if v_incident.status = 'closed' then
    return to_jsonb(v_incident);
  end if;

  update public.employee_incidents
  set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    closure_summary = nullif(trim(coalesce(p_closure_summary, '')), ''),
    updated_at = now()
  where id = p_incident_id
  returning * into v_incident;

  return to_jsonb(v_incident);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: disciplinary action (permanent record)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_disciplinary_action(
  p_profile_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(trim(coalesce(p_data ->> 'id', '')), '')::uuid;
  v_incident_id uuid := nullif(trim(coalesce(p_data ->> 'incident_id', '')), '')::uuid;
  v_action_type text := lower(trim(coalesce(p_data ->> 'action_type', 'verbal_warning')));
  v_action public.employee_disciplinary_actions;
  v_duration integer;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para registrar acciones disciplinarias.';
  end if;

  if v_incident_id is not null then
    if not exists (
      select 1 from public.employee_incidents
      where id = v_incident_id and profile_id = p_profile_id
    ) then
      raise exception 'Incidente invalido para este colaborador.';
    end if;
  end if;

  v_duration := nullif(trim(coalesce(p_data ->> 'duration_days', '')), '')::integer;

  if v_id is not null then
    select * into v_action
    from public.employee_disciplinary_actions
    where id = v_id and profile_id = p_profile_id;

    if not found then
      raise exception 'Accion disciplinaria no encontrada.';
    end if;

    update public.employee_disciplinary_actions
    set
      title = coalesce(nullif(trim(p_data ->> 'title'), ''), title),
      description = coalesce(p_data ->> 'description', description),
      action_type = coalesce(nullif(v_action_type, ''), action_type),
      effective_date = coalesce((p_data ->> 'effective_date')::date, effective_date),
      end_date = coalesce((p_data ->> 'end_date')::date, end_date),
      duration_days = coalesce(v_duration, duration_days),
      status = coalesce(nullif(trim(p_data ->> 'status'), ''), status),
      document_storage_path = coalesce(p_data ->> 'document_storage_path', document_storage_path),
      document_file_name = coalesce(p_data ->> 'document_file_name', document_file_name),
      updated_at = now()
    where id = v_id
    returning * into v_action;

    return to_jsonb(v_action);
  end if;

  insert into public.employee_disciplinary_actions (
    profile_id, incident_id, action_type, title, description,
    effective_date, end_date, duration_days, status, issued_by,
    document_storage_path, document_file_name, is_permanent_record
  )
  values (
    p_profile_id,
    v_incident_id,
    v_action_type,
    coalesce(nullif(trim(p_data ->> 'title'), ''), 'Accion disciplinaria'),
    nullif(trim(coalesce(p_data ->> 'description', '')), ''),
    coalesce((p_data ->> 'effective_date')::date, current_date),
    (p_data ->> 'end_date')::date,
    v_duration,
    coalesce(nullif(trim(p_data ->> 'status'), ''), 'active'),
    auth.uid(),
    nullif(trim(coalesce(p_data ->> 'document_storage_path', '')), ''),
    nullif(trim(coalesce(p_data ->> 'document_file_name', '')), ''),
    true
  )
  returning * into v_action;

  return to_jsonb(v_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: register incident evidence
-- ---------------------------------------------------------------------------

create or replace function public.register_incident_evidence(
  p_incident_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_file_size bigint default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.employee_incidents;
  v_evidence public.employee_incident_evidence;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para cargar evidencia.';
  end if;

  select * into v_incident
  from public.employee_incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incidente no encontrado.';
  end if;

  insert into public.employee_incident_evidence (
    incident_id, profile_id, storage_path, file_name, mime_type, file_size,
    description, uploaded_by
  )
  values (
    p_incident_id,
    v_incident.profile_id,
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_file_size,
    nullif(trim(coalesce(p_description, '')), ''),
    auth.uid()
  )
  returning * into v_evidence;

  return to_jsonb(v_evidence);
end;
$$;

-- ---------------------------------------------------------------------------
-- Extend dashboard KPIs
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_expedientes_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_discipline jsonb;
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para consultar expedientes.';
  end if;

  v_discipline := public.employee_discipline_global_kpis();

  return jsonb_build_object(
    'expired_documents', (
      select count(*)
      from public.employee_file_versions v
      where v.is_current = true
        and not coalesce(v.no_expires, false)
        and v.expires_at is not null
        and v.expires_at < current_date
    ),
    'expiring_soon', (
      select count(*)
      from public.employee_file_versions v
      where v.is_current = true
        and not coalesce(v.no_expires, false)
        and v.expires_at is not null
        and v.expires_at between current_date and current_date + 30
    ),
    'incomplete_files', (
      select count(*)
      from public.profiles p
      where p.status = 'active'
        and public.employee_expediente_status(p.id) = 'incomplete'
    ),
    'complete_files', (
      select count(*)
      from public.profiles p
      where p.status = 'active'
        and public.employee_expediente_status(p.id) = 'complete'
    ),
    'expired_profiles', (
      select count(*)
      from public.profiles p
      where p.status = 'active'
        and public.employee_expediente_status(p.id) = 'expired'
    ),
    'discipline', v_discipline,
    'verbal_warnings', v_discipline -> 'verbal_warnings',
    'memorandums', v_discipline -> 'memorandums',
    'suspensions', v_discipline -> 'suspensions',
    'recurrences', v_discipline -> 'recurrences',
    'open_incidents', v_discipline -> 'open_incidents'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Extend expediente detail with discipline KPIs
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_expediente_detail(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_extra public.employee_file_profiles;
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para consultar expedientes.';
  end if;

  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Colaborador no encontrado.';
  end if;

  select * into v_extra from public.employee_file_profiles where profile_id = p_profile_id;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'extra', coalesce(to_jsonb(v_extra), '{}'::jsonb),
    'completeness', public.employee_expediente_completeness(p_profile_id),
    'status', public.employee_expediente_status(p_profile_id),
    'summary', jsonb_build_object(
      'valid_count', (
        select count(*)
        from public.employee_file_versions v
        where v.profile_id = p_profile_id and v.is_current = true
          and public.employee_file_expiry_status(v.expires_at, v.no_expires) in ('valid', 'none')
      ),
      'expired_count', (
        select count(*)
        from public.employee_file_versions v
        where v.profile_id = p_profile_id and v.is_current = true
          and public.employee_file_expiry_status(v.expires_at, v.no_expires) = 'expired'
      ),
      'missing_count', coalesce((public.employee_expediente_completeness(p_profile_id) ->> 'missing_count')::integer, 0)
    ),
    'discipline_kpis', public.employee_discipline_profile_kpis(p_profile_id),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'file', to_jsonb(f),
        'type', to_jsonb(ft),
        'current_version', (
          select to_jsonb(v)
          from public.employee_file_versions v
          where v.id = f.current_version_id
        ),
        'versions', coalesce((
          select jsonb_agg(to_jsonb(v) order by v.version_number desc)
          from public.employee_file_versions v
          where v.employee_file_id = f.id
        ), '[]'::jsonb),
        'expiry_status', (
          select public.employee_file_expiry_status(v.expires_at, v.no_expires)
          from public.employee_file_versions v
          where v.id = f.current_version_id
        )
      ) order by ft.sort_order)
      from public.employee_files f
      join public.employee_file_types ft on ft.code = f.file_type_code
      where f.profile_id = p_profile_id
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(to_jsonb(ft) order by ft.sort_order)
      from public.employee_file_types ft
    ), '[]'::jsonb),
    'labor_history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.effective_date desc nulls last, h.created_at desc)
      from public.employee_labor_history h
      where h.profile_id = p_profile_id
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from public.employee_file_alerts a
      where a.profile_id = p_profile_id and a.resolved_at is null
    ), '[]'::jsonb),
    'can_write', public.can_write_employee_expedientes(),
    'requires_food_handling', public.is_food_handling_area(v_profile.area_name, v_profile.area_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.employee_incidents enable row level security;
alter table public.employee_disciplinary_actions enable row level security;
alter table public.employee_incident_evidence enable row level security;

grant select, insert, update on public.employee_incidents to authenticated;
grant select, insert, update on public.employee_disciplinary_actions to authenticated;
grant select, insert on public.employee_incident_evidence to authenticated;

drop policy if exists "employee_incidents_read" on public.employee_incidents;
create policy "employee_incidents_read"
  on public.employee_incidents for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_incidents_write" on public.employee_incidents;
create policy "employee_incidents_write"
  on public.employee_incidents for all to authenticated
  using (public.can_write_employee_expedientes())
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_disciplinary_actions_read" on public.employee_disciplinary_actions;
create policy "employee_disciplinary_actions_read"
  on public.employee_disciplinary_actions for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_disciplinary_actions_write" on public.employee_disciplinary_actions;
create policy "employee_disciplinary_actions_write"
  on public.employee_disciplinary_actions for all to authenticated
  using (public.can_write_employee_expedientes())
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_incident_evidence_read" on public.employee_incident_evidence;
create policy "employee_incident_evidence_read"
  on public.employee_incident_evidence for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_incident_evidence_write" on public.employee_incident_evidence;
create policy "employee_incident_evidence_write"
  on public.employee_incident_evidence for insert to authenticated
  with check (public.can_write_employee_expedientes());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.employee_discipline_profile_kpis(uuid) from public;
revoke all on function public.employee_discipline_global_kpis() from public;
revoke all on function public.get_employee_discipline_detail(uuid) from public;
revoke all on function public.upsert_employee_incident(uuid, jsonb) from public;
revoke all on function public.close_employee_incident(uuid, text) from public;
revoke all on function public.upsert_disciplinary_action(uuid, jsonb) from public;
revoke all on function public.register_incident_evidence(uuid, text, text, text, bigint, text) from public;

grant execute on function public.employee_discipline_profile_kpis(uuid) to authenticated;
grant execute on function public.employee_discipline_global_kpis() to authenticated;
grant execute on function public.get_employee_discipline_detail(uuid) to authenticated;
grant execute on function public.upsert_employee_incident(uuid, jsonb) to authenticated;
grant execute on function public.close_employee_incident(uuid, text) to authenticated;
grant execute on function public.upsert_disciplinary_action(uuid, jsonb) to authenticated;
grant execute on function public.register_incident_evidence(uuid, text, text, text, bigint, text) to authenticated;
