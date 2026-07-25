begin;

create temp table if not exists os1_test_results (
  check_id text primary key,
  passed boolean not null,
  detail text
) on commit drop;

truncate os1_test_results;

insert into os1_test_results (check_id, passed, detail)
select 'tables_exist', count(*) = 4,
  'count=' || count(*)::text
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'operational_stations',
    'operational_station_devices',
    'operational_station_enrollment_tokens',
    'operational_station_events'
  );

insert into os1_test_results (check_id, passed, detail)
select 'flag_default_off', not public.operational_stations_enabled(), 'operational_stations_enabled';

insert into os1_test_results (check_id, passed, detail)
select 'rls_enabled', bool_and(c.relrowsecurity), 'all four tables'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'operational_stations',
    'operational_station_devices',
    'operational_station_enrollment_tokens',
    'operational_station_events'
  );

insert into os1_test_results (check_id, passed, detail)
select 'one_active_index', exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and indexname = 'operational_station_devices_one_active_per_station_idx'
), 'partial unique active per station';

insert into os1_test_results (check_id, passed, detail)
select 'no_sign_in_secret_persistence',
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operational_station_enrollment_tokens'
      and column_name in (
        'ephemeral_auth_email',
        'ephemeral_sign_in_secret',
        'enrollment_token',
        'token_plain',
        'pin'
      )
  ), 'no reversible secret columns';

insert into os1_test_results (check_id, passed, detail)
select 'enrollment_authorized_status',
  exists (
    select 1 from information_schema.check_constraints cc
    join information_schema.constraint_column_usage ccu on cc.constraint_name = ccu.constraint_name
    where ccu.table_name = 'operational_station_enrollment_tokens'
      and cc.check_clause like '%authorized%'
  ), 'lifecycle includes authorized';

insert into os1_test_results (check_id, passed, detail)
select 'no_take_enrollment_sign_in_secret',
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'take_enrollment_sign_in_secret'
  ), 'RPC removed';

insert into os1_test_results (check_id, passed, detail)
select 'claim_secret_hash_only',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operational_station_devices'
      and column_name = 'claim_secret_hash'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operational_station_devices'
      and column_name in ('claim_secret_plain', 'device_claim_secret')
  ), 'hash only on device';

insert into os1_test_results (check_id, passed, detail)
select 'claim_rpc_service_only',
  not has_function_privilege('anon', 'public.claim_station_enrollment(text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_station_enrollment(text,text,text,text,text)', 'EXECUTE'),
  'anon denied claim';

insert into os1_test_results (check_id, passed, detail)
select 'blocked_status_allowed',
  exists (
    select 1 from information_schema.check_constraints cc
    join information_schema.constraint_column_usage ccu on cc.constraint_name = ccu.constraint_name
    where ccu.table_name = 'operational_station_devices'
      and cc.check_clause like '%blocked%'
  ), 'device status check';

select check_id, passed, detail
from os1_test_results
order by check_id;

rollback;
