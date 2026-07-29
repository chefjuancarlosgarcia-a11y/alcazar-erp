-- Postflight 198 — read-only after apply.

with gates (gate_code, is_blocker, detail) as (
  select 'idempotency_table', true,
    case when to_regclass('public.operational_station_pos_idempotency') is not null then 'ok' else 'missing' end

  union all select 'floor_layout_wrapper', true,
    case when to_regprocedure('public.get_station_pos_floor_layout(text)') is not null
      and position('mesasTotales' in pg_get_functiondef(
        'public.station_pos_floor_layout_payload(text)'::regprocedure
      )) > 0
      then 'ok' else 'missing or incomplete' end

  union all select 'table_events_wrapper', true,
    case when to_regprocedure('public.get_station_pos_table_events(text, text, integer)') is not null
      then 'ok' else 'missing' end

  union all select 'order_events_wrapper', true,
    case when to_regprocedure('public.get_station_pos_order_events(text, uuid, integer)') is not null
      then 'ok' else 'missing' end

  union all select 'pricing_internal_revoked', true,
    case when not has_function_privilege(
      'authenticated', 'public.station_pos_compute_line_item_pricing(uuid, uuid, jsonb, jsonb)', 'EXECUTE'
    ) then 'ok' else 'leaked execute' end

  union all select 'human_send_production_intact', true,
    case when pg_get_functiondef('public.send_pos_order_to_production(uuid)'::regprocedure)
      is not null then 'ok' else 'missing human rpc' end

  union all select 'flag_default_false', false,
    coalesce(
      (select nullif(value ->> 'enabled', '') from public.app_settings
       where key = 'operational_station_pos_enabled'),
      'false'
    )
)
select * from gates order by is_blocker desc, gate_code;

select count(*) as wrapper_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname like 'get_station_pos_%'
    or p.proname like '%\_station\_pos\_%' escape '\'
  );
