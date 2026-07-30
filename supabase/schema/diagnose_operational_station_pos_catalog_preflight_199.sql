-- Preflight 199 — read-only gates before applying station POS catalog parity patch.
-- Single gate grid; no DDL/DML. Final boolean: ready_to_apply_199.

with fn as (
  select
    coalesce(pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure), '') as open_def,
    coalesce(pg_get_functiondef('public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure), '') as assert_def,
    coalesce(pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure), '') as catalog_def
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
gates (gate_code, is_blocker, detail) as (
  select 'requires_198_get_station_pos_context', true,
    case when to_regprocedure('public.get_station_pos_context(text)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_open_station_pos_table_service', true,
    case when to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_assert_order_open_for_drafts', true,
    case when to_regprocedure('public.station_pos_assert_order_open_for_drafts(uuid, uuid)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_get_station_pos_catalog', true,
    case when to_regprocedure('public.get_station_pos_catalog(text)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_idempotency_table', true,
    case when to_regclass('public.operational_station_pos_idempotency') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'baseline_open_preserves_service_opened', true,
    case
      when (select open_service_opened_insert from markers)
        and (select open_service_opened_type from markers)
        and (select open_created_by_operator from markers)
      then 'service_opened insert present in open_station_pos_table_service'
      else 'BLOCKER: open_station_pos_table_service missing service_opened event insert'
    end

  union all select 'open_security_definer_search_path', true,
    case
      when (select open_def from markers) = '' then 'open function missing'
      when (select open_def from markers) ilike '%security definer%'
        and (select open_def from markers) ilike '%set search_path = ''''%'
      then 'SECURITY DEFINER + empty search_path'
      else 'unsafe or missing SECURITY DEFINER/search_path'
    end

  union all select 'assert_security_definer_search_path', true,
    case
      when (select assert_def from markers) = '' then 'assert function missing'
      when (select assert_def from markers) ilike '%security definer%'
        and (select assert_def from markers) ilike '%set search_path = ''''%'
      then 'SECURITY DEFINER + empty search_path'
      else 'unsafe or missing SECURITY DEFINER/search_path'
    end

  union all select 'catalog_security_definer_search_path', true,
    case
      when (select catalog_def from markers) = '' then 'catalog function missing'
      when (select catalog_def from markers) ilike '%security definer%'
        and (select catalog_def from markers) ilike '%set search_path = ''''%'
      then 'SECURITY DEFINER + empty search_path'
      else 'unsafe or missing SECURITY DEFINER/search_path'
    end

  union all select 'public_wrappers_authenticated_acl', true,
    case when has_function_privilege('authenticated', 'public.open_station_pos_table_service(text, text, text, text, text, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_station_pos_context(text)', 'EXECUTE')
      then 'authenticated EXECUTE on public wrappers'
      else 'missing authenticated EXECUTE on station POS wrappers'
    end

  union all select 'internal_assert_not_public', true,
    case when not has_function_privilege('authenticated', 'public.station_pos_assert_order_open_for_drafts(uuid, uuid)', 'EXECUTE')
      then 'assert remains internal'
      else 'assert must not grant authenticated EXECUTE'
    end

  union all select 'migration_199_state', true,
    (select migration_199_state from markers)

  union all select 'migration_199_partial_blocker', true,
    case when (select migration_199_state from markers) = '199_partial'
      then 'BLOCKER: partial 199 — rollback or complete before reapply'
      else 'ok'
    end

  union all select 'migration_199_markers_when_present', false,
    case
      when (select migration_199_state from markers) <> '199_fully_present' then 'n/a until 199 applied'
      when (select assert_owner_code and assert_not_open_code and catalog_image_url
              and catalog_production_area_name and open_owner_guards
              and open_service_opened_insert and open_service_opened_type
              and open_created_by_operator from markers)
      then 'image_url + STATION_POS_* + service_opened present'
      else '199 applied but markers incomplete'
    end

  union all select 'operational_stations_enabled_false', false,
    case when public.operational_stations_enabled()
      then 'ENABLED — do not apply without review'
      else 'false ok'
    end

  union all select 'operational_station_pos_enabled_false', false,
    case when public.operational_station_pos_enabled()
      then 'ENABLED — do not apply without review'
      else 'false ok'
    end
)
select * from gates order by is_blocker desc, gate_code;

with fn as (
  select
    coalesce(pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure), '') as open_def,
    coalesce(pg_get_functiondef('public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure), '') as assert_def,
    coalesce(pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure), '') as catalog_def
),
markers as (
  select
    position('insert into public.pos_order_events' in open_def) > 0
      and position('''service_opened''' in open_def) > 0
      and position('v_operator_id' in open_def) > 0 as baseline_service_opened,
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
gates (gate_code, is_blocker, detail) as (
  select 'requires_198_get_station_pos_context', true,
    case when to_regprocedure('public.get_station_pos_context(text)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_open_station_pos_table_service', true,
    case when to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_assert_order_open_for_drafts', true,
    case when to_regprocedure('public.station_pos_assert_order_open_for_drafts(uuid, uuid)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_get_station_pos_catalog', true,
    case when to_regprocedure('public.get_station_pos_catalog(text)') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'requires_198_idempotency_table', true,
    case when to_regclass('public.operational_station_pos_idempotency') is not null
      then 'ok' else 'apply 198 first' end

  union all select 'baseline_open_preserves_service_opened', true,
    case when (select baseline_service_opened from markers)
      then 'service_opened insert present'
      else 'missing service_opened insert'
    end

  union all select 'open_security_definer_search_path', true,
    case when coalesce(pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure), '') ilike '%security definer%'
      and coalesce(pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure), '') ilike '%set search_path = ''''%'
      then 'ok' else 'unsafe open function'
    end

  union all select 'assert_security_definer_search_path', true,
    case when coalesce(pg_get_functiondef('public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure), '') ilike '%security definer%'
      and coalesce(pg_get_functiondef('public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure), '') ilike '%set search_path = ''''%'
      then 'ok' else 'unsafe assert function'
    end

  union all select 'catalog_security_definer_search_path', true,
    case when coalesce(pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure), '') ilike '%security definer%'
      and coalesce(pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure), '') ilike '%set search_path = ''''%'
      then 'ok' else 'unsafe catalog function'
    end

  union all select 'public_wrappers_authenticated_acl', true,
    case when has_function_privilege('authenticated', 'public.open_station_pos_table_service(text, text, text, text, text, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_station_pos_context(text)', 'EXECUTE')
      then 'ok' else 'missing ACL'
    end

  union all select 'internal_assert_not_public', true,
    case when not has_function_privilege('authenticated', 'public.station_pos_assert_order_open_for_drafts(uuid, uuid)', 'EXECUTE')
      then 'ok' else 'assert exposed'
    end

  union all select 'migration_199_state', true,
    (select migration_199_state from markers)

  union all select 'migration_199_partial_blocker', true,
    case when (select migration_199_state from markers) = '199_partial'
      then 'partial' else 'ok' end

  union all select 'operational_stations_enabled_false', false,
    case when public.operational_stations_enabled()
      then 'ENABLED' else 'false ok' end

  union all select 'operational_station_pos_enabled_false', false,
    case when public.operational_station_pos_enabled()
      then 'ENABLED' else 'false ok' end
)
select bool_and(
  case gate_code
    when 'migration_199_state' then detail = '199_absent'
    when 'migration_199_partial_blocker' then detail = 'ok'
    when 'operational_stations_enabled_false' then detail = 'false ok'
    when 'operational_station_pos_enabled_false' then detail = 'false ok'
    else not is_blocker or detail in (
      'ok', 'service_opened insert present', 'service_opened insert present in open_station_pos_table_service',
      'SECURITY DEFINER + empty search_path', 'authenticated EXECUTE on public wrappers',
      'assert remains internal', '199_absent'
    )
  end
) as ready_to_apply_199
from gates;
