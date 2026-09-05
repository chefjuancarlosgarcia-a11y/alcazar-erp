-- Billing module foundation (Phase 0) — additive only, no emission, no POS/cash hooks.
-- Apply after 158_fix_pos_kds_product_id_ambiguity.sql

-- ---------------------------------------------------------------------------
-- Legal entities (multi-company / razones sociales)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_legal_entities (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  legal_name text not null,
  trade_name text,
  tax_id text,
  country_code text not null default 'GT',
  currency_code text not null default 'GTQ',
  is_default boolean not null default false,
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_legal_entities_code_unique unique (code)
);

create unique index if not exists billing_legal_entities_one_default_idx
  on public.billing_legal_entities ((true))
  where is_default = true and is_active = true;

create index if not exists billing_legal_entities_active_idx
  on public.billing_legal_entities (is_active, code);

-- ---------------------------------------------------------------------------
-- Provider catalog
-- ---------------------------------------------------------------------------

create table if not exists public.billing_providers (
  code text primary key,
  name text not null,
  country_code text not null default 'GT',
  adapter_key text not null,
  adapter_version text not null default '1.0.0',
  is_active boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Provider configs (per legal entity + environment)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_provider_configs (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.billing_legal_entities(id) on delete restrict,
  provider_code text not null references public.billing_providers(code) on delete restrict,
  environment text not null check (environment in ('stage', 'production')),
  entity_id text not null,
  vault_secret_name text not null,
  base_url text,
  adapter_version text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  issuer_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint billing_provider_configs_env_unique
    unique (legal_entity_id, provider_code, environment)
);

create unique index if not exists billing_provider_configs_one_default_idx
  on public.billing_provider_configs (legal_entity_id, provider_code)
  where is_default = true and is_active = true;

create index if not exists billing_provider_configs_entity_idx
  on public.billing_provider_configs (legal_entity_id, is_active);

-- ---------------------------------------------------------------------------
-- Canonical billing documents (provider-agnostic domain)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.billing_legal_entities(id) on delete restrict,
  provider_code text references public.billing_providers(code) on delete set null,
  provider_config_id uuid references public.billing_provider_configs(id) on delete set null,
  document_type text not null check (document_type in (
    'invoice', 'credit_note', 'debit_note', 'receipt',
    'donation_receipt', 'special_invoice'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'pending_certification', 'certified', 'rejected',
    'void_pending', 'voided', 'void_failed'
  )),
  currency text not null default 'GTQ',
  issued_at timestamptz,
  external_id text,
  buyer_snapshot jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  certification_authorization text,
  certification_series text,
  certification_number text,
  certified_at timestamptz,
  document_url text,
  document_xml_url text,
  void_reason text,
  voided_at timestamptz,
  parent_document_id uuid references public.billing_documents(id) on delete set null,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  last_error_codes text[] not null default '{}',
  last_error_messages jsonb not null default '[]'::jsonb,
  -- Provider-isolated fields (never used by ERP domain logic outside adapters)
  provider_document_type text,
  provider_reference_id text,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint billing_documents_external_id_unique unique (external_id)
);

create index if not exists billing_documents_status_retry_idx
  on public.billing_documents (status, next_retry_at);

create index if not exists billing_documents_entity_status_idx
  on public.billing_documents (legal_entity_id, status, created_at desc);

create index if not exists billing_documents_provider_ref_idx
  on public.billing_documents (provider_reference_id)
  where provider_reference_id is not null;

-- ---------------------------------------------------------------------------
-- Document lines
-- ---------------------------------------------------------------------------

create table if not exists public.billing_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.billing_documents(id) on delete cascade,
  line_number integer not null,
  source_line_ref jsonb,
  description text not null default '',
  quantity numeric(12, 2) not null default 1 check (quantity >= 0),
  unit_price numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  line_total numeric(12, 2) not null default 0,
  item_type text not null default 'goods' check (item_type in ('goods', 'service')),
  tax_exempt boolean not null default false,
  taxes jsonb not null default '{}'::jsonb,
  constraint billing_document_lines_unique_line unique (document_id, line_number)
);

