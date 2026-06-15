-- Catering pipeline Phase 1.5: commercial fields, lead assignment, follow-up, summary.
-- Apply after 082_catering_requests.sql.
-- Does NOT replace 082; run as incremental migration on existing catering_requests.

-- ---------------------------------------------------------------------------
-- New commercial columns on catering_requests
-- ---------------------------------------------------------------------------

alter table public.catering_requests
  add column if not exists lead_source text not null default 'website',
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists follow_up_date date,
  add column if not exists last_contact_at timestamptz,
  add column if not exists estimated_value numeric(12, 2) check (estimated_value is null or estimated_value >= 0),
  add column if not exists conversion_status text not null default 'lead';

alter table public.catering_requests
  drop constraint if exists catering_requests_conversion_status_check;

alter table public.catering_requests
  add constraint catering_requests_conversion_status_check
  check (conversion_status in (
    'lead',
    'contacted',
    'quoted',
    'negotiating',
    'approved',
    'lost',
    'converted'
  ));

-- ---------------------------------------------------------------------------
-- Helpers (must exist before backfill)
-- ---------------------------------------------------------------------------

create or replace function public.map_catering_status_to_conversion(p_status text)
returns text
language sql
immutable
as $$
  select case nullif(trim(coalesce(p_status, '')), '')
    when 'new' then 'lead'
    when 'reviewing' then 'contacted'
    when 'quoted' then 'quoted'
    when 'sent' then 'negotiating'
    when 'approved' then 'approved'
    when 'rejected' then 'lost'
    when 'converted' then 'converted'
    else null
  end;
$$;

create or replace function public.is_valid_catering_operational_status(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') in (
    'new', 'reviewing', 'quoted', 'sent', 'approved', 'rejected', 'converted'
  );
$$;

create or replace function public.is_valid_catering_conversion_status(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') in (
    'lead', 'contacted', 'quoted', 'negotiating', 'approved', 'lost', 'converted'
  );
$$;

-- Backfill lead_source from legacy source column when present
update public.catering_requests
set lead_source = case
  when source in ('wix_form', 'website') then 'website'
  when source in ('phone', 'telefono') then 'phone'
  when source in ('email', 'correo') then 'email'
  when source in ('referral', 'referido') then 'referral'
  when source in ('erp_manual', 'manual') then 'manual'
  else coalesce(nullif(trim(source), ''), 'website')
end
where lead_source = 'website'
  and source is not null
  and source <> 'wix_form';

-- Align conversion_status with operational status using canonical mapping
update public.catering_requests
set conversion_status = public.map_catering_status_to_conversion(status)
where public.map_catering_status_to_conversion(status) is not null
  and conversion_status is distinct from public.map_catering_status_to_conversion(status);

create index if not exists catering_requests_conversion_status_idx
  on public.catering_requests (conversion_status);

create index if not exists catering_requests_assigned_to_idx
  on public.catering_requests (assigned_to);

create index if not exists catering_requests_follow_up_date_idx
  on public.catering_requests (follow_up_date);

create index if not exists catering_requests_pipeline_idx
  on public.catering_requests (conversion_status, follow_up_date, assigned_to);

comment on column public.catering_requests.lead_source is
  'Commercial attribution: website, phone, email, referral, manual, social, etc.';

comment on column public.catering_requests.conversion_status is
  'Commercial pipeline stage: lead -> contacted -> quoted -> negotiating -> approved|lost -> converted';

comment on column public.catering_requests.status is
  'Internal operational status. Synced to conversion_status via map_catering_status_to_conversion().';

-- ---------------------------------------------------------------------------
-- RPC: create_catering_request (updated)
-- ---------------------------------------------------------------------------

create or replace function public.create_catering_request(p_data jsonb)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := nullif(trim(coalesce(p_data ->> 'customer_name', '')), '');
  v_source text := coalesce(nullif(trim(coalesce(p_data ->> 'source', '')), ''), 'wix_form');
  v_row public.catering_requests;
