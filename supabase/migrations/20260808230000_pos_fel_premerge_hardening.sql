-- FELplex pre-merge hardening (additive after 20260808190000 and 20260808220000).
-- No HTTP, no remote calls, no configuration row insertion, and no emission enablement.

-- 1. Fail closed before changing the singleton constraints/defaults.
do $fel_premerge_config_guard$
begin
  if pg_catalog.to_regclass('public.fel_emission_config') is null then
    raise exception 'FEL_PREMERGE_CONFIG_MISSING: public.fel_emission_config is required.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.fel_emission_config c
    where c.id = 1
      and c.emission_enabled is distinct from false
  ) then
    raise exception 'FEL_HARDENING_REQUIRES_EMISSION_DISABLED: emission_enabled debe estar en false antes de aplicar 230000.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.fel_emission_config c
    where c.id <> 1
       or c.environment <> 'stage'
       or c.auto_issue_paid_orders
       or c.formal_contingency_enabled
  ) then
    raise exception 'FEL_PREMERGE_CONFIG_INCOMPATIBLE: require id=1, environment=stage, auto_issue_paid_orders=false and formal_contingency_enabled=false.'
      using errcode = 'P0001';
  end if;
end;
$fel_premerge_config_guard$;

alter table public.fel_emission_config
  alter column environment set default 'stage',
  alter column emission_enabled set default false,
  alter column auto_issue_paid_orders set default false,
  alter column formal_contingency_enabled set default false;

alter table public.fel_emission_config
  drop constraint if exists fel_emission_config_environment_check;

alter table public.fel_emission_config
  drop constraint if exists fel_emission_config_environment_stage_check;

alter table public.fel_emission_config
  add constraint fel_emission_config_environment_stage_check
  check (environment = 'stage');

-- 2. Public request RPC retains its signature but now enforces Stage in PostgreSQL.
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

  if v_config.environment <> 'stage' then
    raise exception 'FEL_ENVIRONMENT_NOT_STAGE: Ambiente FEL distinto de stage.'
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

  v_reconciliation := public.fel_order_payment_reconciliation(p_order_id);

  if coalesce(v_reconciliation ->> 'order_status', '') <> 'paid' then
    raise exception 'FEL_ORDER_NOT_PAID: La orden debe conservar estado paid.'
      using errcode = 'P0001';
  end if;

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
  'Phase 1A.3 hardening: registers/reuses a pending FACT only in Stage for a fully paid POS order. '
  'Does not call FELplex. Does not build request_payload. Idempotent per order.';

-- 3. Request payload validation: object-or-NULL, 32 KiB maximum, recursive denylist.
create or replace function public.fel_payload_key_is_forbidden(p_key text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(lower(coalesce(p_key, '')), '[^a-z0-9]', '', 'g')) = any(array[
    'authorization', 'xauthorization', 'apikey', 'xapikey', 'accesstoken', 'refreshtoken',
    'serviceroletoken', 'serviceaccount', 'secret', 'clientsecret', 'credential', 'credentials',
    'password', 'passwd', 'bearer', 'token', 'headers', 'cookie', 'servicerolekey'
  ]);
$$;

create or replace function public.fel_validate_request_payload_node(p_node jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_element jsonb;
begin
  if p_node is null then
    return;
  end if;

  if jsonb_typeof(p_node) = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_node)
    loop
      if public.fel_payload_key_is_forbidden(v_key) then
        raise exception 'FEL_REQUEST_PAYLOAD_INVALID: clave sensible prohibida.'
          using errcode = 'P0001';
      end if;

      perform public.fel_validate_request_payload_node(v_value);
    end loop;
  elsif jsonb_typeof(p_node) = 'array' then
    for v_element in select value from jsonb_array_elements(p_node)
    loop
      perform public.fel_validate_request_payload_node(v_element);
    end loop;
  end if;
end;
$$;

create or replace function public.fel_validate_request_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_payload is null then
    return null;
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'FEL_REQUEST_PAYLOAD_INVALID: payload debe ser objeto jsonb o null.'
      using errcode = 'P0001';
  end if;

  if octet_length(p_payload::text) > 32768 then
    raise exception 'FEL_REQUEST_PAYLOAD_INVALID: payload excede 32768 bytes.'
      using errcode = 'P0001';
  end if;

  perform public.fel_validate_request_payload_node(p_payload);

  return p_payload;
