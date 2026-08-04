-- Remote-safe structural verification for migration 199 (BEGIN … ROLLBACK).
-- Read-only: inspects pg_catalog / pg_get_functiondef only.
-- No DML, no auth.users, no session_replication_role, no trigger toggles, no app_settings writes.
-- Runtime parity (20/20: service_opened, replay, reuse, owner mismatch execution) lives in
-- supabase/schema/199_lab_operational_station_pos_catalog_parity_runtime.sql
-- via scripts/run-parity-lab-199.mjs on isolated local PostgreSQL.

begin;

with fn as (
  select
    coalesce(
      pg_get_functiondef(
        'public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure
      ),
      ''
    ) as open_def,
    coalesce(
      pg_get_functiondef(
        'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure
      ),
      ''
    ) as assert_def,
    coalesce(
      pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure),
      ''
    ) as catalog_def
),
fn_proc as (
  select
    'open_station_pos_table_service'::text as fn_label,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure

  union all

  select
    'station_pos_assert_order_open_for_drafts'::text,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure

  union all

  select
    'get_station_pos_catalog'::text,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.get_station_pos_catalog(text)'::regprocedure
),
proc_safe as (
  select
    fp.fn_label,
    fp.prosecdef,
    fp.proconfig,
    (
      fp.prosecdef = true
      and (
        select count(*) = 1
        from unnest(coalesce(fp.proconfig, array[]::text[])) cfg
        where lower(trim(split_part(cfg, '=', 1))) = 'search_path'
          and nullif(trim(both '"' from trim(split_part(cfg, '=', 2))), '') is null
      )
    ) as safe_definer_search_path
  from fn_proc fp
),
markers as (
  select
    fn.*,
    position('STATION_POS_ORDER_OWNER_MISMATCH' in assert_def) > 0 as assert_owner_code,
    position('STATION_POS_ORDER_NOT_OPEN' in assert_def) > 0 as assert_not_open_code,
    position('''image_url''' in catalog_def) > 0 as catalog_image_url,
    position('get_pos_product_image_url' in catalog_def) = 0 as catalog_no_n_plus_one,
    position('production_area_name' in catalog_def) > 0 as catalog_production_area_name,
    (
      select count(*) >= 2
      from regexp_matches(open_def, 'STATION_POS_ORDER_OWNER_MISMATCH', 'g') m
    ) as open_owner_guards,
    position('insert into public.pos_order_events' in open_def) > 0 as open_service_opened_insert,
    position('''service_opened''' in open_def) > 0 as open_service_opened_type,
    position('created_by' in open_def) > 0
      and position('v_operator_id' in open_def) > 0 as open_created_by_operator,
    position('station_pos_idempotency_replay_if_completed' in open_def) > 0
      and position('resolve_station_pos_operator_context' in open_def) > 0
      and position('station_pos_idempotency_replay_if_completed' in open_def)
        < position('resolve_station_pos_operator_context' in open_def) as open_replay_before_resolve,
    case
      when position('STATION_POS_ORDER_OWNER_MISMATCH' in assert_def) > 0
        and position('STATION_POS_ORDER_NOT_OPEN' in assert_def) > 0
        and position('''image_url''' in catalog_def) > 0
        and position('production_area_name' in catalog_def) > 0
        and (
          select count(*) >= 2
          from regexp_matches(open_def, 'STATION_POS_ORDER_OWNER_MISMATCH', 'g') m
        )
      then '199_fully_present'
      when position('STATION_POS_ORDER_OWNER_MISMATCH' in assert_def) = 0
        and position('STATION_POS_ORDER_NOT_OPEN' in assert_def) = 0
        and position('''image_url''' in catalog_def) = 0
        and position('production_area_name' in catalog_def) = 0
        and (
          select count(*) = 0
          from regexp_matches(open_def, 'STATION_POS_ORDER_OWNER_MISMATCH', 'g') m
        )
      then '199_absent'
      else '199_partial'
    end as migration_199_state
  from fn
),
scenario_rows (scenario, passed, detail) as (
  select
    'migration_199_fully_present'::text,
    (select migration_199_state from markers) = '199_fully_present',
    (select migration_199_state from markers)::text

  union all

  select
    'open_signature_preserved',
    to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null,
    'open_station_pos_table_service(text,text,text,text,text,text)'

  union all

  select
    'assert_signature_preserved',
    to_regprocedure('public.station_pos_assert_order_open_for_drafts(uuid, uuid)') is not null,
    'station_pos_assert_order_open_for_drafts(uuid,uuid)'

  union all

  select
    'catalog_signature_preserved',
    to_regprocedure('public.get_station_pos_catalog(text)') is not null,
    'get_station_pos_catalog(text)'

  union all

  select
    'open_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'open_station_pos_table_service'),
      false
    ),
    coalesce(
      (select format('prosecdef=%s proconfig=%s', prosecdef, coalesce(proconfig::text, '{}'))
       from proc_safe where fn_label = 'open_station_pos_table_service'),
      'missing open_station_pos_table_service'
    )

  union all

  select
    'assert_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
      false
    ),
    coalesce(
      (select format('prosecdef=%s proconfig=%s', prosecdef, coalesce(proconfig::text, '{}'))
       from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
      'missing station_pos_assert_order_open_for_drafts'
    )

  union all

  select
    'catalog_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'get_station_pos_catalog'),
      false
    ),
    coalesce(
      (select format('prosecdef=%s proconfig=%s', prosecdef, coalesce(proconfig::text, '{}'))
       from proc_safe where fn_label = 'get_station_pos_catalog'),
      'missing get_station_pos_catalog'
    )

  union all

  select
    'catalog_batch_image_url',
    (select catalog_image_url from markers),
    'single RPC includes image_url in batch select'

  union all

  select
    'catalog_no_n_plus_one_image_rpc',
    (select catalog_no_n_plus_one from markers),
    'get_station_pos_catalog must not call get_pos_product_image_url'

  union all

  select
    'catalog_production_area_name',
    (select catalog_production_area_name from markers),
    'production_area_name joined in catalog query'

  union all

  select
    'assert_owner_error_code',
    (select assert_owner_code from markers),
    'STATION_POS_ORDER_OWNER_MISMATCH in assert body'

  union all

  select
    'assert_not_open_error_code',
    (select assert_not_open_code from markers),
    'STATION_POS_ORDER_NOT_OPEN in assert body'

  union all

  select
    'open_service_opened_insert',
    (select open_service_opened_insert from markers),
    'open_station_pos_table_service logs pos_order_events'

  union all

  select
    'open_service_opened_type',
    (select open_service_opened_type from markers),
    'event_type service_opened present in function body'

  union all

  select
    'open_service_opened_created_by_operator',
    (select open_created_by_operator from markers),
    'created_by uses v_operator_id'

  union all

  select
    'open_owner_guards_present',
    (select open_owner_guards from markers),
    'open_station_pos_table_service blocks foreign owner on reuse'

  union all

  select
    'open_replay_before_resolve',
    (select open_replay_before_resolve from markers),
    'idempotency replay precedes resolve_station_pos_operator_context'

  union all

  select
    'authenticated_wrappers_acl',
    has_function_privilege(
      'authenticated',
      'public.open_station_pos_table_service(text, text, text, text, text, text)',
      'EXECUTE'
    )
    and has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_station_pos_context(text)', 'EXECUTE'),
    'authenticated EXECUTE on public station POS wrappers'

  union all

  select
    'assert_not_public',
    not has_function_privilege(
      'authenticated',
      'public.station_pos_assert_order_open_for_drafts(uuid, uuid)',
      'EXECUTE'
    ),
    'assert remains internal (no authenticated EXECUTE)'

  union all

  select
    'operational_stations_enabled_false',
    not public.operational_stations_enabled(),
    case
      when public.operational_stations_enabled() then 'ENABLED — read-only check failed'
      else 'false ok (read only, not modified)'
    end

  union all

  select
    'operational_station_pos_enabled_false',
    not public.operational_station_pos_enabled(),
    case
      when public.operational_station_pos_enabled() then 'ENABLED — read-only check failed'
      else 'false ok (read only, not modified)'
    end
),
scenarios as (
  select scenario, passed, detail
  from scenario_rows
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where passed)::bigint as passed_total,
    count(*) filter (where not passed)::bigint as failed_total
  from scenarios
)
select
  s.scenario,
  s.passed,
  s.detail,
  sm.total,
  sm.passed_total,
  sm.failed_total
from scenarios s
cross join summary sm
order by s.passed asc, s.scenario asc;

rollback;