create index if not exists billing_document_lines_document_idx
  on public.billing_document_lines (document_id);

-- ---------------------------------------------------------------------------
-- Certification attempts (audit + observability)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_certification_attempts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.billing_documents(id) on delete cascade,
  provider_config_id uuid references public.billing_provider_configs(id) on delete set null,
  legal_entity_id uuid references public.billing_legal_entities(id) on delete set null,
  provider_code text not null,
  adapter_version text not null,
  attempt_number integer not null default 1,
  operation text not null check (operation in (
    'issue', 'void', 'lookup', 'test_connection', 'credits_check'
  )),
  status text not null check (status in ('pending', 'success', 'failed', 'skipped')),
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_codes text[] not null default '{}',
  error_messages jsonb not null default '[]'::jsonb,
  http_status integer,
  duration_ms integer,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists billing_certification_attempts_document_idx
  on public.billing_certification_attempts (document_id, attempt_number);

create index if not exists billing_certification_attempts_provider_idx
  on public.billing_certification_attempts (provider_code, created_at desc);

create index if not exists billing_certification_attempts_operation_idx
  on public.billing_certification_attempts (operation, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Links to business sources (idempotency)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_document_links (
  id uuid primary key default gen_random_uuid(),
  billing_document_id uuid not null references public.billing_documents(id) on delete cascade,
  source_type text not null check (source_type in (
    'pos_order', 'pos_order_payment', 'catering_quote', 'finance_receivable', 'manual'
  )),
  source_id uuid not null,
  link_role text not null default 'primary' check (link_role in ('primary', 'related')),
  created_at timestamptz not null default now(),
  constraint billing_document_links_unique_source unique (source_type, source_id, link_role)
);

create index if not exists billing_document_links_document_idx
  on public.billing_document_links (billing_document_id);

-- ---------------------------------------------------------------------------
-- Config audit log
-- ---------------------------------------------------------------------------

create table if not exists public.billing_config_audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  change_type text not null check (change_type in ('insert', 'update', 'delete')),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists billing_config_audit_log_changed_at_idx
  on public.billing_config_audit_log (changed_at desc);

create index if not exists billing_config_audit_log_record_idx
  on public.billing_config_audit_log (table_name, record_id);

-- ---------------------------------------------------------------------------
-- Provider health / monitoring snapshot (updated by Edge Functions)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_provider_status (
  provider_config_id uuid primary key references public.billing_provider_configs(id) on delete cascade,
  legal_entity_id uuid not null references public.billing_legal_entities(id) on delete cascade,
  provider_code text not null references public.billing_providers(code) on delete cascade,
  adapter_version text not null,
  connection_status text not null default 'unknown' check (connection_status in (
    'unknown', 'healthy', 'degraded', 'error'
  )),
  last_test_at timestamptz,
  last_test_success boolean,
  last_test_duration_ms integer,
  last_test_error_summary text,
  last_test_error_codes text[] not null default '{}',
  last_known_credits integer,
  last_successful_connection_at timestamptz,
  last_error_at timestamptz,
  last_error_summary text,
  updated_at timestamptz not null default now()
);

create index if not exists billing_provider_status_entity_idx
  on public.billing_provider_status (legal_entity_id, provider_code);

-- ---------------------------------------------------------------------------
-- Monitoring view (document counts — no dashboard UI in Phase 0)
-- ---------------------------------------------------------------------------

create or replace view public.billing_monitoring_document_counts
with (security_invoker = true)
as
select
  d.legal_entity_id,
  d.provider_code,
  count(*) filter (where d.status = 'pending_certification') as pending_count,
  count(*) filter (where d.status = 'rejected') as failed_count,
  count(*) filter (where d.status = 'certified') as certified_count,
  count(*) filter (where d.status in ('void_pending', 'void_failed')) as void_issue_count,
  round(
    avg(extract(epoch from (d.certified_at - d.created_at))) filter (where d.status = 'certified'),
    2
  ) as avg_certification_seconds
from public.billing_documents d
group by d.legal_entity_id, d.provider_code;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.billing_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists billing_legal_entities_updated_at on public.billing_legal_entities;
create trigger billing_legal_entities_updated_at
  before update on public.billing_legal_entities
  for each row execute function public.billing_touch_updated_at();

drop trigger if exists billing_providers_updated_at on public.billing_providers;
create trigger billing_providers_updated_at
  before update on public.billing_providers
  for each row execute function public.billing_touch_updated_at();

drop trigger if exists billing_provider_configs_updated_at on public.billing_provider_configs;
create trigger billing_provider_configs_updated_at
  before update on public.billing_provider_configs
  for each row execute function public.billing_touch_updated_at();

drop trigger if exists billing_documents_updated_at on public.billing_documents;
create trigger billing_documents_updated_at
  before update on public.billing_documents
  for each row execute function public.billing_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------------

create or replace function public.billing_log_config_change(
  p_table_name text,
  p_record_id text,
  p_field_name text,
  p_old_value jsonb,
  p_new_value jsonb,
  p_change_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_config_audit_log (
    table_name, record_id, field_name, old_value, new_value,
    change_type, changed_by, metadata
  ) values (
    p_table_name, p_record_id, p_field_name, p_old_value, p_new_value,
    p_change_type, auth.uid(), coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_billing_settings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in ('admin', 'gerente_general')
  );
$$;

create or replace function public.can_view_billing_settings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_billing_settings()
    or exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.status = 'active'
        and public.normalize_profile_role(profile.role) = 'contador'
    );
$$;

create or replace function public.can_view_billing_documents()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_billing_settings()
    or public.is_cash_operator()
    or exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.status = 'active'
        and public.normalize_profile_role(profile.role) = 'contador'
    );
