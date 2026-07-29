-- Preflight 197 — read-only gates before module/station PIN binding + absolute_expires_at.

with gates (gate_code, is_blocker, detail) as (
  select 'requires_193_195_196_pin_foundation', true,
    case when to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') is not null
      then 'verify_pin present (pre-197 baseline)'
      else 'missing verify_operational_pin_for_device — apply 193–196 first' end

  union all select 'absolute_expires_at_column', false,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operational_operator_sessions'
        and column_name = 'absolute_expires_at'
    ) then 'already present — 197 idempotent ok'
      else 'absent — 197 will add' end

  union all select 'partial_197_not_applied', false,
    case when position('v_required_module' in coalesce(pg_get_functiondef(
      to_regprocedure('public.verify_operational_pin_for_device(text, text, text)')
    ), '')) > 0
      then '197 already applied'
      else 'ready_to_apply_197' end

  union all select 'flag_operational_station_pos', false,
    case when not exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled')
      then 'no row ok'
      when coalesce(
        (select nullif(value ->> 'enabled', '')::boolean from public.app_settings
         where key = 'operational_station_pos_enabled'),
        false
      ) then 'ENABLED — review only'
      else 'false ok' end

  union all select 'sessions_table_present', true,
    case when to_regclass('public.operational_operator_sessions') is not null
      then 'ok' else 'missing operational_operator_sessions' end
)
select * from gates order by is_blocker desc, gate_code;

with gates (gate_code, is_blocker, detail) as (
  select 'requires_193_195_196_pin_foundation', true,
    case when to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') is not null
      then 'verify_pin present (pre-197 baseline)'
      else 'missing verify_operational_pin_for_device — apply 193–196 first' end

  union all select 'absolute_expires_at_column', false,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operational_operator_sessions'
        and column_name = 'absolute_expires_at'
    ) then 'already present — 197 idempotent ok'
      else 'absent — 197 will add' end

  union all select 'partial_197_not_applied', false,
    case when position('v_required_module' in coalesce(pg_get_functiondef(
      to_regprocedure('public.verify_operational_pin_for_device(text, text, text)')
    ), '')) > 0
      then '197 already applied'
      else 'ready_to_apply_197' end

  union all select 'flag_operational_station_pos', false,
    case when not exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled')
      then 'no row ok'
      when coalesce(
        (select nullif(value ->> 'enabled', '')::boolean from public.app_settings
         where key = 'operational_station_pos_enabled'),
        false
      ) then 'ENABLED — review only'
      else 'false ok' end

  union all select 'sessions_table_present', true,
    case when to_regclass('public.operational_operator_sessions') is not null
      then 'ok' else 'missing operational_operator_sessions' end
)
select bool_and(
  case gate_code
    when 'partial_197_not_applied' then detail in ('ready_to_apply_197', '197 already applied')
    when 'flag_operational_station_pos' then detail <> 'ENABLED — review only'
    else not is_blocker or detail in (
      'verify_pin present (pre-197 baseline)',
      'ok',
      'false ok',
      'no row ok'
    )
  end
) as ready_to_apply_197
from gates;