end;
$$;

revoke all on function
  public.fel_payload_key_is_forbidden(text),
  public.fel_validate_request_payload_node(jsonb),
  public.fel_validate_request_payload(jsonb)
from public, anon, authenticated, service_role;

-- 4. Finalize validates request payload and rechecks payment before success.
create or replace function public.fel_finalize_pos_fel_certification_attempt(
  p_document_id uuid,
  p_attempt_id uuid,
  p_outcome text,
  p_fel_uuid text default null,
  p_sat_authorization text default null,
  p_sat_series text default null,
  p_sat_document_number text default null,
  p_certified_at timestamptz default null,
  p_http_status integer default null,
  p_error_code text default null,
  p_error_message text default null,
  p_safe_response_payload jsonb default null,
  p_request_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.pos_fel_documents;
  v_attempt public.pos_fel_attempts;
  v_now timestamptz := now();
  v_doc_updated integer;
  v_attempt_updated integer;
  v_safe_message text;
  v_safe_payload jsonb;
  v_request_payload jsonb;
  v_reconciliation jsonb;
  v_new_status text;
begin
  if p_document_id is null or p_attempt_id is null then
    raise exception 'FEL_INVALID_INPUT: document_id y attempt_id requeridos.'
      using errcode = 'P0001';
  end if;

  if p_outcome not in ('success', 'failed') then
    raise exception 'FEL_INVALID_INPUT: outcome debe ser success o failed.'
      using errcode = 'P0001';
  end if;

  v_safe_payload := public.fel_validate_safe_response_payload(p_safe_response_payload);
  v_request_payload := public.fel_validate_request_payload(p_request_payload);

  perform pg_advisory_xact_lock(hashtext('pos_fel_certify:' || p_document_id::text));

  select d.* into v_doc
  from public.pos_fel_documents d
  where d.id = p_document_id
  for update;

  if v_doc.id is null then
    raise exception 'FEL_DOCUMENT_NOT_FOUND'
      using errcode = 'P0001';
  end if;

  if v_doc.environment <> 'stage' then
    raise exception 'FEL_PRODUCTION_BLOCKED: finalize solo admite documentos Stage.'
      using errcode = 'P0001';
  end if;

  if v_doc.status = 'certified' then
    raise exception 'FEL_ALREADY_CERTIFIED: documento ya certificado, no sobrescribible.'
      using errcode = 'P0001';
  end if;

  if v_doc.status <> 'processing' then
    raise exception 'FEL_FINALIZE_INVALID_STATE: documento debe estar en processing.'
      using errcode = 'P0001';
  end if;

  select a.* into v_attempt
  from public.pos_fel_attempts a
  where a.id = p_attempt_id
    and a.fel_document_id = p_document_id
  for update;

  if v_attempt.id is null then
    raise exception 'FEL_ATTEMPT_NOT_FOUND: intento no pertenece al documento.'
      using errcode = 'P0001';
  end if;

  if v_attempt.outcome <> 'pending' then
    raise exception 'FEL_FINALIZE_STALE: intento ya finalizado.'
      using errcode = 'P0001';
  end if;

  v_safe_message := public.fel_sanitize_public_error(p_error_message);

  if p_outcome = 'success' then
    -- Serialize with create_pos_split_payment: the only POS payment writer locks this row first.
    perform 1
    from public.pos_orders o
    where o.id = v_doc.order_id
    for update;

    v_reconciliation := public.fel_order_payment_reconciliation(v_doc.order_id);

    if coalesce(v_reconciliation ->> 'order_status', '') <> 'paid'
       or not coalesce((v_reconciliation ->> 'is_fully_paid')::boolean, false) then
      raise exception 'FEL_ORDER_NOT_PAID_AT_FINALIZE: la orden dejo de estar completamente pagada.'
        using errcode = 'P0001';
    end if;

    if public.fel_round_money((v_reconciliation ->> 'amount_paid')::numeric)
         <> public.fel_round_money((v_reconciliation ->> 'order_total')::numeric) then
      raise exception 'FEL_PAYMENT_MISMATCH_AT_FINALIZE: pago y total ya no coinciden.'
        using errcode = 'P0001';
    end if;

    if public.fel_round_money((v_reconciliation ->> 'balance_due')::numeric) <> 0 then
      raise exception 'FEL_BALANCE_DUE_AT_FINALIZE: el saldo debe ser cero.'
        using errcode = 'P0001';
    end if;

    if nullif(trim(coalesce(p_fel_uuid, '')), '') is null
       or nullif(trim(coalesce(p_sat_authorization, '')), '') is null then
      raise exception 'FEL_INVALID_INPUT: fel_uuid y sat_authorization requeridos en exito.'
        using errcode = 'P0001';
    end if;

    update public.pos_fel_attempts a
    set
      outcome = 'success',
      finished_at = v_now,
      http_status = p_http_status,
      error_code = null,
      error_message = null,
      request_payload = v_request_payload,
      response_payload = v_safe_payload
    where a.id = p_attempt_id
      and a.fel_document_id = p_document_id
      and a.outcome = 'pending';

    get diagnostics v_attempt_updated = row_count;

    update public.pos_fel_documents d
    set
      status = 'certified',
      fel_uuid = nullif(trim(p_fel_uuid), ''),
      sat_authorization = nullif(trim(p_sat_authorization), ''),
      sat_series = nullif(trim(coalesce(p_sat_series, '')), ''),
      sat_document_number = nullif(trim(coalesce(p_sat_document_number, '')), ''),
      certified_at = coalesce(p_certified_at, v_now),
      last_error = null,
      request_payload = v_request_payload,
      response_payload = v_safe_payload,
      updated_at = v_now
    where d.id = p_document_id
      and d.status = 'processing';

    get diagnostics v_doc_updated = row_count;

    v_new_status := 'certified';
  else
    update public.pos_fel_attempts a
    set
      outcome = 'failed',
      finished_at = v_now,
      http_status = p_http_status,
      error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      error_message = v_safe_message,
      request_payload = v_request_payload,
      response_payload = v_safe_payload
    where a.id = p_attempt_id
      and a.fel_document_id = p_document_id
      and a.outcome = 'pending';

    get diagnostics v_attempt_updated = row_count;

    update public.pos_fel_documents d
    set
      status = 'failed',
      last_error = v_safe_message,
      retry_count = d.retry_count + 1,
      request_payload = v_request_payload,
      response_payload = v_safe_payload,
      updated_at = v_now
    where d.id = p_document_id
      and d.status = 'processing';

    get diagnostics v_doc_updated = row_count;

    v_new_status := 'failed';
  end if;

  if v_attempt_updated <> 1 or v_doc_updated <> 1 then
    raise exception 'FEL_FINALIZE_RACE: no se actualizaron filas esperadas.'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'document_id', p_document_id,
    'attempt_id', p_attempt_id,
    'status', v_new_status,
    'outcome', p_outcome
  );