$$;

create or replace function public.can_retry_billing_certification()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in ('admin', 'gerente_general', 'supervisor')
  );
$$;

-- ---------------------------------------------------------------------------
-- Feature flag: billing_settings
-- ---------------------------------------------------------------------------

create or replace function public.billing_settings_default()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', false,
    'emission_enabled', false,
    'provider_code', 'felplex_gt',
    'environment', 'stage',
    'default_document_type', 'invoice',
    'default_legal_entity_code', 'default',
    'degraded_mode_allow_sale', true,
    'auto_retry_enabled', false,
    'retry_max_attempts', 5,
    'retry_interval_minutes', 15,
    'timezone', 'America/Guatemala',
    'phase', 0,
    'updated_at', null,
    'updated_by', null,
    'notes', 'Fase 0 — fundacion sin emision activa'
  );
$$;

create or replace function public.get_billing_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  if not public.can_view_billing_settings() then
    raise exception 'No tienes permiso para consultar configuracion de facturacion.';
  end if;

  select value into v_value
  from public.app_settings
  where key = 'billing_settings';

  return public.billing_settings_default()
    || coalesce(v_value, '{}'::jsonb);
end;
$$;

create or replace function public.set_billing_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current jsonb;
  v_next jsonb;
  v_key text;
  v_old jsonb;
  v_new jsonb;