begin
  if auth.uid() is not null and not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear solicitudes de catering.';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name es obligatorio.';
  end if;

  insert into public.catering_requests (
    customer_name,
    customer_phone,
    customer_email,
    event_date,
    event_time,
    event_location,
    event_type,
    guest_count,
    products_requested,
    notes,
    status,
    source,
    lead_source,
    assigned_to,
    follow_up_date,
    estimated_value,
    conversion_status,
    created_by,
    updated_by
  )
  values (
    v_customer_name,
    nullif(trim(coalesce(p_data ->> 'customer_phone', '')), ''),
    nullif(trim(coalesce(p_data ->> 'customer_email', '')), ''),
    nullif(p_data ->> 'event_date', '')::date,
    nullif(p_data ->> 'event_time', '')::time,
    nullif(trim(coalesce(p_data ->> 'event_location', '')), ''),
    nullif(trim(coalesce(p_data ->> 'event_type', '')), ''),
    nullif(p_data ->> 'guest_count', '')::integer,
    coalesce(
      (
        select array_agg(value)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(p_data -> 'products_requested') = 'array' then p_data -> 'products_requested'
            else '[]'::jsonb
          end
        ) as value
        where nullif(trim(value), '') is not null
      ),
      '{}'::text[]
    ),
    nullif(trim(coalesce(p_data ->> 'notes', '')), ''),
    'new',
    v_source,
    'website',
    nullif(p_data ->> 'assigned_to', '')::uuid,
    nullif(p_data ->> 'follow_up_date', '')::date,
    nullif(p_data ->> 'estimated_value', '')::numeric(12, 2),
    'lead',
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update_catering_request_status (syncs conversion_status from operational status)
-- ---------------------------------------------------------------------------

