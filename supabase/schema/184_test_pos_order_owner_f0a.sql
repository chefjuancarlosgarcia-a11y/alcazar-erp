-- F0A — Stage/QA tests only. Do NOT apply to production unless validating migration.
-- Run in Supabase SQL Editor after 184_pos_order_owner_f0a.sql

create or replace function public.test_pos_order_owner_f0a_rules()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_order uuid;
  v_blocked boolean := false;
  v_err text;
begin
  return query select 'migration_owner_column_exists'::text,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pos_orders'
        and column_name = 'owner_profile_id'
    ), 'column owner_profile_id'::text;

  return query select 'migration_owner_fk_exists'::text,
    exists (
      select 1 from pg_constraint where conname = 'pos_orders_owner_profile_id_fkey'
    ), 'FK owner_profile_id'::text;

  return query select 'migration_sync_trigger_exists'::text,
    exists (
      select 1 from pg_trigger
      where tgname = 'sync_pos_order_owner_legacy'
        and tgrelid = 'public.pos_orders'::regclass
        and not tgisinternal
    ),
    'sync_pos_order_owner_legacy present'::text;

  return query select 'internal_owner_rpc_absent'::text,
    to_regprocedure('public.set_pos_order_owner_internal(uuid, uuid, text)') is null,
    'set_pos_order_owner_internal removed from F0A'::text;

  return query select 'diagnose_integrity_not_authenticated'::text,
    not has_function_privilege('authenticated', 'public.diagnose_pos_order_owner_integrity()', 'EXECUTE'),
    'diagnose_pos_order_owner_integrity'::text;

  return query select 'diagnose_orphans_not_authenticated'::text,
    not has_function_privilege('authenticated', 'public.diagnose_pos_order_owner_orphans()', 'EXECUTE'),
    'diagnose_pos_order_owner_orphans'::text;

  return query select 'diagnose_orphans_service_role'::text,
    has_function_privilege('service_role', 'public.diagnose_pos_order_owner_orphans()', 'EXECUTE'),
    'orphans diagnostic for service_role'::text;

  return query select 'backfill_no_mismatch_when_both_set'::text,
    not exists (
      select 1 from public.pos_orders o
      where o.owner_profile_id is not null and o.waiter_id is not null
        and o.owner_profile_id <> o.waiter_id
    ), 'owner/waiter aligned after backfill'::text;

  return query select 'ranking_function_uses_owner_coalesce'::text,
    pg_get_functiondef('public.get_waiter_sales_ranking(date, boolean)'::regprocedure)
      ilike '%coalesce(o.owner_profile_id, o.waiter_id)%',
    'ranking coalesce'::text;

  select o.id into v_order from public.pos_orders o order by o.created_at desc limit 1;

  if v_order is null then
    return query select 'guard_blocks_owner_update'::text, true, 'skipped — no orders'::text;
    return query select 'guard_blocks_waiter_update'::text, true, 'skipped — no orders'::text;
    return query select 'guard_blocks_both_update'::text, true, 'skipped — no orders'::text;
    return query select 'status_update_allowed'::text, true, 'skipped — no orders'::text;
    return query select 'insert_mismatch_rejected'::text, true, 'skipped — no fixture'::text;
    return;
  end if;

  begin
    update public.pos_orders set owner_profile_id = gen_random_uuid() where id = v_order;
    v_blocked := false;
  exception when others then
    v_blocked := sqlerrm ilike '%POS_ORDER_OWNER_IMMUTABLE%';
  end;
  return query select 'guard_blocks_owner_update'::text, v_blocked, 'UPDATE owner only'::text;

  begin
    update public.pos_orders set waiter_id = gen_random_uuid() where id = v_order;
    v_blocked := false;
  exception when others then
    v_blocked := sqlerrm ilike '%POS_ORDER_OWNER_IMMUTABLE%';
  end;
  return query select 'guard_blocks_waiter_update'::text, v_blocked, 'UPDATE waiter only'::text;

  begin
    update public.pos_orders
    set owner_profile_id = gen_random_uuid(), waiter_id = gen_random_uuid()
    where id = v_order;
    v_blocked := false;
  exception when others then
    v_blocked := sqlerrm ilike '%POS_ORDER_OWNER_IMMUTABLE%';
  end;
  return query select 'guard_blocks_both_update'::text, v_blocked, 'UPDATE both'::text;

  begin
    update public.pos_orders
    set status = status
    where id = v_order;
    return query select 'status_update_allowed'::text, true, 'status-only UPDATE'::text;
  exception when others then
    return query select 'status_update_allowed'::text, false, sqlerrm;
  end;

  begin
    insert into public.pos_orders (
      table_id, table_name, waiter_id, owner_profile_id, status, subtotal, total
    ) values (
      'f0a-test', 'Mesa test', gen_random_uuid(), gen_random_uuid(), 'open', 0, 0
    );
    return query select 'insert_mismatch_rejected'::text, false, 'mismatch insert succeeded'::text;
  exception when others then
    v_err := sqlerrm;
    return query select 'insert_mismatch_rejected'::text,
      v_err ilike '%POS_ORDER_OWNER_WAITER_MISMATCH%',
      'INSERT owner<>waiter rejected'::text;
  end;
end;
$$;

revoke all on function public.test_pos_order_owner_f0a_rules() from public;
revoke all on function public.test_pos_order_owner_f0a_rules() from anon;
revoke all on function public.test_pos_order_owner_f0a_rules() from authenticated;
grant execute on function public.test_pos_order_owner_f0a_rules() to service_role;

select scenario, passed, detail from public.test_pos_order_owner_f0a_rules() order by scenario;

select count(*) as total,
  count(*) filter (where passed) as passed,
  count(*) filter (where not passed) as failed
from public.test_pos_order_owner_f0a_rules();
