-- FELplex Phase 1A.2 — transactional claim/finalize RPCs for certification attempts.
-- Apply after 20260808190000_pos_fel_documents.sql.
--
-- Constraints:
--   * service_role EXECUTE only (Edge uses service_role + validated actor_id)
--   * no HTTP, no FELplex calls
--   * advisory lock + row locks for atomic claim/finalize
--   * Stage environment + paid order reconciliation enforced in claim

-- ---------------------------------------------------------------------------
-- 1. Actor authorization helper (explicit actor_id — mirrors is_cash_operator)
-- ---------------------------------------------------------------------------

create or replace function public.fel_actor_can_request_certification(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_actor_id
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'supervisor', 'cajero', 'caja'
      )
  );
$$;

comment on function public.fel_actor_can_request_certification(uuid) is
  'Explicit-actor equivalent of fel_can_request_fel_certification / is_cash_operator. '
  'Used by Edge claim RPC; not callable by frontend roles.';

revoke all on function public.fel_actor_can_request_certification(uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Safe response payload validator (internal helper)
-- ---------------------------------------------------------------------------

create or replace function public.fel_validate_safe_response_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_allowed constant text[] := array[
    'http_status', 'error_kind', 'provider_valid', 'safe_code', 'safe_message'
  ];
  v_forbidden constant text[] := array[
    'invoice_xml', 'invoice_url', 'errors', 'uuid', 'sat', 'headers', 'authorization', 'api_key'
  ];
begin
  if p_payload is null then
    return null;
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: payload debe ser objeto jsonb o null.'
      using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_payload)
  loop
    if v_key = any(v_forbidden) then
      raise exception 'FEL_SAFE_PAYLOAD_INVALID: clave prohibida %.', v_key
        using errcode = 'P0001';
    end if;
    if not (v_key = any(v_allowed)) then
      raise exception 'FEL_SAFE_PAYLOAD_INVALID: clave no autorizada %.', v_key
        using errcode = 'P0001';
    end if;
  end loop;

  if p_payload ? 'http_status' then
    if jsonb_typeof(p_payload -> 'http_status') not in ('number', 'null') then
      raise exception 'FEL_SAFE_PAYLOAD_INVALID: http_status debe ser numerico o null.'
        using errcode = 'P0001';
    end if;

    if jsonb_typeof(p_payload -> 'http_status') = 'number'
       and (
         (p_payload ->> 'http_status')::numeric < 100
         or (p_payload ->> 'http_status')::numeric > 599
         or (p_payload ->> 'http_status')::numeric <> trunc((p_payload ->> 'http_status')::numeric)
       ) then
      raise exception 'FEL_SAFE_PAYLOAD_INVALID: http_status fuera de rango HTTP (100-599).'
        using errcode = 'P0001';
    end if;
  end if;

  if p_payload ? 'provider_valid'
     and jsonb_typeof(p_payload -> 'provider_valid') not in ('boolean', 'null') then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: provider_valid debe ser booleano o null.'
      using errcode = 'P0001';
  end if;

  if p_payload ? 'error_kind'
     and jsonb_typeof(p_payload -> 'error_kind') not in ('string', 'null') then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: error_kind debe ser texto o null.'
      using errcode = 'P0001';
  end if;

  if p_payload ? 'safe_code'
     and jsonb_typeof(p_payload -> 'safe_code') not in ('string', 'null') then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: safe_code debe ser texto o null.'
      using errcode = 'P0001';
  end if;

  if p_payload ? 'safe_message'
     and jsonb_typeof(p_payload -> 'safe_message') not in ('string', 'null') then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: safe_message debe ser texto o null.'
      using errcode = 'P0001';
  end if;

  if p_payload ? 'safe_code'
     and char_length(coalesce(p_payload ->> 'safe_code', '')) > 64 then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: safe_code excede 64 caracteres.'
      using errcode = 'P0001';
  end if;

  if p_payload ? 'safe_message'
     and char_length(coalesce(p_payload ->> 'safe_message', '')) > 240 then
    raise exception 'FEL_SAFE_PAYLOAD_INVALID: safe_message excede 240 caracteres.'
      using errcode = 'P0001';
  end if;

  return p_payload;
end;
$$;

revoke all on function public.fel_validate_safe_response_payload(jsonb)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Claim certification attempt (atomic)
-- ---------------------------------------------------------------------------

