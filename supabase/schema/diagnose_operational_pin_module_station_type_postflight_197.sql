-- Postflight 197 — verify PIN module/station binding and session caps (read-only).

with gates (gate_code, is_blocker, detail) as (
  select 'verify_pin_signature', true,
    case when to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') is not null
      then 'ok' else 'missing function' end

  union all select 'uses_required_module', true,
    case when position('v_required_module' in pg_get_functiondef(
      to_regprocedure('public.verify_operational_pin_for_device(text, text, text)')
    )) > 0 then 'ok' else 'missing module map' end

  union all select 'rejects_module_mismatch', true,
    case when position('p_module <> v_required_module' in pg_get_functiondef(
      to_regprocedure('public.verify_operational_pin_for_device(text, text, text)')
    )) > 0 then 'ok' else 'missing mismatch guard' end

  union all select 'absolute_expires_at_column', true,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operational_operator_sessions'
        and column_name = 'absolute_expires_at'
    ) then 'present' else 'missing column' end

  union all select 'idle_pos_120', false,
    case when position('120' in pg_get_functiondef(
      to_regprocedure('public.verify_operational_pin_for_device(text, text, text)')
    )) > 0 then 'found 120 reference' else 'verify idle constant in source' end

  union all select 'flag_unchanged', false,
    case when not exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled')
      then 'no row'
      when coalesce(
        (select nullif(value ->> 'enabled', '')::boolean from public.app_settings
         where key = 'operational_station_pos_enabled'),
        false
      ) then 'ENABLED'
      else 'false' end

  union all select 'authenticated_execute_verify', true,
    case when has_function_privilege('authenticated', 'public.verify_operational_pin_for_device(text, text, text)', 'EXECUTE')
      then 'ok' else 'missing EXECUTE for authenticated' end
)
select * from gates order by is_blocker desc, gate_code;

select count(*) as operational_operator_sessions_rows
from public.operational_operator_sessions;