end;
$$;

comment on function public.fel_finalize_pos_fel_certification_attempt(
  uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
) is
  'Atomically finalizes pending attempt and processing document. '
  'Prevents stale workers and certified overwrite. Revalidates Stage and payment on success. '
  'Validates request payload recursively and stores only safe response payload.';

-- 5. Edge repository reads documents directly; attempts mutate only through SECURITY DEFINER RPCs.
revoke all on table public.pos_fel_documents, public.pos_fel_attempts from service_role;
grant select on table public.pos_fel_documents to service_role;

revoke all on table public.pos_fel_documents, public.pos_fel_attempts from anon, authenticated;

revoke all on function
  public.fel_claim_pos_fel_certification_attempt(uuid, uuid),
  public.fel_finalize_pos_fel_certification_attempt(
    uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
  )
from public, anon, authenticated;

grant execute on function
  public.fel_claim_pos_fel_certification_attempt(uuid, uuid),
  public.fel_finalize_pos_fel_certification_attempt(
    uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
  )
to service_role;

-- 6. Edge reconciliation RPC: service_role-only EXECUTE (190000 revokes client roles only).
revoke all on function public.fel_order_payment_reconciliation(uuid)
from public, anon, authenticated;

grant execute on function public.fel_order_payment_reconciliation(uuid)
to service_role;

-- Cross-order audit: get_pos_fel_document_status accepts order_id, not document_id.
-- Its existing canonical gate admits active cash/management/finance roles; mesero is not admitted.
-- No new waiter rule is introduced because no cross-order document-id path exists.
-- A processing document remains fail-closed and requires manual reconciliation.
-- Automatic retry/recovery and real PostgreSQL concurrency remain pending before real emission.