create or replace function public.fel_claim_pos_fel_certification_attempt(
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.pos_fel_documents;
  v_emission public.fel_emission_config;
  v_reconciliation jsonb;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_now timestamptz := now();
  v_updated integer;
begin
  if p_document_id is null then
    raise exception 'FEL_INVALID_INPUT: document_id requerido.'
      using errcode = 'P0001';
  end if;

  if p_actor_id is null then
    raise exception 'FEL_UNAUTHORIZED: actor requerido.'
      using errcode = 'P0001';
  end if;

  if not public.fel_actor_can_request_certification(p_actor_id) then
    raise exception 'FEL_UNAUTHORIZED: actor no autorizado.'
      using errcode = 'P0001';
  end if;

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
    raise exception 'FEL_PRODUCTION_BLOCKED'
      using errcode = 'P0001';
  end if;

  if v_doc.status = 'processing' then
    raise exception 'FEL_ALREADY_PROCESSING'
      using errcode = 'P0001';
  end if;

  if v_doc.status = 'certified' then
    raise exception 'FEL_ALREADY_CERTIFIED'
      using errcode = 'P0001';
  end if;

  if v_doc.status not in ('pending_certification', 'failed') then
    raise exception 'FEL_DOCUMENT_NOT_CERTIFIABLE'
      using errcode = 'P0001';
  end if;

  v_reconciliation := public.fel_order_payment_reconciliation(v_doc.order_id);

  if coalesce(v_reconciliation ->> 'order_status', '') <> 'paid' then
    raise exception 'FEL_ORDER_NOT_PAID'
      using errcode = 'P0001';
  end if;

  if not coalesce((v_reconciliation ->> 'is_fully_paid')::boolean, false) then
    raise exception 'FEL_ORDER_NOT_PAID'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'balance_due')::numeric) > 0 then
    raise exception 'FEL_BALANCE_DUE'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'amount_paid')::numeric)
     <> public.fel_round_money((v_reconciliation ->> 'order_total')::numeric) then
    raise exception 'FEL_PAYMENT_MISMATCH'
      using errcode = 'P0001';
  end if;

  select c.* into v_emission
  from public.fel_emission_config c
  where c.id = 1;

  if v_emission.id is null then
    raise exception 'FEL_EMISSION_DISABLED: Configuracion FEL ausente. FEL deshabilitado.'
      using errcode = 'P0001';
  end if;

  if v_emission.environment <> 'stage' then
    raise exception 'FEL_ENVIRONMENT_NOT_STAGE: Ambiente FEL distinto de stage.'
      using errcode = 'P0001';
  end if;

  if not v_emission.emission_enabled then
    raise exception 'FEL_EMISSION_DISABLED: La emision FEL esta deshabilitada.'
      using errcode = 'P0001';
  end if;

  if v_emission.formal_contingency_enabled then
    raise exception 'FEL_CONTINGENCY_NOT_SUPPORTED: Contingencia formal no habilitada en esta version.'
      using errcode = 'P0001';
  end if;

  select coalesce(max(a.attempt_number), 0) + 1 into v_attempt_number
  from public.pos_fel_attempts a
  where a.fel_document_id = p_document_id;

  insert into public.pos_fel_attempts (
    fel_document_id,
    attempt_number,
    outcome,
    started_at
  ) values (
    p_document_id,
    v_attempt_number,
    'pending',
    v_now
  )
  returning id into v_attempt_id;

  update public.pos_fel_documents d
  set
    status = 'processing',
    last_attempt_at = v_now,
    updated_at = v_now
  where d.id = p_document_id
    and d.status in ('pending_certification', 'failed');

  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'FEL_CLAIM_RACE: no se pudo actualizar el documento durante claim.'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'document_id', p_document_id,
    'attempt_id', v_attempt_id,
    'attempt_number', v_attempt_number,
    'status', 'processing'
  );
end;
$$;

comment on function public.fel_claim_pos_fel_certification_attempt(uuid, uuid) is
  'Atomically validates actor, locks document, inserts pending attempt, sets processing. '
  'No HTTP. service_role only.';

-- ---------------------------------------------------------------------------
-- 3. Finalize certification attempt (atomic)
-- ---------------------------------------------------------------------------

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

  perform pg_advisory_xact_lock(hashtext('pos_fel_certify:' || p_document_id::text));

  select d.* into v_doc
  from public.pos_fel_documents d
  where d.id = p_document_id
  for update;

  if v_doc.id is null then
    raise exception 'FEL_DOCUMENT_NOT_FOUND'
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
      request_payload = p_request_payload,
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
      request_payload = p_request_payload,
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
      request_payload = p_request_payload,
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
      request_payload = p_request_payload,
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
  'Prevents stale workers and certified overwrite. Stores only safe response payload.';

-- ---------------------------------------------------------------------------
-- 4. Privileges — service_role only
-- ---------------------------------------------------------------------------

revoke all on function
  public.fel_claim_pos_fel_certification_attempt(uuid, uuid),
  public.fel_finalize_pos_fel_certification_attempt(
    uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
  )
from public, anon, authenticated;

grant execute on function
  public.fel_claim_pos_fel_certification_attempt(uuid, uuid)
to service_role;

grant execute on function
  public.fel_finalize_pos_fel_certification_attempt(
    uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
  )
to service_role;
