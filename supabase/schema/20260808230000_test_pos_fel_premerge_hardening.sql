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
  v_alias jsonb;
begin
  return query select 'source_baseline_guard_before_first_ddl'::text, false, false,
    'NOT EXECUTED: source artifact invariant is executed by scripts/validate-felplex-migration-safety.mjs'::text;

  return query select 'source_role_seed_do_nothing_no_do_update'::text, false, false,
    'NOT EXECUTED: source artifact invariant is executed by scripts/validate-felplex-migration-safety.mjs'::text;

  return query select 'source_trigger_migration_checks_enabled_when_args'::text, false, false,
    'NOT EXECUTED: source artifact invariant is executed by scripts/validate-felplex-migration-safety.mjs'::text;

  return query select 'static_hardening_requires_emission_disabled'::text,
    (
      select coalesce(
        (
          select count(*) = 0
          from public.fel_emission_config c
          where c.id = 1
            and c.emission_enabled is distinct from false
        ),
        true
      )
    ),
    true,
    '230000 aborts unless id=1 emission_enabled is exactly false; source guard verified by local validator'::text;

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
    pg_catalog.to_regprocedure('public.fel_validate_request_payload(jsonb)') is not null
      and pg_catalog.to_regprocedure('public.fel_payload_key_is_forbidden(text)') is not null
      and pg_catalog.to_regprocedure('public.fel_validate_request_payload_node(jsonb)') is not null,
    true,
    'payload validator helpers exist'::text;

  return query select 'payload_helpers_revoked_from_clients'::text,
    not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
        as a
      where p.oid in (
        'public.fel_payload_key_is_forbidden(text)'::regprocedure,
        'public.fel_validate_request_payload_node(jsonb)'::regprocedure,
        'public.fel_validate_request_payload(jsonb)'::regprocedure
      )
        and lower(a.privilege_type) = 'execute'
        and (
          a.grantee = 0
          or exists (
            select 1
            from pg_catalog.pg_roles r
            where r.oid = a.grantee
              and r.rolname in ('anon', 'authenticated', 'service_role')
          )
        )
    ),
    true,
    'payload helper EXECUTE is not granted to client or service roles'::text;

  begin
    v_value := public.fel_validate_request_payload('{"type":"FACT","currency":"GTQ","external_id":"M-FEL-1"}'::jsonb);
    return query select 'request_payload_contract_keys_accepted'::text,
      v_value = '{"type":"FACT","currency":"GTQ","external_id":"M-FEL-1"}'::jsonb,
      true, 'legitimate FELplex contract keys accepted'::text;
  exception when others then
    return query select 'request_payload_contract_keys_accepted'::text, false, true, sqlerrm;
  end;

  for v_alias in
    select unnest(array[
      '{"X-Authorization":"redacted"}'::jsonb,
      '{"x_authorization":"redacted"}'::jsonb,
      '{"x.authorization":"redacted"}'::jsonb,
      '{"x-api-key":"redacted"}'::jsonb,
      '{"x_api_key":"redacted"}'::jsonb,
      '{"api.key":"redacted"}'::jsonb,
      '{"access-token":"redacted"}'::jsonb,
      '{"access_token":"redacted"}'::jsonb,
      '{"client-secret":"redacted"}'::jsonb,
      '{"service_role_token":"redacted"}'::jsonb,
      '{"items":[{"metadata":{"nested":{"api_key":"redacted"}}}]}'::jsonb,
      jsonb_build_array(jsonb_build_object('x-api-key', 'redacted'))
    ])
  loop
    begin
      perform public.fel_validate_request_payload(v_alias);
      return query select ('request_payload_alias_rejected_' || md5(v_alias::text))::text,
        false, true, 'expected FEL_REQUEST_PAYLOAD_INVALID for alias payload'::text;
    exception when sqlstate 'P0001' then
      return query select ('request_payload_alias_rejected_' || md5(v_alias::text))::text,
        sqlerrm ilike 'FEL_REQUEST_PAYLOAD_INVALID:%', true,
        'alias payload rejected'::text;
    end;
  end loop;

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

  return query select 'finalize_locks_pos_orders_before_reconcile'::text,
    v_finalize_def ilike '%from public.pos_orders%'
      and v_finalize_def ilike '%for update%'
      and position(lower('for update') in lower(v_finalize_def)) > 0
      and position(lower('for update') in lower(v_finalize_def))
        < position(lower('fel_order_payment_reconciliation(v_doc.order_id)') in lower(v_finalize_def)),
    true,
    'success path locks pos_orders before payment reconciliation'::text;

  return query select 'reconciliation_execute_service_role'::text,
    has_function_privilege(
      'service_role',
      'public.fel_order_payment_reconciliation(uuid)',
      'EXECUTE'
    ),
    true,
    'service_role may execute fel_order_payment_reconciliation'::text;

  return query select 'reconciliation_public_execute_denied'::text,
    not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
        as a
      where p.oid = 'public.fel_order_payment_reconciliation(uuid)'::regprocedure
        and a.grantee = 0
        and lower(a.privilege_type) = 'execute'
    ),
    true,
    'PUBLIC has no EXECUTE on fel_order_payment_reconciliation'::text;

  return query select 'reconciliation_anon_execute_denied'::text,
    not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
        as a
      join pg_catalog.pg_roles r on r.oid = a.grantee
      where p.oid = 'public.fel_order_payment_reconciliation(uuid)'::regprocedure
        and r.rolname = 'anon'
        and a.privilege_type = 'EXECUTE'
    ),
    true,
    'anon has no EXECUTE on fel_order_payment_reconciliation'::text;

  return query select 'reconciliation_authenticated_execute_denied'::text,
    not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
        as a
      join pg_catalog.pg_roles r on r.oid = a.grantee
      where p.oid = 'public.fel_order_payment_reconciliation(uuid)'::regprocedure
        and r.rolname = 'authenticated'
        and a.privilege_type = 'EXECUTE'
    ),
    true,
    'authenticated has no EXECUTE on fel_order_payment_reconciliation'::text;

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
