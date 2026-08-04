-- Postflight 200 — read-only verification after applying audit actor fix.
-- Single result grid; inspect SECURITY DEFINER/search_path via pg_proc.proconfig.

with fn as (
  select
    coalesce(
      pg_get_functiondef('public.audit_pos_order_change()'::regprocedure),
      ''
    ) as audit_def,
    coalesce(
      pg_get_functiondef(
        'public.pos_order_event_actor_profile(uuid, uuid, uuid)'::regprocedure
      ),
      ''
    ) as actor_def
),
fn_proc as (
  select
    'audit_pos_order_change'::text as fn_label,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.audit_pos_order_change()'::regprocedure

  union all

  select
    'pos_order_event_actor_profile'::text,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.pos_order_event_actor_profile(uuid, uuid, uuid)'::regprocedure
),
proc_safe as (
  select
    fp.fn_label,
    coalesce(fp.prosecdef, false) as prosecdef,
    coalesce(
      fp.prosecdef = true
      and (
        select count(*) = 1
        from unnest(coalesce(fp.proconfig, array[]::text[])) cfg
        where lower(trim(split_part(cfg, '=', 1))) = 'search_path'
          and nullif(trim(both '"' from trim(split_part(cfg, '=', 2))), '') is null
      ),
      false
    ) as safe_definer_search_path
  from fn_proc fp
),
markers as (
  select
    fn.*,
    to_regprocedure('public.audit_pos_order_change()') is not null as audit_exists,
    to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') is not null as actor_helper_exists,
    position('pos_order_event_actor_profile' in fn.audit_def) > 0 as audit_uses_helper,
    position('STATION_POS_AUDIT_ACTOR_INVALID' in fn.actor_def) > 0 as actor_invalid_code,
    position('owner_profile_id' in fn.actor_def) > 0 as actor_reads_owner,
    position('waiter_id' in fn.actor_def) > 0 as actor_reads_waiter,
    not has_function_privilege('public', 'public.pos_order_event_actor_profile(uuid, uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.pos_order_event_actor_profile(uuid, uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.pos_order_event_actor_profile(uuid, uuid, uuid)', 'EXECUTE')
    as actor_acl_ok,
    case
      when position('pos_order_event_actor_profile' in fn.audit_def) > 0
        and to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') is not null
        and position('STATION_POS_AUDIT_ACTOR_INVALID' in fn.actor_def) > 0
      then '200_fully_present'
      when to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') is null
        and position('auth.uid()' in fn.audit_def) > 0
      then 'needs_200'
      else '200_partial_or_unknown'
    end as migration_state
  from fn
),
gates_base (
  gate_code,
  gate_passed,
  blocker_when_failed,
  detail
) as (
  select
    '200-F1-migration_state_fully_present'::text,
    (select migration_state from markers) = '200_fully_present',
    true,
    (select migration_state from markers)::text

  union all

  select
    '200-F2-audit_trigger_exists',
    (select audit_exists from markers),
    true,
    'audit_pos_order_change present'

  union all

  select
    '200-F3-actor_helper_exists',
    (select actor_helper_exists from markers),
    true,
    'pos_order_event_actor_profile present'

  union all

  select
    '200-F4-audit_uses_helper',
    (select audit_uses_helper from markers),
    true,
    'audit_pos_order_change delegates created_by via pos_order_event_actor_profile'

  union all

  select
    '200-F5-actor_invalid_code',
    (select actor_invalid_code from markers),
    true,
    'STATION_POS_AUDIT_ACTOR_INVALID raised when no profile'

  union all

  select
    '200-F6-actor_reads_owner_and_waiter',
    (select actor_reads_owner and actor_reads_waiter from markers),
    true,
    'helper resolves owner_profile_id and waiter_id server-side'

  union all

  select
    '200-F7-audit_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'audit_pos_order_change'),
      false
    ),
    true,
    'audit_pos_order_change SECURITY DEFINER + exactly one empty search_path'

  union all

  select
    '200-F8-actor_security_definer_search_path',
    coalesce(
      (select safe_definer_search_path from proc_safe where fn_label = 'pos_order_event_actor_profile'),
      false
    ),
    true,
    'pos_order_event_actor_profile SECURITY DEFINER + exactly one empty search_path'

  union all

  select
    '200-F9-actor_not_executable_by_clients',
    (select actor_acl_ok from markers),
    true,
    'pos_order_event_actor_profile not EXECUTE for public/anon/authenticated'

  union all

  select
    '200-F10-audit_signature_preserved',
    to_regprocedure('public.audit_pos_order_change()') is not null,
    true,
    'audit_pos_order_change() trigger signature preserved'

  union all

  select
    '200-F11-actor_signature_preserved',
    to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') is not null,
    true,
    'pos_order_event_actor_profile(uuid, uuid, uuid) signature preserved'

  union all

  select
    '200-F12-migration_state_not_partial',
    (select migration_state from markers) <> '200_partial_or_unknown',
    true,
    case
      when (select migration_state from markers) = '200_partial_or_unknown'
        then 'BLOCKER: partial/unknown 200 state'
      else (select migration_state from markers)::text
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
  select bool_and(gate_passed) as ready_after_200
  from gates_base
)
select
  g.gate_code,
  g.gate_passed,
  g.is_blocker,
  g.detail,
  r.ready_after_200
from gates g
cross join ready r
order by g.is_blocker desc, g.gate_code;
