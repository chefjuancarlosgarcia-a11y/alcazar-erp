-- Structural and helper-behavior tests for 20260808230000.
-- Source-file-only checks are honestly delegated to the local safety validator.
-- Entire file is transactional and never commits.

begin;

create or replace function public.test_pos_fel_premerge_hardening_20260808230000()
returns table (
  scenario text,
  passed boolean,
  executed boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_def text;
  v_finalize_def text;
  v_value jsonb;
begin
  return query select 'source_baseline_guard_before_first_ddl'::text, false, false,
    'NOT EXECUTED: source artifact invariant is executed by scripts/validate-felplex-migration-safety.mjs'::text;

  return query select 'source_role_seed_do_nothing_no_do_update'::text, false, false,
    'NOT EXECUTED: source artifact invariant is executed by scripts/validate-felplex-migration-safety.mjs'::text;

  return query select 'source_trigger_migration_checks_enabled_when_args'::text, false, false,
    'NOT EXECUTED: source artifact invariant is executed by scripts/validate-felplex-migration-safety.mjs'::text;

  return query
  select 'trigger_auth_users_is_canonical'::text,
    exists (
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace rn on rn.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = t.tgfoid
      join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
      where rn.nspname = 'auth'
        and c.relname = 'users'
        and t.tgname = 'on_auth_user_created'
        and pn.nspname = 'public'
        and p.proname = 'handle_new_user'
        and p.pronargs = 0
        and t.tgtype = 5
        and t.tgenabled = 'O'
        and t.tgqual is null
        and t.tgnargs = 0
        and octet_length(t.tgargs) = 0
        and t.tgconstraint = 0
        and not t.tgisinternal
    ),
    true,
    'auth.users trigger is exactly enabled AFTER INSERT FOR EACH ROW without WHEN/args/constraint'::text;

  return query
  select 'config_environment_stage_only'::text,
    exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.fel_emission_config'::regclass
        and c.conname = 'fel_emission_config_environment_stage_check'
        and pg_catalog.pg_get_constraintdef(c.oid) ilike '%environment%stage%'
    ),
    true,
    'fel_emission_config environment constraint is Stage-only'::text;

  return query
  select 'config_defaults_fail_closed'::text,
    (select column_default ilike '%false%'
       from information_schema.columns
      where table_schema = 'public' and table_name = 'fel_emission_config'
        and column_name = 'emission_enabled')
    and
    (select column_default ilike '%false%'
       from information_schema.columns
      where table_schema = 'public' and table_name = 'fel_emission_config'
        and column_name = 'auto_issue_paid_orders')
    and
    (select column_default ilike '%false%'
       from information_schema.columns
      where table_schema = 'public' and table_name = 'fel_emission_config'
        and column_name = 'formal_contingency_enabled'),
    true,
    'all FEL activation/automatic/contingency defaults are false'::text;

  select pg_catalog.pg_get_functiondef(
    'public.request_pos_fel_certification(uuid,text,text,text,text,numeric)'::regprocedure
  ) into v_request_def;

  return query select 'request_rpc_requires_stage'::text,
    v_request_def ilike '%environment <> ''stage''%'
      and v_request_def ilike '%FEL_ENVIRONMENT_NOT_STAGE%'
      and v_request_def ilike '%order_status%'
      and v_request_def ilike '%is_fully_paid%',
    true,
    'request RPC requires Stage and fully paid reconciliation before idempotent reuse'::text;

  return query select 'request_payload_validator_exists'::text,
    pg_catalog.to_regprocedure('public.fel_validate_request_payload(jsonb)') is not null,
    true,
    'fel_validate_request_payload(jsonb) exists'::text;

  begin
    v_value := public.fel_validate_request_payload(null);
    return query select 'request_payload_null_accepted'::text,
      v_value is null, true, 'NULL accepted'::text;
  exception when others then
    return query select 'request_payload_null_accepted'::text, false, true, sqlerrm;
  end;

  begin
    v_value := public.fel_validate_request_payload('{"invoice":{"type":"FACT"},"items":[]}'::jsonb);
    return query select 'request_payload_small_object_accepted'::text,
      v_value = '{"invoice":{"type":"FACT"},"items":[]}'::jsonb,
      true, 'small object without sensitive keys accepted'::text;
  exception when others then
    return query select 'request_payload_small_object_accepted'::text, false, true, sqlerrm;
  end;

  begin
    perform public.fel_validate_request_payload('{"Authorization":"redacted"}'::jsonb);
    return query select 'request_payload_top_sensitive_rejected'::text, false, true,
      'expected FEL_REQUEST_PAYLOAD_INVALID'::text;
  exception when sqlstate 'P0001' then
    return query select 'request_payload_top_sensitive_rejected'::text,
      sqlerrm ilike 'FEL_REQUEST_PAYLOAD_INVALID:%', true, sqlerrm;
  end;

  begin
    perform public.fel_validate_request_payload(
      '{"items":[{"metadata":{"ApiKey":"redacted"}}]}'::jsonb
    );
    return query select 'request_payload_nested_sensitive_rejected'::text, false, true,
      'expected FEL_REQUEST_PAYLOAD_INVALID'::text;
  exception when sqlstate 'P0001' then
    return query select 'request_payload_nested_sensitive_rejected'::text,
      sqlerrm ilike 'FEL_REQUEST_PAYLOAD_INVALID:%', true, sqlerrm;
  end;

  begin
    perform public.fel_validate_request_payload(
      jsonb_build_object('data', repeat('x', 32769))
    );
    return query select 'request_payload_oversize_rejected'::text, false, true,
      'expected FEL_REQUEST_PAYLOAD_INVALID'::text;
  exception when sqlstate 'P0001' then
    return query select 'request_payload_oversize_rejected'::text,
      sqlerrm ilike 'FEL_REQUEST_PAYLOAD_INVALID:%', true, sqlerrm;
  end;

  select pg_catalog.pg_get_functiondef(
    'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)'::regprocedure
  ) into v_finalize_def;

  return query select 'finalize_invokes_request_validator'::text,
    v_finalize_def ilike '%fel_validate_request_payload(p_request_payload)%'
      and v_finalize_def ilike '%request_payload = v_request_payload%',
    true,
    'finalize validates before persistence'::text;

  return query select 'finalize_revalidates_payment_on_success'::text,
    v_finalize_def ilike '%FEL_ORDER_NOT_PAID_AT_FINALIZE%'
      and v_finalize_def ilike '%FEL_PAYMENT_MISMATCH_AT_FINALIZE%'
      and v_finalize_def ilike '%FEL_BALANCE_DUE_AT_FINALIZE%'
      and v_finalize_def ilike '%fel_order_payment_reconciliation(v_doc.order_id)%',
    true,
    'success path rechecks paid status, totals and zero balance'::text;

  return query select 'table_grants_minimal'::text,
    has_table_privilege('service_role', 'public.pos_fel_documents', 'SELECT')
      and not has_table_privilege('service_role', 'public.pos_fel_documents', 'INSERT')
      and not has_table_privilege('service_role', 'public.pos_fel_documents', 'UPDATE')
      and not has_table_privilege('service_role', 'public.pos_fel_documents', 'DELETE')
      and not has_table_privilege('service_role', 'public.pos_fel_documents', 'TRUNCATE')
      and not has_table_privilege('service_role', 'public.pos_fel_documents', 'TRIGGER')
      and not has_table_privilege('service_role', 'public.pos_fel_attempts', 'SELECT')
      and not has_table_privilege('service_role', 'public.pos_fel_attempts', 'INSERT')
      and not has_table_privilege('service_role', 'public.pos_fel_attempts', 'UPDATE')
      and not has_table_privilege('service_role', 'public.pos_fel_attempts', 'DELETE'),
    true,
    'service_role has direct SELECT on documents only; attempts use RPCs'::text;

  return query select 'frontend_roles_no_direct_table_access'::text,
    not has_table_privilege('anon', 'public.pos_fel_documents', 'SELECT')
      and not has_table_privilege('authenticated', 'public.pos_fel_documents', 'SELECT')
      and not has_table_privilege('anon', 'public.pos_fel_attempts', 'SELECT')
      and not has_table_privilege('authenticated', 'public.pos_fel_attempts', 'SELECT'),
    true,
    'anon/authenticated have no direct FEL document or attempt access'::text;

  return query select 'service_role_rpc_access_exact'::text,
    has_function_privilege(
      'service_role',
      'public.fel_claim_pos_fel_certification_attempt(uuid,uuid)',
      'EXECUTE'
    )
      and has_function_privilege(
        'service_role',
        'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.fel_claim_pos_fel_certification_attempt(uuid,uuid)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)',
        'EXECUTE'
      ),
    true,
    'claim/finalize EXECUTE remains service_role-only'::text;

  return query
  select 'rpc_security_definer_empty_search_path'::text,
    bool_and(p.prosecdef and p.proconfig @> array['search_path=""']::text[]),
    true,
    'request and finalize use SECURITY DEFINER with empty search_path'::text
  from pg_catalog.pg_proc p
  where p.oid in (
    'public.request_pos_fel_certification(uuid,text,text,text,text,numeric)'::regprocedure,
    'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)'::regprocedure
  );

  return query select 'source_rollback_correspondence'::text, false, false,
    'NOT EXECUTED: rollback source correspondence is executed by the local safety validator; rollback intentionally aborts rather than weaken security'::text;

  return query select 'concept_finalize_success_with_fixture'::text, false, false,
    'NOT EXECUTED: requires approved Stage fixtures; 230000 has not been applied to Stage'::text;

  return query select 'concept_postgresql_concurrency'::text, false, false,
    'NOT EXECUTED: requires separate approved two-session PostgreSQL runbook'::text;
end;
$$;

select * from public.test_pos_fel_premerge_hardening_20260808230000();

rollback;