create or replace function public.update_catering_request_status(
  p_request_id uuid,
  p_status text,
  p_notes text default null
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_row public.catering_requests;
  v_conversion_status text;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar solicitudes de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if v_status is null then
    raise exception 'p_status es obligatorio.';
  end if;

  if not public.is_valid_catering_operational_status(v_status) then
    raise exception 'Estado operativo invalido: %', v_status;
  end if;

  v_conversion_status := public.map_catering_status_to_conversion(v_status);

  update public.catering_requests request
  set
    status = v_status,
    conversion_status = v_conversion_status,
    notes = case
      when p_notes is null then request.notes
      when nullif(trim(p_notes), '') is null then request.notes
      when nullif(trim(coalesce(request.notes, '')), '') is null then trim(p_notes)
      else request.notes || E'\n' || trim(p_notes)
    end,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_requests (updated — pipeline filters)
-- ---------------------------------------------------------------------------

drop function if exists public.get_catering_requests(text, integer, integer);

create or replace function public.get_catering_requests(
  p_status text default null,
  p_conversion_status text default null,
  p_assigned_to uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns setof public.catering_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_conversion_status text := nullif(trim(coalesce(p_conversion_status, '')), '');
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar solicitudes de catering.';
  end if;

  return query
  select request.*
  from public.catering_requests request
  where (v_status is null or request.status = v_status)
    and (v_conversion_status is null or request.conversion_status = v_conversion_status)
    and (p_assigned_to is null or request.assigned_to = p_assigned_to)
  order by request.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_request_detail (unchanged signature, returns new columns)
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_request_detail(p_request_id uuid)
returns public.catering_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar solicitudes de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  select request.*
  into v_row
  from public.catering_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: assign_catering_lead
-- ---------------------------------------------------------------------------

create or replace function public.assign_catering_lead(
  p_request_id uuid,
  p_assigned_to uuid
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para asignar leads de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if p_assigned_to is null then
    raise exception 'p_assigned_to es obligatorio.';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_assigned_to and profile.status = 'active'
  ) then
    raise exception 'El responsable asignado no existe o no esta activo.';
  end if;

  update public.catering_requests request
  set
    assigned_to = p_assigned_to,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update_catering_followup
-- ---------------------------------------------------------------------------

create or replace function public.update_catering_followup(
  p_request_id uuid,
  p_follow_up_date date default null,
  p_notes text default null,
  p_conversion_status text default null,
  p_estimated_value numeric default null
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversion_status text := nullif(trim(coalesce(p_conversion_status, '')), '');
  v_row public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para registrar seguimiento de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if v_conversion_status is not null and not public.is_valid_catering_conversion_status(v_conversion_status) then
    raise exception 'conversion_status invalido: %', v_conversion_status;
  end if;

  if p_estimated_value is not null and p_estimated_value < 0 then
    raise exception 'estimated_value no puede ser negativo.';
  end if;

  update public.catering_requests request
  set
    follow_up_date = coalesce(p_follow_up_date, request.follow_up_date),
    last_contact_at = now(),
    conversion_status = coalesce(v_conversion_status, request.conversion_status),
    estimated_value = coalesce(p_estimated_value, request.estimated_value),
    notes = case
      when p_notes is null then request.notes
      when nullif(trim(p_notes), '') is null then request.notes
      when nullif(trim(coalesce(request.notes, '')), '') is null then trim(p_notes)
      else request.notes || E'\n' || trim(p_notes)
    end,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permission helper (replaces 082 — aligned with current_profile_role pattern)
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_catering_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in (
        'admin',
        'gerente_general',
        'gerente',
        'gerente_operaciones',
        'supervisor'
      )
  );
$$;

revoke all on function public.can_manage_catering_requests() from public;
grant execute on function public.can_manage_catering_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_pipeline_summary
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_pipeline_summary(
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
  v_from date := coalesce(p_date_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_date_to, current_date);
  v_total_leads bigint := 0;
  v_new_leads bigint := 0;
  v_contacted_leads bigint := 0;
  v_quoted_leads bigint := 0;
  v_negotiating_leads bigint := 0;
  v_approved_leads bigint := 0;
  v_lost_leads bigint := 0;
  v_converted_leads bigint := 0;
  v_potential_value numeric(12, 2) := 0;
  v_approved_value numeric(12, 2) := 0;
  v_conversion_rate numeric(10, 2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para consultar el pipeline de catering.';
  end if;

  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar el pipeline de catering.';
  end if;

  if v_to < v_from then
    raise exception 'p_date_to no puede ser menor que p_date_from.';
  end if;

  select
    count(*),
    count(*) filter (where conversion_status = 'lead'),
    count(*) filter (where conversion_status = 'contacted'),
    count(*) filter (where conversion_status = 'quoted'),
    count(*) filter (where conversion_status = 'negotiating'),
    count(*) filter (where conversion_status = 'approved'),
    count(*) filter (where conversion_status = 'lost'),
    count(*) filter (where conversion_status = 'converted'),
    coalesce(sum(estimated_value) filter (
      where conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
    ), 0),
    coalesce(sum(estimated_value) filter (
      where conversion_status = 'approved'
    ), 0)
  into
    v_total_leads,
    v_new_leads,
    v_contacted_leads,
    v_quoted_leads,
    v_negotiating_leads,
    v_approved_leads,
    v_lost_leads,
    v_converted_leads,
    v_potential_value,
    v_approved_value
  from public.catering_requests
  where created_at::date between v_from and v_to;

  if v_total_leads > 0 then
    v_conversion_rate := round((v_approved_leads::numeric / v_total_leads::numeric) * 100, 2);
  end if;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'total_leads', v_total_leads,
    'new_leads', v_new_leads,
    'contacted_leads', v_contacted_leads,
    'quoted_leads', v_quoted_leads,
    'negotiating_leads', v_negotiating_leads,
    'approved_leads', v_approved_leads,
    'lost_leads', v_lost_leads,
    'converted_leads', v_converted_leads,
    'total_potential_value', v_potential_value,
    'approved_total_value', v_approved_value,
    'conversion_rate', v_conversion_rate
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.map_catering_status_to_conversion(text) from public;
grant execute on function public.map_catering_status_to_conversion(text) to authenticated;

revoke all on function public.is_valid_catering_operational_status(text) from public;
grant execute on function public.is_valid_catering_operational_status(text) to authenticated;

revoke all on function public.is_valid_catering_conversion_status(text) from public;
grant execute on function public.is_valid_catering_conversion_status(text) to authenticated;

revoke all on function public.create_catering_request(jsonb) from public;
revoke all on function public.update_catering_request_status(uuid, text, text) from public;
revoke all on function public.get_catering_requests(text, text, uuid, integer, integer) from public;
revoke all on function public.get_catering_request_detail(uuid) from public;
revoke all on function public.assign_catering_lead(uuid, uuid) from public;
revoke all on function public.update_catering_followup(uuid, date, text, text, numeric) from public;
revoke all on function public.get_catering_pipeline_summary(date, date) from public;

grant execute on function public.create_catering_request(jsonb) to authenticated, service_role;
grant execute on function public.update_catering_request_status(uuid, text, text) to authenticated;
grant execute on function public.get_catering_requests(text, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_catering_request_detail(uuid) to authenticated;
grant execute on function public.assign_catering_lead(uuid, uuid) to authenticated;
grant execute on function public.update_catering_followup(uuid, date, text, text, numeric) to authenticated;
grant execute on function public.get_catering_pipeline_summary(date, date) to authenticated;
