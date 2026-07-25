-- Regression tests for 190_operational_stations_foundation.sql
-- Run AFTER applying 190. Entire file: BEGIN … ROLLBACK (no COMMIT).
-- No auth.users inserts; fixtures use random codes only.

begin;

create or replace function public.test_operational_stations_foundation_190()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public, extensions
as $$
declare
  v_station_id uuid;
  v_station_code text := 'os1-t-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_device1 uuid;
  v_device2 uuid;
  v_enrollment_id uuid;
  v_token_plain text;
  v_token_hash text;
  v_claim_hash text := repeat('a', 64);
  v_bad_hash text := repeat('b', 63);
  v_fp text := 'os1-fp-' || substr(gen_random_uuid()::text, 1, 8);
  v_policies_enrollment int;
  v_fn_def text;
begin
  -- Structure: four tables
  return query
  select 'struct_four_os1_tables'::text,
    (select count(*) = 4 from information_schema.tables
     where table_schema = 'public'
       and table_name in (
         'operational_stations',
         'operational_station_devices',
         'operational_station_enrollment_tokens',
         'operational_station_events'
       )),
    'information_schema count'::text;

  return query
  select 'struct_core_column_types'::text,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'operational_stations' and column_name = 'station_code' and data_type = 'text')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'operational_station_devices' and column_name = 'claim_secret_hash' and data_type = 'text')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'operational_station_enrollment_tokens' and column_name = 'token_hash' and data_type = 'text'),
    'station_code, claim_secret_hash, token_hash'::text;

  return query
  select 'struct_station_status_check'::text,
    exists (
      select 1 from information_schema.check_constraints cc
      join information_schema.constraint_column_usage ccu on cc.constraint_name = ccu.constraint_name
      where ccu.table_name = 'operational_stations' and cc.check_clause like '%draft%'
    ),
    'station lifecycle check'::text;

  return query
  select 'struct_enrollment_includes_authorized'::text,
    exists (
      select 1 from information_schema.check_constraints cc
      join information_schema.constraint_column_usage ccu on cc.constraint_name = ccu.constraint_name
      where ccu.table_name = 'operational_station_enrollment_tokens' and cc.check_clause like '%authorized%'
    ),
    'enrollment status check'::text;

  return query
  select 'struct_device_blocked_replaced'::text,
    exists (
      select 1 from information_schema.check_constraints cc
      join information_schema.constraint_column_usage ccu on cc.constraint_name = ccu.constraint_name
      where ccu.table_name = 'operational_station_devices'
        and cc.check_clause like '%blocked%'
        and cc.check_clause like '%replaced%'
    ),
    'device status check'::text;

  return query
  select 'struct_rls_enabled_all'::text,
    (select bool_and(c.relrowsecurity)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'operational_stations',
         'operational_station_devices',
         'operational_station_enrollment_tokens',
         'operational_station_events'
       )),
    'pg_class relrowsecurity'::text;

  return query
  select 'struct_flag_exists_and_false'::text,
    exists (select 1 from public.app_settings where key = 'operational_stations_enabled')
    and not public.operational_stations_enabled(),
    'app_settings operational_stations_enabled'::text;

  return query
  select 'struct_one_active_device_index'::text,
    exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'operational_station_devices_one_active_per_station_idx'
    ),
    'partial unique index'::text;

  return query
  select 'struct_fk_devices_station_restrict'::text,
    exists (
      select 1
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      where rel.relname = 'operational_station_devices'
        and c.contype = 'f'
        and c.conname like '%station%'
        and c.confdeltype = 'r'
    ),
    'ON DELETE RESTRICT on station_id'::text;

  return query
  select 'struct_fk_enrollment_station_restrict'::text,
    exists (
      select 1
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      where rel.relname = 'operational_station_enrollment_tokens'
        and c.contype = 'f'
        and c.confdeltype = 'r'
    ),
    'enrollment station FK restrict'::text;

  return query
  select 'struct_claim_secret_hash_column'::text,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operational_station_devices'
        and column_name = 'claim_secret_hash'
    ),
    'claim_secret_hash present'::text;

  return query
  select 'struct_no_plaintext_secret_columns'::text,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name in ('operational_station_devices', 'operational_station_enrollment_tokens')
        and column_name in (
          'claim_secret_plain',
          'device_claim_secret',
          'ephemeral_sign_in_secret',
          'enrollment_token',
          'token_plain',
          'pin'
        )
    ),
    'no reversible columns'::text;

  return query
  select 'struct_no_take_store_secret_rpc'::text,
    not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('take_enrollment_sign_in_secret', 'store_enrollment_sign_in_secret')
    ),
    'forbidden RPC absent'::text;

  -- Permissions (PUBLIC via aclexplode grantee OID 0; not has_function_privilege('public', ...))
  return query
  select 'perm_public_no_claim_execute'::text,
    not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'claim_station_enrollment'
        and exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0
            and a.privilege_type = 'EXECUTE'
        )
    ),
    'PUBLIC EXECUTE absent on claim'::text;

  return query
  select 'perm_anon_no_claim_execute'::text,
    not has_function_privilege('anon', 'public.claim_station_enrollment(text,text,text,text,text)', 'EXECUTE'),
    'anon claim denied'::text;

  return query
  select 'perm_anon_no_finalize_execute'::text,
    not has_function_privilege(
      'anon',
      'public.finalize_station_device_enrollment(uuid,uuid,uuid,text,text)',
      'EXECUTE'
    ),
    'anon finalize denied'::text;

  return query
  select 'perm_authenticated_no_claim_execute'::text,
    not has_function_privilege('authenticated', 'public.claim_station_enrollment(text,text,text,text,text)', 'EXECUTE'),
    'authenticated claim denied'::text;

  return query
  select 'perm_service_role_has_claim_execute'::text,
    has_function_privilege('service_role', 'public.claim_station_enrollment(text,text,text,text,text)', 'EXECUTE'),
    'service_role claim allowed'::text;

  return query
  select 'perm_finalize_service_role_only'::text,
    has_function_privilege(
      'service_role',
      'public.finalize_station_device_enrollment(uuid,uuid,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.finalize_station_device_enrollment(uuid,uuid,uuid,text,text)',
      'EXECUTE'
    ),
    'finalize limited to service_role'::text;

  return query
  select 'acl_matrix_all_os1_functions'::text,
    (
      select count(*) = 20
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'operational_stations_enabled', 'is_operational_stations_admin',
          'log_operational_station_event', 'provision_operational_station',
          'update_operational_station', 'create_station_enrollment_token',
          'record_operational_enrollment_secret_attempt',
          'verify_operational_device_claim_secret', 'claim_station_enrollment',
          'authorize_station_device_enrollment', 'reject_and_block_station_device',
          'get_device_enrollment_status', 'finalize_station_device_enrollment',
          'fail_station_device_enrollment', 'revoke_station_device',
          'replace_station_device', 'list_operational_stations_admin',
          'list_operational_station_devices_admin',
          'get_operational_station_device_context', 'touch_operational_station_device_seen'
        )
    )
    and (
      select coalesce(bool_and(checks.ok), false)
      from (
        select
          case f.expected_access
            when 'service_role_only' then
              not f.public_execute and not f.anon_execute and not f.authenticated_execute
              and f.service_role_execute
            when 'internal_only' then
              not f.public_execute and not f.anon_execute and not f.authenticated_execute
              and not f.service_role_execute
            when 'authenticated_device' then
              not f.public_execute and not f.anon_execute and f.authenticated_execute
              and not f.service_role_execute
            when 'authenticated_read' then
              not f.public_execute and not f.anon_execute and f.authenticated_execute
            when 'authenticated_admin' then
              not f.public_execute and not f.anon_execute and f.authenticated_execute
          end as ok
        from (
          select
            p.proname,
            case p.proname
              when 'claim_station_enrollment' then 'service_role_only'
              when 'verify_operational_device_claim_secret' then 'service_role_only'
              when 'record_operational_enrollment_secret_attempt' then 'service_role_only'
              when 'get_device_enrollment_status' then 'service_role_only'
              when 'finalize_station_device_enrollment' then 'service_role_only'
              when 'fail_station_device_enrollment' then 'service_role_only'
              when 'log_operational_station_event' then 'internal_only'
              when 'get_operational_station_device_context' then 'authenticated_device'
              when 'touch_operational_station_device_seen' then 'authenticated_device'
              when 'operational_stations_enabled' then 'authenticated_read'
              else 'authenticated_admin'
            end as expected_access,
            exists (
              select 1
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where a.grantee = 0 and a.privilege_type = 'EXECUTE'
            ) as public_execute,
            has_function_privilege(
              'anon',
              format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::regprocedure,
              'EXECUTE'
            ) as anon_execute,
            has_function_privilege(
              'authenticated',
              format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::regprocedure,
              'EXECUTE'
            ) as authenticated_execute,
            has_function_privilege(
              'service_role',
              format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::regprocedure,
              'EXECUTE'
            ) as service_role_execute
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in (
              'operational_stations_enabled', 'is_operational_stations_admin',
              'log_operational_station_event', 'provision_operational_station',
              'update_operational_station', 'create_station_enrollment_token',
              'record_operational_enrollment_secret_attempt',
              'verify_operational_device_claim_secret', 'claim_station_enrollment',
              'authorize_station_device_enrollment', 'reject_and_block_station_device',
              'get_device_enrollment_status', 'finalize_station_device_enrollment',
              'fail_station_device_enrollment', 'revoke_station_device',
              'replace_station_device', 'list_operational_stations_admin',
              'list_operational_station_devices_admin',
              'get_operational_station_device_context', 'touch_operational_station_device_seen'
            )
        ) f
      ) checks
    ),
    'inventory=20 bool_and ACL rows'::text;

  return query
  select 'perm_claim_security_definer'::text,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'claim_station_enrollment'
        and p.prosecdef
    ),
    'claim_station_enrollment SECURITY DEFINER'::text;

  return query
  select 'perm_claim_search_path_empty'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'claim_station_enrollment'
        and exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) cfg
          where split_part(cfg, '=', 1) = 'search_path'
        )
    ),
    'claim proconfig search_path'::text;

  return query
  select 'perm_policies_admin_stations'::text,
    exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'operational_stations'
        and policyname = 'operational_stations_admin_all'
    ),
    'admin policy on stations'::text;

  return query
  select 'perm_policies_device_self_read'::text,
    exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'operational_station_devices'
        and policyname = 'operational_station_devices_self_read'
    ),
    'self-read policy on devices'::text;

  select count(*) into v_policies_enrollment
  from pg_policies
  where schemaname = 'public' and tablename = 'operational_station_enrollment_tokens';

  return query
  select 'perm_enrollment_tokens_no_direct_select_policy'::text,
    v_policies_enrollment = 0,
    'policy count=' || v_policies_enrollment::text;

  -- Behavioral fixtures (same transaction, rolled back)
  insert into public.operational_stations (station_code, name, station_type, status)
  values (v_station_code, 'OS1 SQL Test', 'pos', 'active')
  returning id into v_station_id;

  return query select 'beh_fixture_station_insert'::text, v_station_id is not null, v_station_code;

  insert into public.operational_station_devices (station_id, status, device_label)
  values (v_station_id, 'active', 'fixture-active-1')
  returning id into v_device1;

  return query select 'beh_one_active_device_ok'::text, v_device1 is not null, 'first active inserted'::text;

  begin
    insert into public.operational_station_devices (station_id, status, device_label)
    values (v_station_id, 'active', 'fixture-active-2');
    return query select 'beh_second_active_same_station_fails'::text, false, 'unique index should block'::text;
  exception
    when unique_violation then
      return query select 'beh_second_active_same_station_fails'::text, true, 'unique_violation raised'::text;
  end;

  insert into public.operational_station_devices (station_id, status, device_label)
  values (v_station_id, 'pending', 'fixture-pending-1')
  returning id into v_device2;

  return query select 'beh_pending_second_device_allowed'::text, v_device2 is not null, 'pending coexists'::text;

  begin
    insert into public.operational_stations (station_code, name, station_type, status)
    values ('os1-bad-st-' || substr(gen_random_uuid()::text, 1, 6), 'Bad', 'pos', 'bogus_status');
    return query select 'beh_invalid_station_status_fails'::text, false, 'check should block'::text;
  exception
    when check_violation then
      return query select 'beh_invalid_station_status_fails'::text, true, 'check_violation'::text;
  end;

  begin
    insert into public.operational_station_devices (station_id, status)
    values (v_station_id, 'not_a_device_status');
    return query select 'beh_invalid_device_status_fails'::text, false, 'check should block'::text;
  exception
    when check_violation then
      return query select 'beh_invalid_device_status_fails'::text, true, 'check_violation'::text;
  end;

  v_token_plain := 'os1-tok-' || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := encode(extensions.digest(v_token_plain, 'sha256'), 'hex');

  insert into public.operational_station_enrollment_tokens (
    station_id, token_hash, status, expires_at, confirmation_code
  )
  values (
    v_station_id, v_token_hash, 'pending', now() + interval '30 minutes', '123456'
  )
  returning id into v_enrollment_id;

  begin
    insert into public.operational_station_enrollment_tokens (
      station_id, token_hash, status, expires_at, confirmation_code
    )
    values (
      v_station_id,
      encode(extensions.digest('x' || gen_random_uuid()::text, 'sha256'), 'hex'),
      'not_valid_enrollment',
      now() + interval '1 hour',
      '654321'
    );
    return query select 'beh_invalid_enrollment_status_fails'::text, false, 'check should block'::text;
  exception
    when check_violation then
      return query select 'beh_invalid_enrollment_status_fails'::text, true, 'check_violation'::text;
  end;

  return query
  select 'struct_claim_plaintext_no_column'::text,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operational_station_devices'
        and column_name in ('claim_secret_plain', 'device_claim_secret')
    ),
    'insert targets hash column only'::text;

  begin
    perform public.verify_operational_device_claim_secret(
      v_device2, v_enrollment_id, v_bad_hash, true
    );
    return query select 'beh_verify_hash_not_64_hex_fails'::text, false, 'should raise'::text;
  exception
    when others then
      return query select 'beh_verify_hash_not_64_hex_fails'::text, true, SQLERRM::text;
  end;

  update public.operational_station_devices
  set enrollment_id = v_enrollment_id,
      claim_secret_hash = v_claim_hash,
      claim_secret_expires_at = now() + interval '1 hour'
  where id = v_device2;

  begin
    perform public.verify_operational_device_claim_secret(
      v_device2, v_enrollment_id, repeat('c', 64), true
    );
    return query select 'beh_verify_wrong_hash_fails'::text, false, 'should raise'::text;
  exception
    when others then
      return query select 'beh_verify_wrong_hash_fails'::text, true, 'mismatch rejected'::text;
  end;

  update public.operational_station_devices
  set claim_secret_consumed_at = now()
  where id = v_device2;

  begin
    perform public.verify_operational_device_claim_secret(
      v_device2, v_enrollment_id, v_claim_hash, true
    );
    return query select 'beh_consumed_secret_replay_fails'::text, false, 'consumed should block'::text;
  exception
    when others then
      return query select 'beh_consumed_secret_replay_fails'::text, true, 'replay blocked'::text;
  end;

  update public.operational_station_enrollment_tokens
  set expires_at = now() - interval '1 hour', status = 'pending'
  where id = v_enrollment_id;

  begin
    perform public.claim_station_enrollment(
      v_token_plain,
      v_claim_hash,
      v_fp,
      'os1-test-ua',
      'idem-' || gen_random_uuid()::text
    );
    return query select 'beh_expired_enrollment_claim_fails'::text, false, 'claim should reject'::text;
  exception
    when others then
      return query select 'beh_expired_enrollment_claim_fails'::text, true, 'expired not claimable'::text;
  end;

  insert into public.operational_station_devices (
    station_id, status, client_fingerprint, enrollment_id
  )
  values (v_station_id, 'blocked', v_fp, null);

  update public.operational_station_enrollment_tokens
  set expires_at = now() + interval '1 hour', status = 'pending'
  where id = v_enrollment_id;

  v_token_plain := 'os1-tok2-' || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := encode(extensions.digest(v_token_plain, 'sha256'), 'hex');
  update public.operational_station_enrollment_tokens
  set token_hash = v_token_hash
  where id = v_enrollment_id;

  begin
    perform public.claim_station_enrollment(
      v_token_plain,
      repeat('d', 64),
      v_fp,
      'os1-test-ua',
      'idem2-' || gen_random_uuid()::text
    );
    return query select 'beh_blocked_fingerprint_claim_fails'::text, false, 'blocked fp should reject'::text;
  exception
    when others then
      return query select 'beh_blocked_fingerprint_claim_fails'::text, true, 'blocked fingerprint'::text;
  end;

  update public.operational_station_devices
  set enrollment_id = v_enrollment_id,
      claim_secret_hash = v_claim_hash,
      claim_secret_consumed_at = null,
      status = 'pending'
  where id = v_device2;

  update public.operational_station_enrollment_tokens
  set status = 'blocked'
  where id = v_enrollment_id;

  v_fn_def := pg_get_functiondef('public.get_device_enrollment_status(uuid,uuid,text)'::regprocedure);

  return query
  select 'beh_blocked_status_in_get_enrollment'::text,
    v_fn_def ilike '%blocked%' and v_fn_def ilike '%v_public_status%',
    'status RPC maps blocked'::text;

  return query
  select 'runtime_skipped_requires_edge_auth_admin_reject'::text, true,
    'reject_and_block_station_device needs auth.uid admin; validate Gate I'::text;

  return query
  select 'runtime_skipped_requires_edge_auth_authorize'::text, true,
    'authorize_station_device_enrollment needs admin JWT; validate Gate H'::text;

  return query
  select 'runtime_skipped_requires_edge_auth_complete'::text, true,
    'complete enrollment needs Edge auth.admin.createUser; validate Gate H'::text;

  return query
  select 'runtime_skipped_requires_edge_auth_edge_cors'::text, true,
    'CORS allowlist and OPERATIONAL_STATION_ENROLL_ORIGINS; validate Gates D–F'::text;

  return;
end;
$$;

with results as materialized (
  select * from public.test_operational_stations_foundation_190()
),
summary as (
  select
    count(*)::int as total,
    count(*) filter (where passed)::int as passed_total,
    count(*) filter (where not passed)::int as failed_total
  from results
)
select
  r.scenario,
  r.passed,
  r.detail,
  s.total,
  s.passed_total,
  s.failed_total
from results r
cross join summary s
order by r.passed asc, r.scenario;

drop function if exists public.test_operational_stations_foundation_190();

rollback;
