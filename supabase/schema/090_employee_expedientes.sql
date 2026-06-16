-- Employee HR files (Expedientes de Colaboradores)
-- Apply after 089_catering_manual_leads.sql

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_read_employee_expedientes()
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
        'recursos_humanos',
        'gerente_operaciones',
        'supervisor'
      )
  );
$$;

create or replace function public.can_write_employee_expedientes()
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
        'recursos_humanos'
      )
  );
$$;

create or replace function public.is_food_handling_area(p_area_name text, p_area_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(trim(coalesce(p_area_name, '')), ''),
    nullif(trim(coalesce(p_area_id, '')), ''),
    ''
  ) ~* '(cocina|barra|cafeter|cafeteria|catering|produccion|producción|pizzeria|panader|reposter)';
$$;

-- ---------------------------------------------------------------------------
-- Catalog: document types
-- ---------------------------------------------------------------------------

create table if not exists public.employee_file_types (
  code text primary key,
  label text not null,
  category text not null check (category in (
    'legal', 'recruitment', 'background', 'health', 'other'
  )),
  storage_folder text not null,
  is_required boolean not null default false,
  is_conditional boolean not null default false,
  requires_expiry boolean not null default false,
  requires_signature boolean not null default false,
  allows_multiple boolean not null default false,
  completeness_slot text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.employee_file_types (
  code, label, category, storage_folder, is_required, is_conditional,
  requires_expiry, requires_signature, allows_multiple, completeness_slot, sort_order
) values
  ('dpi_front', 'DPI frente', 'legal', 'dpi', true, false, false, false, false, 'dpi', 10),
  ('dpi_back', 'DPI reverso', 'legal', 'dpi', true, false, false, false, false, 'dpi', 11),
  ('nit', 'NIT', 'legal', 'legal', true, false, false, false, false, 'nit', 20),
  ('labor_contract', 'Contrato laboral', 'legal', 'contratos', true, false, false, true, false, 'labor_contract', 30),
  ('internal_rules', 'Reglamento interno', 'legal', 'contratos', true, false, false, true, false, 'internal_rules', 40),
  ('cv', 'Curriculum vitae', 'recruitment', 'cv', true, false, false, false, false, 'cv', 50),
  ('recommendation', 'Carta de recomendacion', 'recruitment', 'cv', false, false, false, false, true, 'recommendation', 60),
  ('id_photo', 'Fotografia cedula', 'recruitment', 'fotos', true, false, false, false, false, 'id_photo', 70),
  ('criminal_record', 'Antecedentes penales', 'background', 'antecedentes', true, false, true, false, false, 'criminal_record', 80),
  ('police_record', 'Antecedentes policiacos', 'background', 'antecedentes', true, false, true, false, false, 'police_record', 90),
  ('medical_certificate', 'Constancia medica', 'health', 'salud', true, false, true, false, false, 'medical_certificate', 100),
  ('health_card', 'Carnet de salud', 'health', 'salud', true, false, true, false, false, 'health_card', 110),
  ('food_handling', 'Manipulacion de alimentos', 'health', 'salud', false, true, true, false, false, 'food_handling', 120)
on conflict (code) do update set
  label = excluded.label,
  category = excluded.category,
  storage_folder = excluded.storage_folder,
  is_required = excluded.is_required,
  is_conditional = excluded.is_conditional,
  requires_expiry = excluded.requires_expiry,
  requires_signature = excluded.requires_signature,
  allows_multiple = excluded.allows_multiple,
  completeness_slot = excluded.completeness_slot,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Extended profile (expediente header data)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_file_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  dpi_number text,
  nit_number text,
  birth_date date,
  address text,
  personal_email text,
  emergency_contact_name text,
  emergency_contact_phone text,
  job_title text,
  hire_date date,
  labor_status text not null default 'active'
    check (labor_status in ('active', 'inactive', 'suspended', 'terminated')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Current file record per type (optional aggregate row)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_files (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  file_type_code text not null references public.employee_file_types(code) on delete restrict,
  signature_status text check (signature_status in ('signed', 'pending')),
  metadata jsonb not null default '{}'::jsonb,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, file_type_code)
);

create index if not exists employee_files_profile_idx
  on public.employee_files (profile_id, file_type_code);

-- ---------------------------------------------------------------------------
-- Version history (never overwrite)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_file_versions (
  id uuid primary key default gen_random_uuid(),
  employee_file_id uuid not null references public.employee_files(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  file_type_code text not null references public.employee_file_types(code) on delete restrict,
  version_number integer not null default 1,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  issued_at date,
  expires_at date,
  uploaded_by uuid references public.profiles(id) on delete set null,
  notes text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (employee_file_id, version_number)
);

create index if not exists employee_file_versions_profile_idx
  on public.employee_file_versions (profile_id, file_type_code, created_at desc);

create index if not exists employee_file_versions_expiry_idx
  on public.employee_file_versions (expires_at)
  where is_current = true and expires_at is not null;

alter table public.employee_files
  drop constraint if exists employee_files_current_version_fkey;

alter table public.employee_files
  add constraint employee_files_current_version_fkey
  foreign key (current_version_id) references public.employee_file_versions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

create table if not exists public.employee_file_alerts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  file_type_code text not null references public.employee_file_types(code) on delete cascade,
  version_id uuid references public.employee_file_versions(id) on delete set null,
  alert_level text not null check (alert_level in ('warning', 'orange', 'critical', 'missing')),
  alert_date date not null default current_date,
  message text not null,
  task_id text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, file_type_code, alert_level, alert_date)
);

