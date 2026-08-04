-- Postflight 200 — read-only verification after applying audit actor fix.

with fn as (
  select
    coalesce(
      pg_get_functiondef('public.audit_pos_order_change()'::regprocedure),
      ''
    ) as audit_def
),
actor_acl as (
  select
    not has_function_privilege('public', 'public.pos_order_event_actor_profile(uuid, uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.pos_order_event_actor_profile(uuid, uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.pos_order_event_actor_profile(uuid, uuid, uuid)', 'EXECUTE')
    as actor_not_public
),
markers as (
  select
    fn.*,
    position('pos_order_event_actor_profile' in audit_def) > 0 as audit_uses_helper,
    position('STATION_POS_AUDIT_ACTOR_INVALID' in pg_get_functiondef(
      'public.pos_order_event_actor_profile(uuid, uuid, uuid)'::regprocedure
    )) > 0 as actor_invalid_code,
    (select actor_not_public from actor_acl) as actor_acl_ok
  from fn
)
select
  gate_code,
  gate_passed,
  is_blocker,
  detail
from (
  select
    '200-F1-audit_uses_helper'::text,
    (select audit_uses_helper from markers),
    true,
    'audit_pos_order_change delegates created_by via pos_order_event_actor_profile'

  union all

  select
    '200-F2-actor_helper_exists',
    to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') is not null,
    true,
    'helper function present'

  union all

  select
    '200-F3-actor_invalid_code',
    (select actor_invalid_code from markers),
    true,
    'STATION_POS_AUDIT_ACTOR_INVALID raised when no profile'

  union all

  select
    '200-F4-actor_not_executable_by_clients',
    (select actor_acl_ok from markers),
    true,
    'pos_order_event_actor_profile not EXECUTE for public/anon/authenticated'

  union all

  select
    'ready_after_200',
    (select audit_uses_helper and actor_invalid_code and actor_acl_ok from markers),
    true,
    case
      when (select audit_uses_helper and actor_invalid_code and actor_acl_ok from markers)
        then '200 postflight OK'
      else '200 incomplete — review markers'
    end
) gates
order by gate_code;