begin
  if not public.can_manage_billing_settings() then
    raise exception 'No tienes permiso para modificar configuracion de facturacion.';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch invalido para billing_settings.';
  end if;

  v_current := public.get_billing_settings();
  v_next := v_current || p_patch;

  if coalesce(v_next ->> 'emission_enabled', 'false')::boolean then
    raise exception 'La emision FEL no esta habilitada en Fase 0.';
  end if;

  for v_key in
    select jsonb_object_keys(p_patch)
  loop
    v_old := to_jsonb(v_current -> v_key);
    v_new := to_jsonb(v_next -> v_key);
    if v_old is distinct from v_new then
      perform public.billing_log_config_change(
        'app_settings', 'billing_settings', v_key, v_old, v_new, 'update',
        jsonb_build_object('source', 'set_billing_settings')
      );
    end if;
  end loop;

  v_next := v_next || jsonb_build_object(
    'updated_at', to_jsonb(now()),
    'updated_by', to_jsonb(auth.uid())
  );

  insert into public.app_settings (key, value, updated_by)
  values ('billing_settings', v_next, auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = now();

  return public.get_billing_settings();
end;
$$;

create or replace function public.is_billing_emission_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

-- ---------------------------------------------------------------------------
-- Legal entities RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_billing_legal_entities()
returns setof public.billing_legal_entities
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.billing_legal_entities
  where public.can_view_billing_settings()
  order by is_default desc, legal_name;
$$;

create or replace function public.get_default_billing_legal_entity_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.billing_legal_entities
  where is_default = true and is_active = true
  order by created_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Provider config RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_billing_provider_configs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.can_view_billing_settings() then
    raise exception 'No tienes permiso para consultar configuracion de proveedores.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', cfg.id,
      'legal_entity_id', cfg.legal_entity_id,
      'legal_entity_code', ent.code,
      'legal_entity_name', ent.legal_name,
      'provider_code', cfg.provider_code,
      'provider_name', prov.name,
      'environment', cfg.environment,
      'entity_id', cfg.entity_id,
      'vault_secret_name', cfg.vault_secret_name,
      'base_url', cfg.base_url,
      'adapter_version', coalesce(cfg.adapter_version, prov.adapter_version),
      'is_default', cfg.is_default,
      'is_active', cfg.is_active,
      'issuer_settings', cfg.issuer_settings,
      'updated_at', cfg.updated_at
    )
    order by ent.code, cfg.provider_code, cfg.environment
  ), '[]'::jsonb) into v_rows
  from public.billing_provider_configs cfg
  join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
  join public.billing_providers prov on prov.code = cfg.provider_code;

  return v_rows;
end;
$$;