create index if not exists employee_file_alerts_open_idx
  on public.employee_file_alerts (profile_id, alert_level)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Labor history (structure for future use)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_labor_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'promotion', 'salary_change', 'position_change', 'hr_note'
  )),
  title text not null,
  description text,
  effective_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_labor_history_profile_idx
  on public.employee_labor_history (profile_id, effective_date desc);

-- ---------------------------------------------------------------------------
-- Expiry helpers
-- ---------------------------------------------------------------------------

create or replace function public.employee_file_expiry_status(p_expires_at date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_expires_at is null then 'none'
    when p_expires_at < current_date then 'expired'
    when p_expires_at <= current_date + 15 then 'orange'
    when p_expires_at <= current_date + 30 then 'warning'
    else 'valid'
  end;
$$;

create or replace function public.employee_expediente_required_slots(p_profile_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  with profile_ctx as (
    select p.id, p.area_name, p.area_id
    from public.profiles p
    where p.id = p_profile_id
  )
  select coalesce(array_agg(distinct ft.completeness_slot order by ft.completeness_slot), '{}'::text[])
  from public.employee_file_types ft
  cross join profile_ctx ctx
  where ft.is_required = true
     or (
       ft.is_conditional = true
       and ft.completeness_slot = 'food_handling'
       and public.is_food_handling_area(ctx.area_name, ctx.area_id)
     );
$$;

create or replace function public.employee_expediente_filled_slots(p_profile_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct slot order by slot), '{}'::text[])
  from (
    select ft.completeness_slot as slot
    from public.employee_file_versions v
    join public.employee_file_types ft on ft.code = v.file_type_code
    where v.profile_id = p_profile_id
      and v.is_current = true
      and ft.code not in ('dpi_front', 'dpi_back')
      and (
        not ft.requires_signature
        or exists (
          select 1
          from public.employee_files f
          where f.id = v.employee_file_id
            and f.signature_status = 'signed'
        )
      )
    union
    select 'dpi' as slot
    where exists (
      select 1 from public.employee_file_versions v
      join public.employee_file_types ft on ft.code = v.file_type_code
      where v.profile_id = p_profile_id and v.is_current and ft.code = 'dpi_front'
    )
    and exists (
      select 1 from public.employee_file_versions v
      join public.employee_file_types ft on ft.code = v.file_type_code
      where v.profile_id = p_profile_id and v.is_current and ft.code = 'dpi_back'
    )
  ) filled;
$$;

create or replace function public.employee_expediente_completeness(p_profile_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_required text[];
  v_filled text[];
  v_missing text[];
  v_required_count integer;
  v_filled_count integer;
begin
  v_required := public.employee_expediente_required_slots(p_profile_id);
  v_filled := public.employee_expediente_filled_slots(p_profile_id);
  select coalesce(array_agg(r order by r), '{}'::text[])
  into v_missing
  from unnest(v_required) r
  where not (r = any(v_filled));
  v_required_count := coalesce(array_length(v_required, 1), 0);
  v_filled_count := v_required_count - coalesce(array_length(v_missing, 1), 0);
  return jsonb_build_object(
    'required_count', v_required_count,
    'filled_count', greatest(v_filled_count, 0),
    'missing_count', coalesce(array_length(v_missing, 1), 0),
    'percent', case
      when v_required_count = 0 then 100
      else round((greatest(v_filled_count, 0)::numeric / v_required_count) * 100)
    end,
    'missing_slots', to_jsonb(v_missing)
  );
end;
$$;

create or replace function public.employee_expediente_status(p_profile_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_has_expired boolean;
  v_complete jsonb;
begin
  select exists (
    select 1
    from public.employee_file_versions v
    where v.profile_id = p_profile_id
      and v.is_current = true
      and v.expires_at is not null
      and v.expires_at < current_date
  ) into v_has_expired;

  if v_has_expired then
    return 'expired';
  end if;

  v_complete := public.employee_expediente_completeness(p_profile_id);
  if coalesce((v_complete ->> 'percent')::integer, 0) >= 100 then
    return 'complete';
  end if;
  return 'incomplete';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: list expedientes
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_expedientes(
  p_search text default null,
  p_area text default null,
  p_job_title text default null,
  p_status text default null,
  p_expired_only boolean default false,
  p_incomplete_only boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_area text := nullif(trim(coalesce(p_area, '')), '');
  v_job_title text := nullif(trim(coalesce(p_job_title, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := greatest(coalesce(p_limit, 200), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para consultar expedientes.';
  end if;

  return coalesce((
    select jsonb_agg(row_data order by row_data ->> 'full_name')
    from (
      select jsonb_build_object(
        'profile_id', p.id,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'area_name', p.area_name,
        'area', p.area_name,
        'job_title', coalesce(efp.job_title, p.role),
        'dpi_number', coalesce(efp.dpi_number, ''),
        'nit_number', coalesce(efp.nit_number, ''),
        'status', public.employee_expediente_status(p.id),
        'completeness', public.employee_expediente_completeness(p.id),
        'expired_count', (
          select count(*)
          from public.employee_file_versions v
          where v.profile_id = p.id
            and v.is_current = true
            and v.expires_at is not null
            and v.expires_at < current_date
        ),
        'next_expiry', (
          select min(v.expires_at)
          from public.employee_file_versions v
          where v.profile_id = p.id
            and v.is_current = true
            and v.expires_at is not null
            and v.expires_at >= current_date
        )
      ) as row_data
      from public.profiles p
      left join public.employee_file_profiles efp on efp.profile_id = p.id
      where p.status = 'active'
        and (v_area is null or coalesce(p.area_name, '') ilike '%' || v_area || '%')
        and (v_job_title is null or coalesce(efp.job_title, p.role, '') ilike '%' || v_job_title || '%')
        and (
          v_search is null
          or coalesce(p.full_name, '') ilike '%' || v_search || '%'
          or coalesce(efp.dpi_number, '') ilike '%' || v_search || '%'
          or coalesce(efp.nit_number, '') ilike '%' || v_search || '%'
        )
        and (v_status is null or public.employee_expediente_status(p.id) = v_status)
        and (
          not coalesce(p_expired_only, false)
          or exists (
            select 1 from public.employee_file_versions v
            where v.profile_id = p.id and v.is_current and v.expires_at < current_date
          )
        )
        and (
          not coalesce(p_incomplete_only, false)
          or public.employee_expediente_status(p.id) = 'incomplete'
        )
      order by p.full_name
      limit v_limit
      offset v_offset
    ) rows
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: detail
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
          and public.employee_file_expiry_status(v.expires_at) = 'valid'
      ),
      'expired_count', (
        select count(*)
        from public.employee_file_versions v
        where v.profile_id = p_profile_id and v.is_current = true
          and public.employee_file_expiry_status(v.expires_at) = 'expired'
      ),
      'missing_count', coalesce((public.employee_expediente_completeness(p_profile_id) ->> 'missing_count')::integer, 0)
    ),
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
        'expiry_status', public.employee_file_expiry_status((
          select v.expires_at from public.employee_file_versions v where v.id = f.current_version_id
        ))
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
-- RPC: upsert profile extra
-- ---------------------------------------------------------------------------

create or replace function public.upsert_employee_expediente_profile(
  p_profile_id uuid,
  p_data jsonb
)
returns public.employee_file_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.employee_file_profiles;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para editar expedientes.';
  end if;

  insert into public.employee_file_profiles (
    profile_id, dpi_number, nit_number, birth_date, address, personal_email,
    emergency_contact_name, emergency_contact_phone, job_title, hire_date,
    labor_status, notes, updated_by, updated_at
  )
  values (
    p_profile_id,
    nullif(trim(coalesce(p_data ->> 'dpi_number', '')), ''),
    nullif(trim(coalesce(p_data ->> 'nit_number', '')), ''),
    nullif(p_data ->> 'birth_date', '')::date,
    nullif(trim(coalesce(p_data ->> 'address', '')), ''),
    nullif(trim(coalesce(p_data ->> 'personal_email', '')), ''),
    nullif(trim(coalesce(p_data ->> 'emergency_contact_name', '')), ''),
    nullif(trim(coalesce(p_data ->> 'emergency_contact_phone', '')), ''),
    nullif(trim(coalesce(p_data ->> 'job_title', '')), ''),
    nullif(p_data ->> 'hire_date', '')::date,
    coalesce(nullif(trim(coalesce(p_data ->> 'labor_status', '')), ''), 'active'),
    nullif(trim(coalesce(p_data ->> 'notes', '')), ''),
    auth.uid(),
    now()
  )
  on conflict (profile_id) do update set
    dpi_number = excluded.dpi_number,
    nit_number = excluded.nit_number,
    birth_date = excluded.birth_date,
    address = excluded.address,
    personal_email = excluded.personal_email,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    job_title = excluded.job_title,
    hire_date = excluded.hire_date,
    labor_status = excluded.labor_status,
    notes = excluded.notes,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: register uploaded file version
-- ---------------------------------------------------------------------------

create or replace function public.register_employee_file_version(
  p_profile_id uuid,
  p_file_type_code text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_file_size bigint default null,
  p_issued_at date default null,
  p_expires_at date default null,
  p_signature_status text default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.employee_file_types;
  v_file public.employee_files;
  v_version public.employee_file_versions;
  v_next_version integer := 1;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para cargar documentos.';
  end if;

  select * into v_type
  from public.employee_file_types
  where code = p_file_type_code;

  if not found then
    raise exception 'Tipo de documento invalido: %.', p_file_type_code;
  end if;

  insert into public.employee_files (profile_id, file_type_code, signature_status, metadata)
  values (
    p_profile_id,
    p_file_type_code,
    case when v_type.requires_signature then coalesce(p_signature_status, 'pending') else null end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (profile_id, file_type_code) do update set
    signature_status = case
      when v_type.requires_signature then coalesce(excluded.signature_status, employee_files.signature_status)
      else employee_files.signature_status
    end,
    metadata = employee_files.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_file;

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.employee_file_versions
  where employee_file_id = v_file.id;

  if not v_type.allows_multiple then
    update public.employee_file_versions
    set is_current = false
    where employee_file_id = v_file.id and is_current = true;
  end if;

  insert into public.employee_file_versions (
    employee_file_id, profile_id, file_type_code, version_number,
    storage_path, file_name, mime_type, file_size,
    issued_at, expires_at, uploaded_by, notes, is_current
  )
  values (
    v_file.id, p_profile_id, p_file_type_code, v_next_version,
    p_storage_path, p_file_name, p_mime_type, p_file_size,
    p_issued_at, p_expires_at, auth.uid(), p_notes, true
  )
  returning * into v_version;

  update public.employee_files
  set current_version_id = v_version.id, updated_at = now()
  where id = v_file.id;

  begin
    perform public.sync_employee_expediente_alerts(p_profile_id);
  exception
    when others then
      raise warning 'sync_employee_expediente_alerts failed for %: %', p_profile_id, sqlerrm;
  end;

  return jsonb_build_object('file', to_jsonb(v_file), 'version', to_jsonb(v_version));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: dashboard + alert sync + tasks
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_expedientes_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para consultar expedientes.';
  end if;

  return jsonb_build_object(
    'expired_documents', (
      select count(*)
      from public.employee_file_versions v
      where v.is_current = true and v.expires_at is not null and v.expires_at < current_date
    ),
    'expiring_soon', (
      select count(*)
      from public.employee_file_versions v
      where v.is_current = true and v.expires_at is not null
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
    )
  );
end;
$$;

create or replace function public.sync_employee_expediente_alerts(p_profile_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_hr_ids uuid[];
  rec record;
  v_task_id text;
  v_priority text;
  v_title text;
  v_alert_id uuid;
begin
  if auth.uid() is not null and not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para sincronizar alertas.';
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[])
  into v_hr_ids
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) = 'recursos_humanos';

  for rec in
    select
      p.id as profile_id,
      p.full_name,
      v.id as version_id,
      ft.code as file_type_code,
      ft.label as file_type_label,
      v.expires_at,
      public.employee_file_expiry_status(v.expires_at) as expiry_status
    from public.profiles p
    join public.employee_file_versions v on v.profile_id = p.id and v.is_current = true
    join public.employee_file_types ft on ft.code = v.file_type_code
    where p.status = 'active'
      and v.expires_at is not null
      and (p_profile_id is null or p.id = p_profile_id)
      and public.employee_file_expiry_status(v.expires_at) in ('warning', 'orange', 'expired')
  loop
    v_priority := case rec.expiry_status
      when 'expired' then 'critical'
      when 'orange' then 'high'
      else 'medium'
    end;

    v_title := case rec.expiry_status
      when 'expired' then 'Renovar ' || lower(rec.file_type_label) || ' de ' || coalesce(rec.full_name, 'colaborador') || ' (vencido)'
      else 'Renovar ' || lower(rec.file_type_label) || ' de ' || coalesce(rec.full_name, 'colaborador')
    end;

    insert into public.employee_file_alerts (
      profile_id, file_type_code, version_id, alert_level, message
    )
    values (
      rec.profile_id,
      rec.file_type_code,
      rec.version_id,
      case rec.expiry_status when 'expired' then 'critical' when 'orange' then 'orange' else 'warning' end,
      v_title
    )
    on conflict (profile_id, file_type_code, alert_level, alert_date) do update set
      message = excluded.message,
      version_id = excluded.version_id
    returning id into v_alert_id;

    v_count := v_count + 1;

    v_task_id := 'expediente-' || rec.profile_id::text || '-' || rec.file_type_code || '-' || rec.expiry_status;

    insert into public.assigned_tasks (
      id, title, status, due_date, due_at, assigned_profile_ids, assigned_by, payload
    )
    values (
      v_task_id,
      v_title,
      'pending',
      coalesce(rec.expires_at, current_date),
      coalesce(rec.expires_at, current_date)::timestamptz,
      v_hr_ids,
      auth.uid(),
      jsonb_build_object(
        'source', 'employee_expediente',
        'profile_id', rec.profile_id,
        'file_type_code', rec.file_type_code,
        'priority', v_priority,
        'category', 'Recursos Humanos'
      )
    )
    on conflict (id) do update set
      title = excluded.title,
      due_date = excluded.due_date,
      due_at = excluded.due_at,
      payload = excluded.payload,
      updated_at = now();

    update public.employee_file_alerts
    set task_id = v_task_id
    where profile_id = rec.profile_id
      and file_type_code = rec.file_type_code
      and alert_date = current_date
      and resolved_at is null;
  end loop;

  return v_count;
end;
$$;

create or replace function public.get_employee_expedientes_report(p_report_type text default 'summary')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text := lower(trim(coalesce(p_report_type, 'summary')));
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para generar reportes de expedientes.';
  end if;

  if v_type = 'expired' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'full_name', p.full_name,
        'area_name', p.area_name,
        'document', ft.label,
        'expires_at', v.expires_at,
        'days_overdue', current_date - v.expires_at
      ) order by p.full_name)
      from public.employee_file_versions v
      join public.profiles p on p.id = v.profile_id
      join public.employee_file_types ft on ft.code = v.file_type_code
      where v.is_current = true and v.expires_at < current_date
    ), '[]'::jsonb);
  elsif v_type = 'expiring' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'full_name', p.full_name,
        'area_name', p.area_name,
        'document', ft.label,
        'expires_at', v.expires_at,
        'days_left', v.expires_at - current_date
      ) order by v.expires_at)
      from public.employee_file_versions v
      join public.profiles p on p.id = v.profile_id
      join public.employee_file_types ft on ft.code = v.file_type_code
      where v.is_current = true
        and v.expires_at between current_date and current_date + 30
    ), '[]'::jsonb);
  elsif v_type = 'complete' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'full_name', p.full_name,
        'area_name', p.area_name,
        'completeness_percent', (public.employee_expediente_completeness(p.id) ->> 'percent')::integer
      ) order by p.full_name)
      from public.profiles p
      where p.status = 'active'
        and public.employee_expediente_status(p.id) = 'complete'
    ), '[]'::jsonb);
  end if;

  return public.get_employee_expedientes_dashboard();
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.employee_file_types enable row level security;
alter table public.employee_file_profiles enable row level security;
alter table public.employee_files enable row level security;
alter table public.employee_file_versions enable row level security;
alter table public.employee_file_alerts enable row level security;
alter table public.employee_labor_history enable row level security;

