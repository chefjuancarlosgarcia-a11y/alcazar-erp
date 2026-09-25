-- POS electronic invoicing (FELplex) — schema, helpers, and request RPC (Phase 0).
-- Apply after 200_get_executive_dashboard_metrics.sql.
--
-- NOTE: Migration 160_billing_edge_secrets.sql is referenced by 161_pos_configurable_products.sql
-- but is NOT present in this repository. This migration uses the next available number (201).
--
-- Phase 0 constraints:
--   * NO default configuration row — absence = FEL disabled
--   * emission_enabled must remain false until Stage runbook explicitly enables it
--   * request_pos_fel_certification does NOT call FELplex
--   * request_payload remains NULL (Edge adapter builds payload in a later phase)
--   * NO triggers on pos_orders or pos_order_payments
--   * NO changes to create_pos_split_payment or payment flow

-- ---------------------------------------------------------------------------
-- 1. Configuration singleton (no secrets, no auto-seed)
-- ---------------------------------------------------------------------------

create table if not exists public.fel_emission_config (
  id smallint primary key default 1 check (id = 1),
  environment text not null
    check (environment in ('stage', 'production')),
  emission_enabled boolean not null default false,
  auto_issue_paid_orders boolean not null default true,
  tax_rate numeric(6, 4) not null default 0.12
    check (tax_rate = 0.12),
  prices_include_tax boolean not null default true,
  invoice_description text not null default 'Consumo de Alimentos',
  formal_contingency_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint fel_emission_config_contingency_off_v1
    check (formal_contingency_enabled = false)
);

comment on table public.fel_emission_config is
  'Singleton FEL operational flags per database deployment. No secrets. '
  'Create exactly one row via Stage/Prod runbook; absence means FEL disabled.';

-- ---------------------------------------------------------------------------
-- 2. Permission helpers (SECURITY DEFINER, minimal EXECUTE)
-- ---------------------------------------------------------------------------

create or replace function public.fel_can_request_fel_certification()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_current_profile_active()
    and public.is_cash_operator();
$$;

create or replace function public.fel_can_manage_fel_documents()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_current_profile_active()
    and public.normalize_profile_role(public.current_profile_role()) in (
      'admin', 'gerente_general', 'supervisor'
    );
$$;

create or replace function public.fel_can_view_fel_documents()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.fel_can_request_fel_certification()
    or public.fel_can_manage_fel_documents()
    or public.can_view_finance();
$$;

revoke all on function
  public.fel_can_request_fel_certification(),
  public.fel_can_manage_fel_documents(),
  public.fel_can_view_fel_documents()
from public, anon, authenticated;

grant execute on function
  public.fel_can_request_fel_certification(),
  public.fel_can_manage_fel_documents(),
  public.fel_can_view_fel_documents()
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Monetary / tax helpers (IMMUTABLE, no SECURITY DEFINER)
-- ---------------------------------------------------------------------------

create or replace function public.fel_round_money(p_amount numeric)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select round(p_amount, 2);
$$;

create or replace function public.fel_taxable_base_from_gross(
  p_gross numeric,
  p_rate numeric default 0.12
)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select public.fel_round_money(p_gross / (1 + p_rate));
$$;

create or replace function public.fel_vat_from_gross_included(
  p_gross numeric,
  p_rate numeric default 0.12
)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select public.fel_round_money(
    p_gross - public.fel_taxable_base_from_gross(p_gross, p_rate)
  );
$$;

