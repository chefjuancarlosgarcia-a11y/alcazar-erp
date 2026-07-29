-- Preflight 198 — read-only gates before applying station POS foundation.

with gates (gate_code, is_blocker, detail) as (
  select 'requires_197_absolute_expires_at', true,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'operational_operator_sessions'
        and column_name = 'absolute_expires_at'
    ) then 'present' else 'apply 197 first' end

  union all select 'requires_verify_pin', true,
    case when to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') is not null
      then 'ok' else 'missing verify_operational_pin_for_device' end

  union all select 'requires_pos_table_service', true,
    case when to_regprocedure('public.open_pos_table_service(text, text, text, text, text, uuid, uuid, text, text, text, uuid)') is not null
      then 'ok' else 'apply POS 187+' end

  union all select 'requires_floor_plan', true,
    case when to_regclass('public.pos_floor_zones') is not null
      and to_regclass('public.pos_floor_tables') is not null
      then 'ok' else 'apply 065 floor plan' end

  union all select 'requires_catalog', true,
    case when to_regclass('public.pos_products') is not null
      and to_regclass('public.pos_product_variants') is not null
      then 'ok' else 'pos catalog tables missing' end

  union all select 'wrappers_not_yet_applied', false,
    case when to_regprocedure('public.get_station_pos_context(text)') is null
      then 'ready_to_apply_198' else 'partial_or_applied' end

  union all select 'flag_still_false_or_absent', false,
    case when not exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled')
      then 'no row yet ok on apply'
      when coalesce(
        (select nullif(value ->> 'enabled', '')::boolean from public.app_settings
         where key = 'operational_station_pos_enabled'),
        false
      ) then 'ENABLED — do not apply without review'
      else 'false ok' end
)
select * from gates order by is_blocker desc, gate_code;

with gates (gate_code, is_blocker, detail) as (
  select 'requires_197_absolute_expires_at', true,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'operational_operator_sessions'
        and column_name = 'absolute_expires_at'
    ) then 'present' else 'apply 197 first' end

  union all select 'requires_verify_pin', true,
    case when to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') is not null
      then 'ok' else 'missing verify_operational_pin_for_device' end

  union all select 'requires_pos_table_service', true,
    case when to_regprocedure('public.open_pos_table_service(text, text, text, text, text, uuid, uuid, text, text, text, uuid)') is not null
      then 'ok' else 'apply POS 187+' end

  union all select 'requires_floor_plan', true,
    case when to_regclass('public.pos_floor_zones') is not null
      and to_regclass('public.pos_floor_tables') is not null
      then 'ok' else 'apply 065 floor plan' end

  union all select 'requires_catalog', true,
    case when to_regclass('public.pos_products') is not null
      and to_regclass('public.pos_product_variants') is not null
      then 'ok' else 'pos catalog tables missing' end

  union all select 'wrappers_not_yet_applied', false,
    case when to_regprocedure('public.get_station_pos_context(text)') is null
      then 'ready_to_apply_198' else 'partial_or_applied' end

  union all select 'flag_still_false_or_absent', false,
    case when not exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled')
      then 'no row yet ok on apply'
      when coalesce(
        (select nullif(value ->> 'enabled', '')::boolean from public.app_settings
         where key = 'operational_station_pos_enabled'),
        false
      ) then 'ENABLED — do not apply without review'
      else 'false ok' end
)
select bool_and(
  case gate_code
    when 'wrappers_not_yet_applied' then detail = 'ready_to_apply_198'
    when 'flag_still_false_or_absent' then detail <> 'ENABLED — do not apply without review'
    else not is_blocker or detail in ('present', 'ok', 'false ok', 'no row yet ok on apply')
  end
) as ready_to_apply_198
from gates;