create or replace function public.upsert_billing_provider_config(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing public.billing_provider_configs;
  v_row public.billing_provider_configs;
  v_legal_entity_id uuid;
begin
  if not public.can_manage_billing_settings() then
    raise exception 'No tienes permiso para modificar configuracion de proveedores.';
  end if;

  v_id := nullif(p_data ->> 'id', '')::uuid;

  v_legal_entity_id := coalesce(
    nullif(p_data ->> 'legal_entity_id', '')::uuid,
    public.get_default_billing_legal_entity_id()
  );

  if v_legal_entity_id is null then
    raise exception 'No existe entidad legal predeterminada.';
  end if;

  if v_id is not null then
    select * into v_existing from public.billing_provider_configs where id = v_id;
    if v_existing.id is null then
      raise exception 'Configuracion de proveedor no encontrada.';
    end if;
  end if;

  if v_id is null then
    insert into public.billing_provider_configs (
      legal_entity_id, provider_code, environment, entity_id,
      vault_secret_name, base_url, adapter_version,
      is_default, is_active, issuer_settings, updated_by
    ) values (
      v_legal_entity_id,
      coalesce(p_data ->> 'provider_code', 'felplex_gt'),
      coalesce(p_data ->> 'environment', 'stage'),
      coalesce(p_data ->> 'entity_id', ''),
      coalesce(p_data ->> 'vault_secret_name', ''),
      nullif(p_data ->> 'base_url', ''),
      nullif(p_data ->> 'adapter_version', ''),
      coalesce((p_data ->> 'is_default')::boolean, false),
      coalesce((p_data ->> 'is_active')::boolean, true),
      coalesce(p_data -> 'issuer_settings', '{}'::jsonb),
      auth.uid()
    ) returning * into v_row;

    perform public.billing_log_config_change(
      'billing_provider_configs', v_row.id::text, '_record',
      null, to_jsonb(v_row), 'insert'
    );
  else
    update public.billing_provider_configs cfg
    set
      entity_id = coalesce(nullif(p_data ->> 'entity_id', ''), cfg.entity_id),
      vault_secret_name = coalesce(nullif(p_data ->> 'vault_secret_name', ''), cfg.vault_secret_name),
      base_url = coalesce(nullif(p_data ->> 'base_url', ''), cfg.base_url),
      adapter_version = coalesce(nullif(p_data ->> 'adapter_version', ''), cfg.adapter_version),
      is_default = coalesce((p_data ->> 'is_default')::boolean, cfg.is_default),
      is_active = coalesce((p_data ->> 'is_active')::boolean, cfg.is_active),
      issuer_settings = coalesce(p_data -> 'issuer_settings', cfg.issuer_settings),
      updated_by = auth.uid()
    where cfg.id = v_id
    returning * into v_row;

    if v_existing.entity_id is distinct from v_row.entity_id then
      perform public.billing_log_config_change(
        'billing_provider_configs', v_row.id::text, 'entity_id',
        to_jsonb(v_existing.entity_id), to_jsonb(v_row.entity_id), 'update'
      );
    end if;
    if v_existing.vault_secret_name is distinct from v_row.vault_secret_name then
      perform public.billing_log_config_change(
        'billing_provider_configs', v_row.id::text, 'vault_secret_name',
        to_jsonb(v_existing.vault_secret_name), to_jsonb(v_row.vault_secret_name), 'update'
      );
    end if;
  end if;

  insert into public.billing_provider_status (
    provider_config_id, legal_entity_id, provider_code, adapter_version
  ) values (
    v_row.id, v_row.legal_entity_id, v_row.provider_code,
    coalesce(v_row.adapter_version, (select adapter_version from public.billing_providers where code = v_row.provider_code))
  )
  on conflict (provider_config_id) do nothing;

  return (
    select elem from jsonb_array_elements(public.list_billing_provider_configs()) elem
    where elem ->> 'id' = v_row.id::text
    limit 1
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Monitoring RPC
-- ---------------------------------------------------------------------------

create or replace function public.get_billing_monitoring_summary(
  p_legal_entity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entity_id uuid;
  v_result jsonb;
begin
  if not public.can_view_billing_settings() then
    raise exception 'No tienes permiso para consultar monitoreo de facturacion.';
  end if;

  v_entity_id := coalesce(p_legal_entity_id, public.get_default_billing_legal_entity_id());

  select jsonb_build_object(
    'legal_entity_id', v_entity_id,
    'settings', public.get_billing_settings(),
    'document_counts', coalesce((
      select jsonb_agg(to_jsonb(c))
      from public.billing_monitoring_document_counts c
      where c.legal_entity_id = v_entity_id
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider_config_id', st.provider_config_id,
        'provider_code', st.provider_code,
        'adapter_version', st.adapter_version,
        'connection_status', st.connection_status,
        'last_test_at', st.last_test_at,
        'last_test_success', st.last_test_success,
        'last_test_duration_ms', st.last_test_duration_ms,
        'last_test_error_summary', st.last_test_error_summary,
        'last_test_error_codes', st.last_test_error_codes,
        'last_known_credits', st.last_known_credits,
        'last_successful_connection_at', st.last_successful_connection_at,
        'last_error_at', st.last_error_at,
        'last_error_summary', st.last_error_summary,
        'updated_at', st.updated_at,
        'environment', cfg.environment,
        'entity_id', cfg.entity_id
      ) order by st.provider_code)
      from public.billing_provider_status st
      join public.billing_provider_configs cfg on cfg.id = st.provider_config_id
      where st.legal_entity_id = v_entity_id
    ), '[]'::jsonb),
    'recent_attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'provider_code', a.provider_code,
        'adapter_version', a.adapter_version,
        'operation', a.operation,
        'status', a.status,
        'duration_ms', a.duration_ms,
        'error_codes', a.error_codes,
        'created_at', a.created_at
      ) order by a.created_at desc)
      from (
        select *
        from public.billing_certification_attempts
        where legal_entity_id = v_entity_id
        order by created_at desc
        limit 10
      ) a
    ), '[]'::jsonb),
    'last_error_by_provider', coalesce((
      select jsonb_object_agg(distinct_on.provider_code, dist_on.payload)
      from (
        select distinct on (a.provider_code)
          a.provider_code,
          jsonb_build_object(
            'error_codes', a.error_codes,
            'error_messages', a.error_messages,
            'created_at', a.created_at,
            'operation', a.operation
          ) as payload
        from public.billing_certification_attempts a
        where a.legal_entity_id = v_entity_id
          and a.status = 'failed'
        order by a.provider_code, a.created_at desc
      ) dist_on
    ), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: record attempt + update provider status (service_role / Edge Fn)
-- ---------------------------------------------------------------------------

create or replace function public.record_billing_certification_attempt(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_provider_config_id uuid;
  v_operation text;
  v_status text;
begin
  v_provider_config_id := nullif(p_payload ->> 'provider_config_id', '')::uuid;
  v_operation := coalesce(p_payload ->> 'operation', 'test_connection');
  v_status := coalesce(p_payload ->> 'status', 'failed');

  insert into public.billing_certification_attempts (
    document_id,
    provider_config_id,
    legal_entity_id,
    provider_code,
    adapter_version,
    attempt_number,
    operation,
    status,
    request_payload,
    response_payload,
    error_codes,
    error_messages,
    http_status,
    duration_ms,
    created_by
  ) values (
    nullif(p_payload ->> 'document_id', '')::uuid,
    v_provider_config_id,
    nullif(p_payload ->> 'legal_entity_id', '')::uuid,
    coalesce(p_payload ->> 'provider_code', 'unknown'),
    coalesce(p_payload ->> 'adapter_version', '0.0.0'),
    coalesce((p_payload ->> 'attempt_number')::integer, 1),
    v_operation,
    v_status,
    coalesce(p_payload -> 'request_payload', '{}'::jsonb),
    coalesce(p_payload -> 'response_payload', '{}'::jsonb),
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload -> 'error_codes', '[]'::jsonb)) as value),
      '{}'::text[]
    ),
    coalesce(p_payload -> 'error_messages', '[]'::jsonb),
    nullif(p_payload ->> 'http_status', '')::integer,
    nullif(p_payload ->> 'duration_ms', '')::integer,
    nullif(p_payload ->> 'created_by', '')::uuid
  ) returning id into v_attempt_id;

  if v_provider_config_id is not null and v_operation in ('test_connection', 'credits_check') then
    update public.billing_provider_status st
    set
      adapter_version = coalesce(p_payload ->> 'adapter_version', st.adapter_version),
      connection_status = case
        when v_status = 'success' then 'healthy'
        else 'error'
      end,
      last_test_at = now(),
      last_test_success = (v_status = 'success'),
      last_test_duration_ms = nullif(p_payload ->> 'duration_ms', '')::integer,
      last_test_error_summary = nullif(p_payload ->> 'error_summary', ''),
      last_test_error_codes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload -> 'error_codes', '[]'::jsonb)) as value),
        '{}'::text[]
      ),
      last_known_credits = nullif(p_payload ->> 'credits', '')::integer,
      last_successful_connection_at = case when v_status = 'success' then now() else st.last_successful_connection_at end,
      last_error_at = case when v_status = 'success' then st.last_error_at else now() end,
      last_error_summary = case when v_status = 'success' then st.last_error_summary else nullif(p_payload ->> 'error_summary', '') end,
      updated_at = now()
    where st.provider_config_id = v_provider_config_id;
  end if;

  return v_attempt_id;
