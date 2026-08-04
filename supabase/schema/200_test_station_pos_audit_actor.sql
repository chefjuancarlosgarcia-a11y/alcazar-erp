-- Remote-safe structural verification for migration 200 (BEGIN … ROLLBACK).
-- Read-only: pg_catalog / pg_get_functiondef only.
-- Runtime actor/FK scenarios: 200_lab_station_pos_audit_actor_runtime.sql

begin;

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
    fp.prosecdef,
    (
      fp.prosecdef = true
      and exists (
        select 1
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
    position('pos_order_event_actor_profile' in audit_def) > 0 as audit_uses_helper,
    position('order_created' in audit_def) > 0 as audit_order_created,
    position('item_added' in audit_def) > 0 as audit_item_added,
    position('item_updated' in audit_def) > 0 as audit_item_updated,
    position('item_removed' in audit_def) > 0 as audit_item_removed,
    position('owner_profile_id' in actor_def) > 0 as actor_owner_pref,
    position('waiter_id' in actor_def) > 0 as actor_waiter_fallback,
    position('STATION_POS_AUDIT_ACTOR_INVALID' in actor_def) > 0 as actor_invalid_code,
    position('profiles' in actor_def) > 0 as actor_profiles_check,
    not has_function_privilege(
      'authenticated',
      'public.pos_order_event_actor_profile(uuid, uuid, uuid)',
      'EXECUTE'
    ) as actor_no_authenticated_execute
  from fn
),
scenarios as (
  select * from (
    values
      ('200-T1-audit_helper_wired', (select audit_uses_helper from markers),
       'audit_pos_order_change calls pos_order_event_actor_profile'),
      ('200-T2-audit_order_created', (select audit_order_created from markers),
       'order_created path preserved'),
      ('200-T3-audit_item_added', (select audit_item_added from markers),
       'item_added path preserved'),
      ('200-T4-audit_item_updated', (select audit_item_updated from markers),
       'item_updated path preserved'),
      ('200-T5-audit_item_removed', (select audit_item_removed from markers),
       'item_removed path preserved'),
      ('200-T6-actor_owner_preference', (select actor_owner_pref from markers),
       'actor helper reads owner_profile_id'),
      ('200-T7-actor_waiter_fallback', (select actor_waiter_fallback from markers),
       'actor helper falls back to waiter_id'),
      ('200-T8-actor_invalid_code', (select actor_invalid_code from markers),
       'STATION_POS_AUDIT_ACTOR_INVALID defined'),
      ('200-T9-actor_profiles_guard', (select actor_profiles_check from markers),
       'actor verifies profiles row exists'),
      ('200-T10-actor_acl', (select actor_no_authenticated_execute from markers),
       'helper not EXECUTE for authenticated'),
      ('200-T11-audit_search_path', (select safe_definer_search_path from proc_safe where fn_label = 'audit_pos_order_change'),
       'audit_pos_order_change empty search_path'),
      ('200-T12-actor_search_path', (select safe_definer_search_path from proc_safe where fn_label = 'pos_order_event_actor_profile'),
       'actor helper empty search_path')
  ) as t(scenario, passed, detail)
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where passed)::bigint as passed_total,
    count(*) filter (where not passed)::bigint as failed_total
  from scenarios
)
select
  s.scenario,
  s.passed,
  s.detail,
  sm.total,
  sm.passed_total,
  sm.failed_total
from scenarios s
cross join summary sm
order by s.scenario;

rollback;
