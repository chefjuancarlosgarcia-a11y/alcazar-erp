-- Preflight 199 — read-only gates before applying station POS catalog parity patch.
-- Single result grid; no DDL/DML. Inspect SECURITY DEFINER/search_path via pg_proc.proconfig.

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
    'requires_198_get_station_pos_context',
    to_regprocedure('public.get_station_pos_context(text)') is not null,
    case
      when to_regprocedure('public.get_station_pos_context(text)') is not null
        then 'ok'
      else 'apply 198 first'
    end

  union all

  select
    'requires_198_open_station_pos_table_service',
    to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null,
    case
      when to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null
        then 'ok'
      else 'apply 198 first'
    end

  union all

  select
    'requires_198_assert_order_open_for_drafts',
    to_regprocedure('public.station_pos_assert_order_open_for_drafts(uuid, uuid)') is not null,
    case
      when to_regprocedure('public.station_pos_assert_order_open_for_drafts(uuid, uuid)') is not null
        then 'ok'
      else 'apply 198 first'
    end

  union all

  select
    'requires_198_get_station_pos_catalog',
    to_regprocedure('public.get_station_pos_catalog(text)') is not null,
    case
      when to_regprocedure('public.get_station_pos_catalog(text)') is not null
        then 'ok'
      else 'apply 198 first'
    end

  union all

  select
    'requires_198_idempotency_table',
    to_regclass('public.operational_station_pos_idempotency') is not null,
    case
      when to_regclass('public.operational_station_pos_idempotency') is not null
        then 'ok'
      else 'apply 198 first'
    end

  union all

  select
    'baseline_open_preserves_service_opened',
    (
      select open_service_opened_insert
        and open_service_opened_type
        and open_created_by_operator
      from markers
    ),
    case
      when (
        select open_service_opened_insert
          and open_service_opened_type
          and open_created_by_operator
        from markers
      )
        then 'service_opened insert present in open_station_pos_table_service'
      else 'BLOCKER: open_station_pos_table_service missing service_opened event insert'
    end

  union all

  select
    'open_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'open_station_pos_table_service'),
      false
    ),
    case
      when coalesce(
        (select safe_definer_search_path from proc_safe where fn_label = 'open_station_pos_table_service'),
        false
      )
        then format(
          'prosecdef=%s proconfig=%s',
          (select prosecdef from proc_safe where fn_label = 'open_station_pos_table_service'),
          coalesce(
            (select proconfig::text from proc_safe where fn_label = 'open_station_pos_table_service'),
            '{}'
          )
        )
      else 'unsafe or missing SECURITY DEFINER/empty search_path (pg_proc.proconfig)'
    end

  union all

  select
    'assert_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
      false
    ),
    case
      when coalesce(
        (select safe_definer_search_path from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
        false
      )
        then format(
          'prosecdef=%s proconfig=%s',
          (select prosecdef from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
          coalesce(
            (select proconfig::text from proc_safe where fn_label = 'station_pos_assert_order_open_for_drafts'),
            '{}'
          )
        )
      else 'unsafe or missing SECURITY DEFINER/empty search_path (pg_proc.proconfig)'
    end

  union all

  select
    'catalog_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'get_station_pos_catalog'),
      false
    ),
    case
      when coalesce(
        (select safe_definer_search_path from proc_safe where fn_label = 'get_station_pos_catalog'),
        false
      )
        then format(
          'prosecdef=%s proconfig=%s',
          (select prosecdef from proc_safe where fn_label = 'get_station_pos_catalog'),
          coalesce(
            (select proconfig::text from proc_safe where fn_label = 'get_station_pos_catalog'),
            '{}'
          )
        )
      else 'unsafe or missing SECURITY DEFINER/empty search_path (pg_proc.proconfig)'
    end

  union all

  select
    'public_wrappers_authenticated_acl',
    has_function_privilege(
      'authenticated',
      'public.open_station_pos_table_service(text, text, text, text, text, text)',
      'EXECUTE'
    )
    and has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_station_pos_context(text)', 'EXECUTE'),
    case
      when has_function_privilege(
        'authenticated',
        'public.open_station_pos_table_service(text, text, text, text, text, text)',
        'EXECUTE'
      )
      and has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_station_pos_context(text)', 'EXECUTE')
        then 'authenticated EXECUTE on public wrappers'
      else 'missing authenticated EXECUTE on station POS wrappers'
    end

  union all

  select
    'internal_assert_not_public',
    not has_function_privilege(
      'authenticated',
      'public.station_pos_assert_order_open_for_drafts(uuid, uuid)',
      'EXECUTE'
    ),
    case
      when not has_function_privilege(
        'authenticated',
        'public.station_pos_assert_order_open_for_drafts(uuid, uuid)',
        'EXECUTE'
      )
        then 'assert remains internal'
      else 'assert must not grant authenticated EXECUTE'
    end

  union all

  select
    'migration_199_state',
    (select migration_199_state from markers) = '199_absent',
    (select migration_199_state from markers)

  union all

  select
    'migration_199_partial_blocker',
    (select migration_199_state from markers) <> '199_partial',
    case
      when (select migration_199_state from markers) = '199_partial'
        then 'BLOCKER: partial 199 — rollback or complete before reapply'
      else 'ok'
    end

  union all

  select
    'migration_199_markers_when_present',
    (
      select migration_199_state <> '199_fully_present'
        or (
          assert_owner_code
          and assert_not_open_code
          and catalog_image_url
          and catalog_production_area_name
          and open_owner_guards
          and open_service_opened_insert
          and open_service_opened_type
          and open_created_by_operator
        )
      from markers
    ),
    case
      when (select migration_199_state from markers) <> '199_fully_present'
        then 'n/a until 199 applied'
      when (
        select assert_owner_code
          and assert_not_open_code
          and catalog_image_url
          and catalog_production_area_name
          and open_owner_guards
          and open_service_opened_insert
          and open_service_opened_type
          and open_created_by_operator
        from markers
      )
        then 'image_url + STATION_POS_* + service_opened present'
      else '199 applied but markers incomplete'
    end

  union all

  select
    'operational_stations_enabled_false',
    not public.operational_stations_enabled(),
    case
      when public.operational_stations_enabled()
        then 'ENABLED — do not apply without review'
      else 'false ok'
    end

  union all

  select
    'operational_station_pos_enabled_false',
    not public.operational_station_pos_enabled(),
    case
      when public.operational_station_pos_enabled()
        then 'ENABLED — do not apply without review'
      else 'false ok'
    end
),
gates as (
  select
    gate_code,
    gate_passed,
    not gate_passed as is_blocker,
    detail
  from gate_rows
),
ready as (
  select bool_and(gate_passed) as ready_to_apply_199
  from gates
)
select
  g.gate_code,
  g.gate_passed,
  g.is_blocker,
  g.detail,
  r.ready_to_apply_199
from gates g
cross join ready r
order by g.is_blocker desc, g.gate_code;
