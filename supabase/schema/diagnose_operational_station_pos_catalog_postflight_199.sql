-- Postflight 199 — read-only verification after migration 199 applied.
-- Single result grid; no DDL/DML. Inspect SECURITY DEFINER/search_path via pg_proc.proconfig.

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
gate_rows (gate_code, gate_passed, detail) as (
  select
    'migration_199_fully_present',
    (select migration_199_state from markers) = '199_fully_present',
    (select migration_199_state from markers)::text

  union all

  select
    'open_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'open_station_pos_table_service'),
      false
    ),
    'open_station_pos_table_service SECURITY DEFINER + empty search_path'

  union all

  select
    'assert_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
      false
    ),
    'station_pos_assert_order_open_for_drafts SECURITY DEFINER + empty search_path'

  union all

  select
    'catalog_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'get_station_pos_catalog'),
      false
    ),
    'get_station_pos_catalog SECURITY DEFINER + empty search_path'

  union all

  select
    'catalog_batch_image_url',
    (select catalog_image_url and catalog_no_n_plus_one from markers),
    'batch image_url without get_pos_product_image_url'

  union all

  select
    'catalog_production_area_name',
    (select catalog_production_area_name from markers),
    'production_area_name in catalog RPC'

  union all

  select
    'assert_owner_error_code',
    (select assert_owner_code from markers),
    'STATION_POS_ORDER_OWNER_MISMATCH in assert'

  union all

  select
    'assert_not_open_error_code',
    (select assert_not_open_code from markers),
    'STATION_POS_ORDER_NOT_OPEN in assert'

  union all

  select
    'open_service_opened_preserved',
    (
      select open_service_opened_insert
        and open_service_opened_type
        and open_created_by_operator
      from markers
    ),
    'service_opened insert + event_type + created_by operator'

  union all

  select
    'open_owner_guards_present',
    (select open_owner_guards from markers),
    'open reuse blocks foreign owner (both paths)'

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
    'authenticated EXECUTE on public wrappers'

  union all

  select
    'assert_not_public',
    not has_function_privilege(
      'authenticated',
      'public.station_pos_assert_order_open_for_drafts(uuid, uuid)',
      'EXECUTE'
    ),
    'assert remains internal'

  union all

  select
    'operational_stations_enabled_false',
    not public.operational_stations_enabled(),
    case
      when public.operational_stations_enabled() then 'ENABLED — review before enabling'
      else 'false ok'
    end

  union all

  select
    'operational_station_pos_enabled_false',
    not public.operational_station_pos_enabled(),
    case
      when public.operational_station_pos_enabled() then 'ENABLED — review before enabling'
      else 'false ok'
    end
),
gates as (
  select gate_code, gate_passed, detail
  from gate_rows
),
ready as (
  select bool_and(gate_passed) as ready_after_199
  from gates
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where gate_passed)::bigint as passed_total,
    count(*) filter (where not gate_passed)::bigint as failed_total
  from gates
)
select
  g.gate_code as scenario,
  g.gate_passed as passed,
  g.detail,
  sm.total,
  sm.passed_total,
  sm.failed_total,
  r.ready_after_199
from gates g
cross join summary sm
cross join ready r
order by g.gate_passed asc, g.gate_code asc;

rollback;