grant select on public.employee_file_types to authenticated;
grant select, insert, update on public.employee_file_profiles to authenticated;
grant select, insert, update on public.employee_files to authenticated;
grant select, insert on public.employee_file_versions to authenticated;
grant select on public.employee_file_alerts to authenticated;
grant select, insert on public.employee_labor_history to authenticated;

drop policy if exists "employee_file_types_read" on public.employee_file_types;
create policy "employee_file_types_read"
  on public.employee_file_types for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_file_profiles_read" on public.employee_file_profiles;
create policy "employee_file_profiles_read"
  on public.employee_file_profiles for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_file_profiles_write" on public.employee_file_profiles;
create policy "employee_file_profiles_write"
  on public.employee_file_profiles for all to authenticated
  using (public.can_write_employee_expedientes())
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_files_read" on public.employee_files;
create policy "employee_files_read"
  on public.employee_files for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_files_write" on public.employee_files;
create policy "employee_files_write"
  on public.employee_files for all to authenticated
  using (public.can_write_employee_expedientes())
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_file_versions_read" on public.employee_file_versions;
create policy "employee_file_versions_read"
  on public.employee_file_versions for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_file_versions_write" on public.employee_file_versions;
create policy "employee_file_versions_write"
  on public.employee_file_versions for insert to authenticated
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_file_alerts_read" on public.employee_file_alerts;
create policy "employee_file_alerts_read"
  on public.employee_file_alerts for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_labor_history_read" on public.employee_labor_history;
