-- Preflight 200 — read-only gates before applying station POS audit actor fix.
-- Single result grid; inspect SECURITY DEFINER/search_path via pg_proc.proconfig.

with fn as (
  select
    coalesce(
      pg_get_functiondef('public.audit_pos_order_change()'::regprocedure),
      ''
    ) as audit_def,
    to_regprocedure('public.audit_pos_order_change()') as audit_oid,
    to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') as actor_fn_oid
),
fn_proc as (
  select
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.audit_pos_order_change()'::regprocedure
),
proc_safe as (
  select
    coalesce(fp.prosecdef, false) as audit_prosecdef,
    coalesce(
      fp.prosecdef = true
      and (
        select count(*) = 1
        from unnest(coalesce(fp.proconfig, array[]::text[])) cfg
        where lower(trim(split_part(cfg, '=', 1))) = 'search_path'
          and nullif(trim(both '"' from trim(split_part(cfg, '=', 2))), '') is null
      ),
      false
    ) as audit_safe_search_path
  from fn
  left join fn_proc fp on true
),
markers as (
  select
    fn.audit_def,
    fn.audit_oid is not null as audit_exists,
    position('pos_order_event_actor_profile' in fn.audit_def) > 0 as audit_uses_actor_helper,
    position('auth.uid()' in fn.audit_def) > 0 as audit_still_has_auth_uid,
    fn.actor_fn_oid is not null as actor_helper_exists,
    ps.audit_prosecdef,
    ps.audit_safe_search_path,
    case
      when position('pos_order_event_actor_profile' in fn.audit_def) > 0
        and fn.actor_fn_oid is not null
      then '200_fully_present'
      when fn.actor_fn_oid is null
        and position('auth.uid()' in fn.audit_def) > 0
      then 'needs_200'
      else '200_partial_or_unknown'
    end as migration_state
  from fn
  cross join proc_safe ps
),
gates_base (
  gate_code,
  gate_passed,
  blocker_when_failed,
  detail
) as (
  select
    '200-P1-audit_trigger_exists'::text,
    (select audit_exists from markers),
    true,
    case
      when (select audit_exists from markers) then 'audit_pos_order_change present'
      else 'audit_pos_order_change must exist'
    end

  union all

  select
    '200-P2-pos_order_events_fk',
    exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'pos_order_events'
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid) like '%profiles%'
    ),
    true,
    'pos_order_events.created_by FK to profiles'

  union all

  select
    '200-P3-migration_state_needs_200',
    (select migration_state from markers) = 'needs_200',
    false,
    case
      when (select migration_state from markers) = 'needs_200'
        then 'needs_200 — OK to apply 200_fix_station_pos_audit_actor.sql'
      when (select migration_state from markers) = '200_fully_present'
        then 'Already applied — do not reapply'
      else (select migration_state from markers)::text
    end

  union all

  select
    '200-P4-migration_state_not_partial',
    (select migration_state from markers) <> '200_partial_or_unknown',
    true,
    case
      when (select migration_state from markers) = '200_partial_or_unknown'
        then 'BLOCKER: partial/unknown 200 state — review before apply'
      else (select migration_state from markers)::text
    end

  union all

  select
    '200-P5-audit_security_definer',
    (select audit_prosecdef from markers),
    true,
    case
      when (select audit_prosecdef from markers)
        then 'audit_pos_order_change is SECURITY DEFINER'
      else 'audit_pos_order_change must be SECURITY DEFINER'
    end

  union all

  select
    '200-P6-audit_safe_search_path',
    (select audit_safe_search_path from markers),
    true,
    case
      when (select audit_safe_search_path from markers)
        then 'audit_pos_order_change has exactly one empty search_path (pg_proc.proconfig)'
      else 'unsafe or missing empty search_path on audit_pos_order_change'
    end

  union all

  select
    '200-P7-requires_196_operational_station_devices',
    to_regclass('public.operational_station_devices') is not null,
    true,
    case
      when to_regclass('public.operational_station_devices') is not null
        then '196 foundation present'
      else 'apply 196 first'
    end

  union all

  select
    '200-P8-requires_198_open_station_pos_table_service',
    to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null,
    true,
    case
      when to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null
        then '198 open wrapper present'
      else 'apply 198 first'
    end

  union all

  select
    '200-P9-requires_198_add_station_pos_order_item',
    to_regprocedure('public.add_station_pos_order_item(text, uuid, uuid, numeric, text, uuid, jsonb, jsonb, text)') is not null,
    true,
    case
      when to_regprocedure('public.add_station_pos_order_item(text, uuid, uuid, numeric, text, uuid, jsonb, jsonb, text)') is not null
        then '198 add wrapper present'
      else 'apply 198 first'
    end

  union all

  select
    '200-P10-requires_198_get_station_pos_context',
    to_regprocedure('public.get_station_pos_context(text)') is not null,
    true,
    case
      when to_regprocedure('public.get_station_pos_context(text)') is not null
        then '198 context wrapper present'
      else 'apply 198 first'
    end

  union all

  select
    '200-P11-requires_199_station_pos_markers',
    (
      position(
        'STATION_POS_ORDER_OWNER_MISMATCH' in coalesce(
          pg_get_functiondef(
            'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure
          ),
          ''
        )
      ) > 0
      and position(
        '''image_url''' in coalesce(
          pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure),
          ''
        )
      ) > 0
    ),
    true,
    case
      when (
        position(
          'STATION_POS_ORDER_OWNER_MISMATCH' in coalesce(
            pg_get_functiondef(
              'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure
            ),
            ''
          )
        ) > 0
        and position(
          '''image_url''' in coalesce(
            pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure),
            ''
          )
        ) > 0
      )
        then '199 parity markers present'
      else 'apply 199 first'
    end

  union all

  select
    '200-P12-operational_stations_enabled_false',
    not public.operational_stations_enabled(),
    true,
    case
      when public.operational_stations_enabled()
        then 'ENABLED — do not apply without review'
      else 'false ok'
    end

  union all

  select
    '200-P13-operational_station_pos_enabled_false',
    not public.operational_station_pos_enabled(),
    true,
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
    (blocker_when_failed and not gate_passed) as is_blocker,
    detail
  from gates_base
),
ready as (
  select bool_and(gate_passed) as ready_to_apply_200
  from gates_base
)
select
  g.gate_code,
  g.gate_passed,
  g.is_blocker,
  g.detail,
  r.ready_to_apply_200
from gates g
cross join ready r
order by g.is_blocker desc, g.gate_code;
