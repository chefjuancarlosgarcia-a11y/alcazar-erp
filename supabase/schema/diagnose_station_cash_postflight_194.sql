-- Postflight read-only AFTER applying 194. No DDL/DML. No operator tokens / idempotency payloads.

with fn as (
  select
    to_regprocedure('public.get_station_cash_context(text)') as ctx_oid,
    to_regprocedure('public.open_station_cash_session(text, numeric, text, text)') as open_oid,
    to_regprocedure('public.create_station_cash_movement(text, text, numeric, text, text, uuid, text)') as move_oid,
    to_regprocedure('public.close_station_cash_session(text, numeric, text, text)') as close_oid,
    to_regprocedure('public.record_station_cash_sale(text, uuid, numeric, text)') as sale_oid,
    to_regprocedure('public.resolve_station_cash_operator_context(text, boolean)') as resolve_oid,
    to_regprocedure('public.station_cash_create_movement_impl(text, text, numeric, text, text, uuid, text, boolean, boolean)') as impl_oid,
    to_regprocedure('public.station_cash_bind_operator_session_by_token(text)') as bind_oid,
    to_regprocedure('public.station_cash_idempotency_replay_if_completed(text, text, text, text)') as replay_oid,
    to_regprocedure('public.station_cash_idempotency_begin(uuid, uuid, uuid, text, text, text)') as begin_oid,
    to_regprocedure('public.station_cash_idempotency_complete(uuid, text, jsonb)') as complete_oid
),
idempotency_rel as (
  select to_regclass('public.operational_station_cash_idempotency') as relid
),
gates (gate_code, is_blocker, detail) as (
  select 'idempotency_table_rls' as gate_code,
    (
      (select idempotency_rel.relid is null from idempotency_rel)
      or not coalesce((
        select c.relrowsecurity from pg_class c
        where c.oid = (select idempotency_rel.relid from idempotency_rel)
      ), false)
    ) as is_blocker,
    jsonb_build_object(
      'table_present', (select idempotency_rel.relid is not null from idempotency_rel)
    ) as detail

  union all
  select 'client_wrappers_granted',
    (
      select fn.ctx_oid is null or fn.open_oid is null or fn.move_oid is null or fn.close_oid is null or fn.sale_oid is null
        or not (
          coalesce(has_function_privilege('authenticated', fn.ctx_oid, 'EXECUTE'), false)
          and coalesce(has_function_privilege('authenticated', fn.open_oid, 'EXECUTE'), false)
          and coalesce(has_function_privilege('authenticated', fn.move_oid, 'EXECUTE'), false)
          and coalesce(has_function_privilege('authenticated', fn.close_oid, 'EXECUTE'), false)
          and coalesce(has_function_privilege('authenticated', fn.sale_oid, 'EXECUTE'), false)
        )
      from fn
    ),
    (
      select jsonb_build_object(
        'get_station_cash_context', case when fn.ctx_oid is null then null
          else has_function_privilege('authenticated', fn.ctx_oid, 'EXECUTE') end,
        'record_station_cash_sale', case when fn.sale_oid is null then null
          else has_function_privilege('authenticated', fn.sale_oid, 'EXECUTE') end
      )
      from fn
    )

  union all
  select 'internal_resolver_denied',
    (
      select fn.resolve_oid is not null
        and coalesce(has_function_privilege('authenticated', fn.resolve_oid, 'EXECUTE'), false)
      from fn
    ),
    (
      select jsonb_build_object(
        'resolve_denied', case when fn.resolve_oid is null then null
          else not has_function_privilege('authenticated', fn.resolve_oid, 'EXECUTE') end
      )
      from fn
    )

  union all
  select 'movement_impl_denied',
    (
      select fn.impl_oid is not null
        and coalesce(has_function_privilege('authenticated', fn.impl_oid, 'EXECUTE'), false)
      from fn
    ),
    jsonb_build_object('impl_denied', true)

  union all
  select 'bind_and_replay_denied',
    (
      select (fn.bind_oid is not null and coalesce(has_function_privilege('authenticated', fn.bind_oid, 'EXECUTE'), false))
        or (fn.replay_oid is not null and coalesce(has_function_privilege('authenticated', fn.replay_oid, 'EXECUTE'), false))
      from fn
    ),
    (
      select jsonb_build_object(
        'bind_denied', case when fn.bind_oid is null then null
          else not has_function_privilege('authenticated', fn.bind_oid, 'EXECUTE') end,
        'replay_denied', case when fn.replay_oid is null then null
          else not has_function_privilege('authenticated', fn.replay_oid, 'EXECUTE') end
      )
      from fn
    )

  union all
  select 'idempotency_helpers_internal',
    (
      select (fn.begin_oid is not null and coalesce(has_function_privilege('authenticated', fn.begin_oid, 'EXECUTE'), false))
        or (fn.complete_oid is not null and coalesce(has_function_privilege('authenticated', fn.complete_oid, 'EXECUTE'), false))
      from fn
    ),
    (
      select jsonb_build_object(
        'begin_denied', case when fn.begin_oid is null then null
          else not has_function_privilege('authenticated', fn.begin_oid, 'EXECUTE') end
      )
      from fn
    )

  union all
  select 'human_045_rpc_still_present',
    not (
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'open_cash_session')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_cash_movement')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'close_cash_session')
    ),
    jsonb_build_object('human_rpcs_intact', true)

  union all
  select 'flag_still_disabled',
    coalesce(public.operational_stations_enabled(), false),
    jsonb_build_object('enabled', coalesce(public.operational_stations_enabled(), false))

  union all
  select 'idempotency_row_count',
    false,
    jsonb_build_object(
      'operational_station_cash_idempotency', (
        select case when idempotency_rel.relid is null then null
          else (select count(*) from public.operational_station_cash_idempotency) end
        from idempotency_rel
      )
    )
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
