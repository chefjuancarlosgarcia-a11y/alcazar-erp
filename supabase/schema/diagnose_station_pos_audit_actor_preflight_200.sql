-- Preflight 200 — read-only gates before applying station POS audit actor fix.
-- Single result grid; inspect via pg_proc.proconfig (not functiondef text alone).

with fn as (
  select
    coalesce(
      pg_get_functiondef('public.audit_pos_order_change()'::regprocedure),
      ''
    ) as audit_def,
    to_regprocedure('public.pos_order_event_actor_profile(uuid, uuid, uuid)') as actor_fn_oid
),
fn_proc as (
  select
    p.prosecdef,
    p.proconfig
  from pg_proc p
  where p.oid = 'public.audit_pos_order_change()'::regprocedure
),
markers as (
  select
    fn.*,
    position('pos_order_event_actor_profile' in audit_def) > 0 as audit_uses_actor_helper,
    position('auth.uid()' in audit_def) > 0 as audit_still_has_auth_uid,
    fn.actor_fn_oid is not null as actor_helper_exists,
    case
      when position('pos_order_event_actor_profile' in audit_def) > 0
        and fn.actor_fn_oid is not null
      then '200_fully_present'
      when fn.actor_fn_oid is null
        and position('auth.uid()' in audit_def) > 0
      then 'needs_200'
      else '200_partial_or_unknown'
    end as migration_state
  from fn
  cross join fn_proc fp
)
select
  gate_code,
  gate_passed,
  is_blocker,
  detail
from (
  select
    '200-P1-audit_trigger_exists'::text as gate_code,
    to_regprocedure('public.audit_pos_order_change()') is not null as gate_passed,
    true as is_blocker,
    'audit_pos_order_change must exist'::text as detail

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
    '200-P3-needs_forward_fix',
    (select migration_state from markers) = 'needs_200',
    true,
    (select migration_state from markers)::text

  union all

  select
    '200-P4-audit_definer_search_path',
    (
      select fp.prosecdef = true
        and exists (
          select 1
          from unnest(coalesce(fp.proconfig, array[]::text[])) cfg
          where lower(trim(split_part(cfg, '=', 1))) = 'search_path'
            and nullif(trim(both '"' from trim(split_part(cfg, '=', 2))), '') is null
        )
      from fn_proc fp
    ),
    false,
    'audit_pos_order_change SECURITY DEFINER + empty search_path'

  union all

  select
    'ready_to_apply_200',
    (select migration_state from markers) = 'needs_200',
    true,
    case
      when (select migration_state from markers) = 'needs_200' then 'OK to apply 200_fix_station_pos_audit_actor.sql'
      when (select migration_state from markers) = '200_fully_present' then 'Already applied — do not reapply'
      else 'Review migration_state before apply'
    end
) gates
order by gate_code;