end;
$$;

create or replace function public.get_billing_provider_config_for_service(
  p_provider_code text,
  p_environment text,
  p_legal_entity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entity_id uuid;
  v_row record;
begin
  v_entity_id := coalesce(p_legal_entity_id, public.get_default_billing_legal_entity_id());

  select
    cfg.id,
    cfg.legal_entity_id,
    cfg.provider_code,
    cfg.environment,
    cfg.entity_id,
    cfg.vault_secret_name,
    cfg.base_url,
    coalesce(cfg.adapter_version, prov.adapter_version) as adapter_version,
    prov.adapter_key,
    prov.name as provider_name
  into v_row
  from public.billing_provider_configs cfg
  join public.billing_providers prov on prov.code = cfg.provider_code
  where cfg.legal_entity_id = v_entity_id
    and cfg.provider_code = p_provider_code
    and cfg.environment = p_environment
    and cfg.is_active = true
  order by cfg.is_default desc, cfg.updated_at desc
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'legal_entity_id', v_row.legal_entity_id,
    'provider_code', v_row.provider_code,
    'environment', v_row.environment,
    'entity_id', v_row.entity_id,
    'vault_secret_name', v_row.vault_secret_name,
    'base_url', v_row.base_url,
    'adapter_version', v_row.adapter_version,
    'adapter_key', v_row.adapter_key,
    'provider_name', v_row.provider_name
  );
