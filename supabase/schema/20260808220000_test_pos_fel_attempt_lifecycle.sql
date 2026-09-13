-- Structural / security / helper-behavior tests for 20260808220000_pos_fel_attempt_lifecycle.sql
-- Safe payload helper scenarios run without fixtures (no pos_fel_documents rows required).
-- Entire file: BEGIN … ROLLBACK (no COMMIT).

begin;

create or replace function public.test_pos_fel_attempt_lifecycle_20260808220000()
returns table (
  scenario text,
  passed boolean,
  executed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_claim_sig text;
  v_finalize_sig text;
  v_safe_sig text;
  v_result jsonb;
begin
  if to_regprocedure('public.fel_claim_pos_fel_certification_attempt(uuid,uuid)') is null then
    return query select 'migration_not_applied'::text, false, true,
      'Apply 20260808220000_pos_fel_attempt_lifecycle.sql before running this file'::text;
    return;
  end if;

  -- RPC signatures
  return query select 'static_claim_rpc_signature'::text,
    to_regprocedure('public.fel_claim_pos_fel_certification_attempt(uuid,uuid)') is not null,
    true, 'fel_claim_pos_fel_certification_attempt(uuid, uuid)'::text;

  return query select 'static_finalize_rpc_signature'::text,
    to_regprocedure(
      'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)'
    ) is not null,
    true,
    'fel_finalize_pos_fel_certification_attempt(uuid, uuid, text, ... jsonb, jsonb)'::text;

  return query select 'static_actor_helper_signature'::text,
    to_regprocedure('public.fel_actor_can_request_certification(uuid)') is not null,
    true, 'fel_actor_can_request_certification(uuid)'::text;

  return query select 'static_safe_payload_validator_signature'::text,
    to_regprocedure('public.fel_validate_safe_response_payload(jsonb)') is not null,
    true, 'fel_validate_safe_response_payload(jsonb)'::text;

  -- Grants: service_role only (claim/finalize)
  return query select 'static_claim_execute_service_role'::text,
    has_function_privilege('service_role', 'public.fel_claim_pos_fel_certification_attempt(uuid,uuid)', 'EXECUTE'),
    true, 'claim RPC EXECUTE granted to service_role'::text;

  return query select 'static_finalize_execute_service_role'::text,
    has_function_privilege(
      'service_role',
      'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)',
      'EXECUTE'
    ),
    true, 'finalize RPC EXECUTE granted to service_role'::text;

  return query select 'static_claim_no_anon_execute'::text,
    not has_function_privilege('anon', 'public.fel_claim_pos_fel_certification_attempt(uuid,uuid)', 'EXECUTE'),
    true, 'claim RPC not executable by anon'::text;

  return query select 'static_claim_no_authenticated_execute'::text,
    not has_function_privilege(
      'authenticated',
      'public.fel_claim_pos_fel_certification_attempt(uuid,uuid)',
      'EXECUTE'
    ),
    true, 'claim RPC not executable by authenticated'::text;

  return query select 'static_finalize_no_anon_execute'::text,
    not has_function_privilege(
      'anon',
      'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)',
      'EXECUTE'
    ),
    true, 'finalize RPC not executable by anon'::text;

  return query select 'static_finalize_no_authenticated_execute'::text,
    not has_function_privilege(
      'authenticated',
      'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)',
      'EXECUTE'
    ),
    true, 'finalize RPC not executable by authenticated'::text;

  return query select 'static_actor_no_public_execute'::text,
    not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          p.proacl,
          pg_catalog.acldefault('f', p.proowner)
        )
      ) acl
      where p.oid =
        'public.fel_actor_can_request_certification(uuid)'::regprocedure
        and acl.grantee = 0
        and lower(acl.privilege_type) = 'execute'
    ),
    true, 'actor helper not executable by PUBLIC pseudo-role'::text;

  return query select 'static_actor_no_anon_execute'::text,
    not has_function_privilege('anon', 'public.fel_actor_can_request_certification(uuid)', 'EXECUTE'),
    true, 'actor helper not executable by anon'::text;

  return query select 'static_actor_no_authenticated_execute'::text,
    not has_function_privilege('authenticated', 'public.fel_actor_can_request_certification(uuid)', 'EXECUTE'),
    true, 'actor helper not executable by authenticated'::text;

  -- SECURITY DEFINER + search_path
  select pg_get_functiondef('public.fel_claim_pos_fel_certification_attempt(uuid,uuid)'::regprocedure)
    into v_claim_sig;
  return query select 'static_claim_security_definer'::text,
    exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid =
        'public.fel_claim_pos_fel_certification_attempt(uuid,uuid)'::regprocedure
        and p.prosecdef
        and p.proconfig @> array['search_path=""']::text[]
    ),
    true, 'claim uses SECURITY DEFINER and empty search_path'::text;

  return query select 'static_claim_emission_config_gate'::text,
    v_claim_sig ilike '%fel_emission_config%'
      and v_claim_sig ilike '%emission_enabled%'
      and v_claim_sig ilike '%formal_contingency_enabled%'
      and v_claim_sig ilike '%FEL_EMISSION_DISABLED%'
      and v_claim_sig ilike '%FEL_ENVIRONMENT_NOT_STAGE%',
    true, 'claim validates fel_emission_config singleton after advisory lock'::text;

  select pg_get_functiondef(
    'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)'::regprocedure
  ) into v_finalize_sig;
  return query select 'static_finalize_security_definer'::text,
    exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid =
        'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)'::regprocedure
        and p.prosecdef
        and p.proconfig @> array['search_path=""']::text[]
    ),
    true, 'finalize uses SECURITY DEFINER and empty search_path'::text;

  return query select 'static_finalize_validates_safe_payload'::text,
    v_finalize_sig ilike '%fel_validate_safe_response_payload%',
    true, 'finalize calls fel_validate_safe_response_payload before persisting'::text;

  select pg_get_functiondef('public.fel_validate_safe_response_payload(jsonb)'::regprocedure)
    into v_safe_sig;
  return query select 'static_safe_payload_rejects_forbidden_keys'::text,
    v_safe_sig ilike '%invoice_xml%'
      and v_safe_sig ilike '%FEL_SAFE_PAYLOAD_INVALID%'
      and v_safe_sig ilike '%safe_code%'
      and v_safe_sig ilike '%safe_message%',
    true, 'safe payload validator rejects forbidden keys and enforces limits'::text;

  return query select 'static_safe_payload_http_status_null_or_range'::text,
    v_safe_sig ilike '%http_status%'
      and v_safe_sig ilike '%null%'
      and v_safe_sig ilike '%100%'
      and v_safe_sig ilike '%599%',
    true, 'safe payload validator accepts http_status null and validates HTTP range'::text;

  -- Safe payload helper — executed without fixture data
  begin
    v_result := public.fel_validate_safe_response_payload('{"http_status": null}'::jsonb);
    return query select 'behavior_safe_payload_http_status_null'::text,
      v_result = '{"http_status": null}'::jsonb,
      true, 'http_status=null accepted'::text;
  exception when others then
    return query select 'behavior_safe_payload_http_status_null'::text, false, true, SQLERRM;
  end;

  begin
    v_result := public.fel_validate_safe_response_payload('{"http_status": 400}'::jsonb);
    return query select 'behavior_safe_payload_http_status_400'::text,
      v_result = '{"http_status": 400}'::jsonb,
      true, 'http_status=400 accepted'::text;
  exception when others then
    return query select 'behavior_safe_payload_http_status_400'::text, false, true, SQLERRM;
  end;

  begin
    perform public.fel_validate_safe_response_payload('{"api_key": "hidden"}'::jsonb);
    return query select 'behavior_safe_payload_forbidden_key_rejected'::text,
      false, true, 'expected FEL_SAFE_PAYLOAD_INVALID for forbidden key'::text;
  exception
    when sqlstate 'P0001' then
      return query select 'behavior_safe_payload_forbidden_key_rejected'::text,
        SQLERRM ilike '%FEL_SAFE_PAYLOAD_INVALID%' and SQLERRM ilike '%prohibida%',
        true, SQLERRM;
    when others then
      return query select 'behavior_safe_payload_forbidden_key_rejected'::text, false, true, SQLERRM;
  end;

  begin
    perform public.fel_validate_safe_response_payload('{"unexpected": true}'::jsonb);
    return query select 'behavior_safe_payload_unknown_key_rejected'::text,
      false, true, 'expected FEL_SAFE_PAYLOAD_INVALID for unknown key'::text;
  exception
    when sqlstate 'P0001' then
      return query select 'behavior_safe_payload_unknown_key_rejected'::text,
        SQLERRM ilike '%FEL_SAFE_PAYLOAD_INVALID%' and SQLERRM ilike '%no autorizada%',
        true, SQLERRM;
    when others then
      return query select 'behavior_safe_payload_unknown_key_rejected'::text, false, true, SQLERRM;
  end;

  begin
    perform public.fel_validate_safe_response_payload(
      jsonb_build_object('safe_code', repeat('x', 65))
    );
    return query select 'behavior_safe_payload_safe_code_too_long'::text,
      false, true, 'expected FEL_SAFE_PAYLOAD_INVALID for safe_code > 64'::text;
  exception
    when sqlstate 'P0001' then
      return query select 'behavior_safe_payload_safe_code_too_long'::text,
        SQLERRM ilike '%FEL_SAFE_PAYLOAD_INVALID%' and SQLERRM ilike '%64%',
        true, SQLERRM;
    when others then
      return query select 'behavior_safe_payload_safe_code_too_long'::text, false, true, SQLERRM;
  end;

  begin
    perform public.fel_validate_safe_response_payload(
      jsonb_build_object('safe_message', repeat('m', 241))
    );
    return query select 'behavior_safe_payload_safe_message_too_long'::text,
      false, true, 'expected FEL_SAFE_PAYLOAD_INVALID for safe_message > 240'::text;
  exception
    when sqlstate 'P0001' then
      return query select 'behavior_safe_payload_safe_message_too_long'::text,
        SQLERRM ilike '%FEL_SAFE_PAYLOAD_INVALID%' and SQLERRM ilike '%240%',
        true, SQLERRM;
    when others then
      return query select 'behavior_safe_payload_safe_message_too_long'::text, false, true, SQLERRM;
  end;

  -- Behavioral expectations — NOT EXECUTED without Stage fixtures/runbook
  return query select 'concept_claim_allowed_statuses'::text, false, false,
    'NOT EXECUTED: claim accepts pending_certification|failed only; sets processing + pending attempt'::text;

  return query select 'concept_finalize_success_status'::text, false, false,
    'NOT EXECUTED: finalize success marks attempt success + document certified with SAT identifiers'::text;

  return query select 'concept_finalize_failure_retry'::text, false, false,
    'NOT EXECUTED: finalize failed marks attempt failed + document failed + retry_count + 1'::text;

  return query select 'concept_certified_not_overwritable'::text, false, false,
    'NOT EXECUTED: finalize raises when document already certified'::text;

  return query select 'concept_stale_attempt_rejected'::text, false, false,
    'NOT EXECUTED: finalize rejects non-pending attempt (stale worker protection)'::text;

  return query select 'concept_attempt_belongs_to_document'::text, false, false,
    'NOT EXECUTED: finalize rejects attempt_id not linked to document_id'::text;

  return query select 'concept_single_attempt_numbering'::text, false, false,
    'NOT EXECUTED: attempt_number computed under lock as max+1 per document'::text;

  return query select 'concept_order_payment_intact'::text, false, false,
    'NOT EXECUTED: claim validates fel_order_payment_reconciliation; no order/payment mutation'::text;

  return query select 'concept_postgres_concurrency'::text, false, false,
    'NOT EXECUTED: real PostgreSQL concurrent claim requires Stage runbook with two sessions'::text;
end;
$$;

-- Review-only runner (no COMMIT)
select * from public.test_pos_fel_attempt_lifecycle_20260808220000();

rollback;