create or replace function public.fel_assert_tax_reconciliation(
  p_base numeric,
  p_vat numeric,
  p_gross numeric
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select public.fel_round_money(p_base + p_vat) = public.fel_round_money(p_gross);
$$;

create or replace function public.fel_build_external_id(p_order_id uuid)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'POS-' || p_order_id::text;
$$;

create or replace function public.fel_normalize_receiver_nit(p_nit text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nit text := upper(trim(coalesce(p_nit, '')));
begin
  if v_nit = '' or v_nit in ('CF', 'C/F', 'CONSUMIDOR FINAL') then
    return 'CF';
  end if;
  return v_nit;
end;
$$;

create or replace function public.fel_sanitize_public_error(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    left(
      trim(
        regexp_replace(
          coalesce(p_message, ''),
          '(api[_ -]?key|authorization|service[_ -]?role|bearer\s+\S+)',
          '[redacted]',
          'gi'
        )
      ),
      240
    ),
    ''
  );
$$;

revoke all on function
  public.fel_round_money(numeric),
  public.fel_taxable_base_from_gross(numeric, numeric),
  public.fel_vat_from_gross_included(numeric, numeric),
  public.fel_assert_tax_reconciliation(numeric, numeric, numeric),
  public.fel_build_external_id(uuid),
  public.fel_normalize_receiver_nit(text),
  public.fel_sanitize_public_error(text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. pos_fel_documents
-- ---------------------------------------------------------------------------

create table if not exists public.pos_fel_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  parent_document_id uuid references public.pos_fel_documents(id) on delete restrict,
  trigger_payment_id uuid references public.pos_order_payments(id) on delete set null,
  document_type text not null default 'FACT'
    check (document_type in ('FACT', 'NCRE')),
  external_id text not null,
  environment text not null
    check (environment in ('stage', 'production')),
  status text not null default 'pending_certification'
    check (status in (
      'pending_certification',
      'processing',
      'certified',
      'failed',
      'cancelled',
      'contingency_pending',
      'contingency_certified'
    )),
  receiver_nit text not null default 'CF',
  receiver_name text not null default 'Consumidor Final',
  receiver_address text,
  receiver_email text,
  receiver_snapshot jsonb not null default '{}'::jsonb,
  order_snapshot jsonb not null default '{}'::jsonb,
  items_snapshot jsonb not null default '[]'::jsonb,
  fiscal_description text not null default 'Consumo de Alimentos',
  gross_items_total numeric(12, 2) not null default 0
    check (gross_items_total >= 0),
  discount_total numeric(12, 2) not null default 0
    check (discount_total >= 0),
  tip_total numeric(12, 2) not null default 0
    check (tip_total >= 0),
  taxable_gross_total numeric(12, 2) not null default 0
    check (taxable_gross_total >= 0),
  taxable_base numeric(12, 2) not null default 0
    check (taxable_base >= 0),
  vat_rate numeric(6, 4) not null default 0.12
    check (vat_rate = 0.12),
  vat_total numeric(12, 2) not null default 0
    check (vat_total >= 0),
  invoice_total numeric(12, 2) not null default 0
    check (invoice_total >= 0),
  request_payload jsonb,
  response_payload jsonb,
  fel_uuid text,
  sat_authorization text,
  sat_series text,
  sat_document_number text,
  certified_at timestamptz,
  last_error text,
  errors jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0
    check (retry_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_fel_documents_external_id_uidx unique (external_id),
  constraint pos_fel_documents_gross_minus_discount_check
    check (gross_items_total - discount_total = taxable_gross_total),
  constraint pos_fel_documents_taxable_gross_invoice_check
    check (taxable_gross_total = invoice_total),
  constraint pos_fel_documents_tax_exact_reconciliation_check
    check (taxable_base + vat_total = invoice_total),
  constraint pos_fel_documents_v1_discount_zero_check
    check (discount_total = 0),
  constraint pos_fel_documents_v1_tip_zero_check
    check (tip_total = 0),
  constraint pos_fel_documents_receiver_nit_len_check
    check (char_length(receiver_nit) <= 20),
  constraint pos_fel_documents_receiver_name_len_check
    check (char_length(receiver_name) <= 200),
  constraint pos_fel_documents_receiver_address_len_check
    check (receiver_address is null or char_length(receiver_address) <= 500),
  constraint pos_fel_documents_receiver_email_len_check
    check (receiver_email is null or char_length(receiver_email) <= 320)
);

create unique index if not exists pos_fel_documents_one_fact_per_order_uidx
  on public.pos_fel_documents (order_id)
  where document_type = 'FACT';

create index if not exists pos_fel_documents_status_created_idx
  on public.pos_fel_documents (status, created_at desc);

create index if not exists pos_fel_documents_order_idx
  on public.pos_fel_documents (order_id);

comment on table public.pos_fel_documents is
  'FELplex electronic documents linked to POS orders. One FACT per paid order. '
  'Full rows are backend-only; frontend uses get_pos_fel_document_status.';

comment on column public.pos_fel_documents.request_payload is
  'Reserved for Edge adapter phase. Must remain NULL in Phase 0 RPC.';

-- ---------------------------------------------------------------------------
-- 5. pos_fel_attempts
-- ---------------------------------------------------------------------------

create table if not exists public.pos_fel_attempts (
  id uuid primary key default gen_random_uuid(),
  fel_document_id uuid not null references public.pos_fel_documents(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null
    check (outcome in ('pending', 'success', 'failed', 'skipped')),
  http_status integer,
  request_payload jsonb,
  response_payload jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint pos_fel_attempts_document_attempt_uidx
    unique (fel_document_id, attempt_number)
);

create index if not exists pos_fel_attempts_document_idx
  on public.pos_fel_attempts (fel_document_id, attempt_number desc);

comment on table public.pos_fel_attempts is
  'Certification attempt history. Phase Edge will insert via a controlled RPC. '
  'Append-only enforcement completes in the Edge phase; service_role only in Phase 0.';

-- ---------------------------------------------------------------------------
-- 6. RLS — backend-only tables (no direct frontend access)
-- ---------------------------------------------------------------------------

alter table public.fel_emission_config enable row level security;
alter table public.pos_fel_documents enable row level security;
alter table public.pos_fel_attempts enable row level security;

revoke all on table public.fel_emission_config from anon, authenticated;
revoke all on table public.pos_fel_documents, public.pos_fel_attempts from anon, authenticated;

grant all on table public.fel_emission_config to service_role;
grant all on table public.pos_fel_documents, public.pos_fel_attempts to service_role;

drop policy if exists "fel_emission_config_authenticated_read" on public.fel_emission_config;
drop policy if exists "fel_emission_config_managers_update" on public.fel_emission_config;
drop policy if exists "pos_fel_documents_authorized_read" on public.pos_fel_documents;
drop policy if exists "pos_fel_attempts_authorized_read" on public.pos_fel_attempts;

drop policy if exists "fel_emission_config_service_role_all" on public.fel_emission_config;
create policy "fel_emission_config_service_role_all"
  on public.fel_emission_config for all to service_role
  using (true) with check (true);

drop policy if exists "pos_fel_documents_service_role_all" on public.pos_fel_documents;
create policy "pos_fel_documents_service_role_all"
  on public.pos_fel_documents for all to service_role
  using (true) with check (true);

drop policy if exists "pos_fel_attempts_service_role_all" on public.pos_fel_attempts;
create policy "pos_fel_attempts_service_role_all"
  on public.pos_fel_attempts for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. Internal helpers (SECURITY DEFINER, not callable from frontend)
-- ---------------------------------------------------------------------------

create or replace function public.fel_get_emission_config()
returns public.fel_emission_config
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.fel_emission_config c
  where c.id = 1;
$$;

create or replace function public.fel_order_payment_reconciliation(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.pos_orders;
  v_amount_paid numeric(12, 2);
  v_trigger_payment_id uuid;
begin
  select o.* into v_order
  from public.pos_orders o
  where o.id = p_order_id;

  if v_order.id is null then
    raise exception 'Orden no encontrada.'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount), 0)::numeric(12, 2) into v_amount_paid
  from public.pos_order_payments p
  where p.order_id = p_order_id
    and p.status = 'paid';

  select p.id into v_trigger_payment_id
  from public.pos_order_payments p
  where p.order_id = p_order_id
    and p.status = 'paid'
  order by p.created_at desc, p.payment_number desc
  limit 1;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_status', v_order.status,
    'order_total', public.fel_round_money(v_order.total),
    'amount_paid', public.fel_round_money(v_amount_paid),
    'balance_due', public.fel_round_money(greatest(0, v_order.total - v_amount_paid)),
    'trigger_payment_id', v_trigger_payment_id,
    'is_fully_paid', v_order.status = 'paid'
      and public.fel_round_money(v_amount_paid) >= public.fel_round_money(v_order.total)
      and public.fel_round_money(v_order.total) > 0
  );
end;
$$;

create or replace function public.fel_build_order_items_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', i.id,
        'product_id', i.product_id,
        'product_name', i.product_name,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'total_price', i.total_price,
        'product_variant_id', i.product_variant_id,
        'product_variant_name', i.product_variant_name,
        'modifiers', i.modifiers,
        'selected_options', i.selected_options,
        'status', i.status
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
  from public.pos_order_items i
  where i.order_id = p_order_id
    and i.status <> 'cancelled';
$$;

revoke all on function
  public.fel_get_emission_config(),
  public.fel_order_payment_reconciliation(uuid),
  public.fel_build_order_items_snapshot(uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC get_pos_fel_document_status (limited public surface)
-- ---------------------------------------------------------------------------

create or replace function public.get_pos_fel_document_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc public.pos_fel_documents;
begin
  if p_order_id is null then
    raise exception 'Debes indicar una orden POS.'
      using errcode = 'P0001';
  end if;

  if not public.fel_can_view_fel_documents() then
    raise exception 'No tienes permiso para consultar el estado FEL.'
      using errcode = 'P0001';
  end if;

  select d.* into v_doc
  from public.pos_fel_documents d
  where d.order_id = p_order_id
    and d.document_type = 'FACT';

  if v_doc.id is null then
    return jsonb_build_object('found', false, 'order_id', p_order_id);
  end if;

  return jsonb_build_object(
    'found', true,
    'document_id', v_doc.id,
    'order_id', v_doc.order_id,
    'document_type', v_doc.document_type,
    'status', v_doc.status,
    'external_id', v_doc.external_id,
    'invoice_total', v_doc.invoice_total,
    'sat_series', v_doc.sat_series,
    'sat_document_number', v_doc.sat_document_number,
    'sat_authorization', v_doc.sat_authorization,
    'fel_uuid', v_doc.fel_uuid,
    'certified_at', v_doc.certified_at,
    'error_message', case
      when v_doc.status in ('failed', 'pending_certification')
        then public.fel_sanitize_public_error(v_doc.last_error)
      else null
    end
  );
end;
$$;

revoke all on function public.get_pos_fel_document_status(uuid)
from public, anon;

grant execute on function public.get_pos_fel_document_status(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 9. RPC request_pos_fel_certification
-- ---------------------------------------------------------------------------

create or replace function public.request_pos_fel_certification(
  p_order_id uuid,
  p_receiver_nit text default null,
  p_receiver_name text default null,
  p_receiver_address text default null,
  p_receiver_email text default null,
  p_discount_total numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.fel_emission_config;
  v_existing public.pos_fel_documents;
  v_document public.pos_fel_documents;
  v_reconciliation jsonb;
  v_receiver_nit text;
  v_receiver_name text;
  v_receiver_address text;
  v_receiver_email text;
  v_receiver_snapshot jsonb;
  v_order_snapshot jsonb;
  v_items_snapshot jsonb;
  v_taxable_gross numeric(12, 2);
  v_taxable_base numeric(12, 2);
  v_vat_total numeric(12, 2);
begin
  if not public.fel_can_request_fel_certification() then
    raise exception 'No tienes permiso para solicitar certificacion FEL.'
      using errcode = 'P0001';
  end if;

  if p_order_id is null then
    raise exception 'Debes indicar una orden POS.'
      using errcode = 'P0001';
  end if;

  v_config := public.fel_get_emission_config();

  if v_config.id is null then
    raise exception 'FEL_EMISSION_DISABLED: Configuracion FEL ausente. FEL deshabilitado.'
      using errcode = 'P0001';
  end if;

  if not v_config.emission_enabled then
    raise exception 'FEL_EMISSION_DISABLED: La emision FEL esta deshabilitada.'
      using errcode = 'P0001';
  end if;

  if v_config.formal_contingency_enabled then
    raise exception 'FEL_CONTINGENCY_NOT_SUPPORTED: Contingencia formal no habilitada en esta version.'
      using errcode = 'P0001';
  end if;

  if coalesce(p_discount_total, 0) <> 0 then
    raise exception 'FEL_DISCOUNT_NOT_AUTHORITATIVE: Descuentos no persistidos en Supabase. Solicitud bloqueada.'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_fel_request:' || p_order_id::text));

  select d.* into v_existing
  from public.pos_fel_documents d
  where d.order_id = p_order_id
    and d.document_type = 'FACT';

  if v_existing.id is not null then
    return jsonb_build_object(
      'document_id', v_existing.id,
      'order_id', v_existing.order_id,
      'external_id', v_existing.external_id,
      'status', v_existing.status,
      'invoice_total', v_existing.invoice_total,
      'taxable_base', v_existing.taxable_base,
      'vat_total', v_existing.vat_total,
      'idempotent', true,
      'message', 'Documento FEL existente reutilizado.'
    );
  end if;

  v_reconciliation := public.fel_order_payment_reconciliation(p_order_id);

  if not coalesce((v_reconciliation ->> 'is_fully_paid')::boolean, false) then
    raise exception 'FEL_ORDER_NOT_PAID: La orden debe estar completamente pagada para solicitar FACT.'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'order_total')::numeric) <= 0 then
    raise exception 'FEL_ORDER_TOTAL_ZERO: El total de la orden debe ser mayor a cero.'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'amount_paid')::numeric)
      <> public.fel_round_money((v_reconciliation ->> 'order_total')::numeric) then
    raise exception 'FEL_PAYMENT_MISMATCH: El total pagado no coincide con el total de la orden.'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'balance_due')::numeric) > 0 then
    raise exception 'FEL_BALANCE_DUE: Existe saldo pendiente en la orden.'
      using errcode = 'P0001';
  end if;

  v_receiver_nit := public.fel_normalize_receiver_nit(p_receiver_nit);
  if char_length(v_receiver_nit) > 20 then
    raise exception 'FEL_RECEIVER_NIT_TOO_LONG: NIT excede longitud permitida.'
      using errcode = 'P0001';
  end if;

  if v_receiver_nit = 'CF' then
    v_receiver_name := 'Consumidor Final';
  else
    v_receiver_name := nullif(trim(p_receiver_name), '');
    if v_receiver_name is null then
      raise exception 'FEL_RECEIVER_NAME_REQUIRED: Debes indicar nombre del receptor cuando proporcionas NIT.'
        using errcode = 'P0001';
    end if;
    if char_length(v_receiver_name) > 200 then
      raise exception 'FEL_RECEIVER_NAME_TOO_LONG: Nombre del receptor excede longitud permitida.'
        using errcode = 'P0001';
    end if;
  end if;

  v_receiver_address := nullif(trim(p_receiver_address), '');
  if v_receiver_address is not null and char_length(v_receiver_address) > 500 then
    raise exception 'FEL_RECEIVER_ADDRESS_TOO_LONG: Direccion excede longitud permitida.'
      using errcode = 'P0001';
  end if;

  v_receiver_email := nullif(trim(p_receiver_email), '');
  if v_receiver_email is not null and char_length(v_receiver_email) > 320 then
    raise exception 'FEL_RECEIVER_EMAIL_TOO_LONG: Correo excede longitud permitida.'
      using errcode = 'P0001';
  end if;

  v_receiver_snapshot := jsonb_build_object(
    'nit', v_receiver_nit,
    'name', v_receiver_name,
    'address', coalesce(v_receiver_address, ''),
    'email', coalesce(v_receiver_email, ''),
    'captured_at', now()
  );

  v_order_snapshot := v_reconciliation || jsonb_build_object(
    'captured_at', now(),
    'sales_channel', (select o.sales_channel from public.pos_orders o where o.id = p_order_id),
    'customer_id', (select o.customer_id from public.pos_orders o where o.id = p_order_id)
  );

  v_items_snapshot := public.fel_build_order_items_snapshot(p_order_id);

  v_taxable_gross := public.fel_round_money((v_reconciliation ->> 'order_total')::numeric);
  v_taxable_base := public.fel_taxable_base_from_gross(v_taxable_gross, v_config.tax_rate);
  v_vat_total := public.fel_vat_from_gross_included(v_taxable_gross, v_config.tax_rate);

  if not public.fel_assert_tax_reconciliation(v_taxable_base, v_vat_total, v_taxable_gross) then
    raise exception 'FEL_TAX_RECONCILIATION_FAILED: No fue posible conciliar base e IVA.'
      using errcode = 'P0001';
  end if;

  insert into public.pos_fel_documents (
    order_id,
    trigger_payment_id,
    document_type,
    external_id,
    environment,
    status,
    receiver_nit,
    receiver_name,
    receiver_address,
    receiver_email,
    receiver_snapshot,
    order_snapshot,
    items_snapshot,
    fiscal_description,
    gross_items_total,
    discount_total,
    tip_total,
    taxable_gross_total,
    taxable_base,
    vat_rate,
    vat_total,
    invoice_total,
    request_payload,
    requested_by
  ) values (
    p_order_id,
    nullif(v_reconciliation ->> 'trigger_payment_id', '')::uuid,
    'FACT',
    public.fel_build_external_id(p_order_id),
    v_config.environment,
    'pending_certification',
    v_receiver_nit,
    v_receiver_name,
    v_receiver_address,
    v_receiver_email,
    v_receiver_snapshot,
    v_order_snapshot,
    v_items_snapshot,
    v_config.invoice_description,
    v_taxable_gross,
    0,
    0,
    v_taxable_gross,
    v_taxable_base,
    v_config.tax_rate,
    v_vat_total,
    v_taxable_gross,
    null,
    auth.uid()
  )
  returning * into v_document;

  return jsonb_build_object(
    'document_id', v_document.id,
    'order_id', v_document.order_id,
    'trigger_payment_id', v_document.trigger_payment_id,
    'external_id', v_document.external_id,
    'status', v_document.status,
    'receiver_nit', v_document.receiver_nit,
    'receiver_name', v_document.receiver_name,
    'invoice_total', v_document.invoice_total,
    'taxable_base', v_document.taxable_base,
    'vat_total', v_document.vat_total,
    'items_snapshot_count', jsonb_array_length(v_document.items_snapshot),
    'request_payload', null,
    'idempotent', false,
    'message', 'Solicitud FEL registrada. Certificacion pendiente (Edge Function).'
  );
end;
$$;

revoke all on function public.request_pos_fel_certification(
  uuid, text, text, text, text, numeric
) from public, anon;

grant execute on function public.request_pos_fel_certification(
  uuid, text, text, text, text, numeric
) to authenticated;

comment on function public.request_pos_fel_certification(uuid, text, text, text, text, numeric) is
  'Phase 0: registers a pending FACT for a fully paid POS order. '
  'Does not call FELplex. Does not build request_payload. Idempotent per order.';

comment on function public.get_pos_fel_document_status(uuid) is
  'Limited FEL status for cash/finance roles. No snapshots or technical payloads.';