end;
$$;

create or replace function public.get_billing_vault_secret(p_secret_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acceso denegado a secretos de facturacion.';
  end if;

  if nullif(trim(p_secret_name), '') is null then
    raise exception 'Nombre de secreto invalido.';
  end if;

  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = p_secret_name
    limit 1;
  exception
    when undefined_table then
      raise exception 'Supabase Vault no esta habilitado. Habilita la extension vault.';
  end;

  return v_secret;
end;
$$;

create or replace function public.list_billing_documents(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce((p_filter ->> 'limit')::integer, 50), 200));
begin
  if not public.can_view_billing_documents() then
    raise exception 'No tienes permiso para consultar documentos de facturacion.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(d) order by d.created_at desc)
    from (
      select
        doc.id,
        doc.legal_entity_id,
        doc.document_type,
        doc.status,
        doc.currency,
        doc.external_id,
        doc.certification_authorization,
        doc.certified_at,
        doc.created_at
      from public.billing_documents doc
      order by doc.created_at desc
      limit v_limit
    ) d
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_billing_config_audit(
  p_limit integer default 50
)
returns setof public.billing_config_audit_log
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.billing_config_audit_log
  where public.can_manage_billing_settings()
  order by changed_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.billing_legal_entities enable row level security;
alter table public.billing_providers enable row level security;
alter table public.billing_provider_configs enable row level security;
alter table public.billing_documents enable row level security;
alter table public.billing_document_lines enable row level security;
alter table public.billing_certification_attempts enable row level security;
alter table public.billing_document_links enable row level security;
alter table public.billing_config_audit_log enable row level security;
alter table public.billing_provider_status enable row level security;

grant select on public.billing_legal_entities to authenticated;
grant select on public.billing_providers to authenticated;
grant select on public.billing_provider_configs to authenticated;
grant select on public.billing_documents to authenticated;
grant select on public.billing_document_lines to authenticated;
grant select on public.billing_certification_attempts to authenticated;
grant select on public.billing_document_links to authenticated;
grant select on public.billing_config_audit_log to authenticated;
grant select on public.billing_provider_status to authenticated;
grant select on public.billing_monitoring_document_counts to authenticated;

grant all on public.billing_legal_entities to service_role;
grant all on public.billing_providers to service_role;
grant all on public.billing_provider_configs to service_role;
grant all on public.billing_documents to service_role;
grant all on public.billing_document_lines to service_role;
grant all on public.billing_certification_attempts to service_role;
grant all on public.billing_document_links to service_role;
grant all on public.billing_config_audit_log to service_role;
grant all on public.billing_provider_status to service_role;

drop policy if exists billing_legal_entities_select on public.billing_legal_entities;
create policy billing_legal_entities_select on public.billing_legal_entities
  for select to authenticated using (public.can_view_billing_settings());

drop policy if exists billing_providers_select on public.billing_providers;
create policy billing_providers_select on public.billing_providers
  for select to authenticated using (true);

drop policy if exists billing_provider_configs_select on public.billing_provider_configs;
create policy billing_provider_configs_select on public.billing_provider_configs
  for select to authenticated using (public.can_view_billing_settings());

drop policy if exists billing_documents_select on public.billing_documents;
create policy billing_documents_select on public.billing_documents
  for select to authenticated using (public.can_view_billing_documents());

drop policy if exists billing_document_lines_select on public.billing_document_lines;
create policy billing_document_lines_select on public.billing_document_lines
  for select to authenticated using (
    exists (
      select 1 from public.billing_documents doc
      where doc.id = billing_document_lines.document_id
        and public.can_view_billing_documents()
    )
  );