create policy "employee_labor_history_read"
  on public.employee_labor_history for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_labor_history_write" on public.employee_labor_history;
create policy "employee_labor_history_write"
  on public.employee_labor_history for insert to authenticated
  with check (public.can_write_employee_expedientes());

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-documents',
  'employee-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "employee_documents_read" on storage.objects;
create policy "employee_documents_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and public.can_read_employee_expedientes());

drop policy if exists "employee_documents_insert" on storage.objects;
create policy "employee_documents_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.can_write_employee_expedientes());

drop policy if exists "employee_documents_update" on storage.objects;
create policy "employee_documents_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'employee-documents' and public.can_write_employee_expedientes())
  with check (bucket_id = 'employee-documents' and public.can_write_employee_expedientes());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.can_read_employee_expedientes() from public;
revoke all on function public.can_write_employee_expedientes() from public;
revoke all on function public.get_employee_expedientes(text, text, text, text, boolean, boolean, integer, integer) from public;
revoke all on function public.get_employee_expediente_detail(uuid) from public;
revoke all on function public.upsert_employee_expediente_profile(uuid, jsonb) from public;
revoke all on function public.register_employee_file_version(uuid, text, text, text, text, bigint, date, date, text, text, jsonb) from public;
revoke all on function public.get_employee_expedientes_dashboard() from public;
revoke all on function public.sync_employee_expediente_alerts(uuid) from public;
revoke all on function public.get_employee_expedientes_report(text) from public;

grant execute on function public.can_read_employee_expedientes() to authenticated;
grant execute on function public.can_write_employee_expedientes() to authenticated;
grant execute on function public.get_employee_expedientes(text, text, text, text, boolean, boolean, integer, integer) to authenticated;
grant execute on function public.get_employee_expediente_detail(uuid) to authenticated;
grant execute on function public.upsert_employee_expediente_profile(uuid, jsonb) to authenticated;
grant execute on function public.register_employee_file_version(uuid, text, text, text, text, bigint, date, date, text, text, jsonb) to authenticated;
grant execute on function public.get_employee_expedientes_dashboard() to authenticated;
grant execute on function public.sync_employee_expediente_alerts(uuid) to authenticated;
grant execute on function public.get_employee_expedientes_report(text) to authenticated;
grant execute on function public.employee_file_expiry_status(date) to authenticated;
grant execute on function public.employee_expediente_completeness(uuid) to authenticated;