drop policy if exists billing_certification_attempts_select on public.billing_certification_attempts;
create policy billing_certification_attempts_select on public.billing_certification_attempts
  for select to authenticated using (public.can_view_billing_settings());

drop policy if exists billing_document_links_select on public.billing_document_links;
create policy billing_document_links_select on public.billing_document_links
  for select to authenticated using (public.can_view_billing_documents());

drop policy if exists billing_config_audit_select on public.billing_config_audit_log;
create policy billing_config_audit_select on public.billing_config_audit_log
  for select to authenticated using (public.can_manage_billing_settings());

drop policy if exists billing_provider_status_select on public.billing_provider_status;
create policy billing_provider_status_select on public.billing_provider_status
  for select to authenticated using (public.can_view_billing_settings());

-- ---------------------------------------------------------------------------
-- Grants on functions
-- ---------------------------------------------------------------------------

revoke all on function public.billing_log_config_change(text, text, text, jsonb, jsonb, text, jsonb) from public;
revoke all on function public.can_manage_billing_settings() from public;
revoke all on function public.can_view_billing_settings() from public;
revoke all on function public.can_view_billing_documents() from public;
revoke all on function public.can_retry_billing_certification() from public;
revoke all on function public.billing_settings_default() from public;
revoke all on function public.get_billing_settings() from public;
revoke all on function public.set_billing_settings(jsonb) from public;
revoke all on function public.is_billing_emission_enabled() from public;
revoke all on function public.list_billing_legal_entities() from public;
revoke all on function public.get_default_billing_legal_entity_id() from public;
revoke all on function public.list_billing_provider_configs() from public;
revoke all on function public.upsert_billing_provider_config(jsonb) from public;
revoke all on function public.get_billing_monitoring_summary(uuid) from public;
revoke all on function public.record_billing_certification_attempt(jsonb) from public;
revoke all on function public.get_billing_provider_config_for_service(text, text, uuid) from public;
revoke all on function public.get_billing_vault_secret(text) from public;
revoke all on function public.list_billing_documents(jsonb) from public;
revoke all on function public.list_billing_config_audit(integer) from public;

grant execute on function public.can_manage_billing_settings() to authenticated;
grant execute on function public.can_view_billing_settings() to authenticated;
grant execute on function public.can_view_billing_documents() to authenticated;
grant execute on function public.can_retry_billing_certification() to authenticated;
grant execute on function public.get_billing_settings() to authenticated;
grant execute on function public.set_billing_settings(jsonb) to authenticated;
grant execute on function public.is_billing_emission_enabled() to authenticated;
grant execute on function public.list_billing_legal_entities() to authenticated;
grant execute on function public.list_billing_provider_configs() to authenticated;
grant execute on function public.upsert_billing_provider_config(jsonb) to authenticated;
grant execute on function public.get_billing_monitoring_summary(uuid) to authenticated;
grant execute on function public.list_billing_documents(jsonb) to authenticated;
grant execute on function public.list_billing_config_audit(integer) to authenticated;

grant execute on function public.record_billing_certification_attempt(jsonb) to service_role;
grant execute on function public.get_billing_provider_config_for_service(text, text, uuid) to service_role;
grant execute on function public.get_billing_vault_secret(text) to service_role;
grant execute on function public.get_default_billing_legal_entity_id() to service_role;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

insert into public.billing_legal_entities (code, legal_name, trade_name, is_default, is_active)
values (
  'default',
  'Pizzeria El Gran Alcazar',
  'El Gran Alcazar',
  true,
  true
)
on conflict (code) do nothing;

insert into public.billing_providers (code, name, country_code, adapter_key, adapter_version, capabilities)
values (
  'felplex_gt',
  'FELplex Guatemala',
  'GT',
  'felplex-guatemala',
  '1.0.0',
  '{"issue":true,"void":true,"lookup_tax_id":true,"reports":true,"test_connection":true}'::jsonb
)
on conflict (code) do update
  set adapter_version = excluded.adapter_version,
      capabilities = excluded.capabilities,
      updated_at = now();

insert into public.app_settings (key, value)
values ('billing_settings', public.billing_settings_default())
on conflict (key) do nothing;
