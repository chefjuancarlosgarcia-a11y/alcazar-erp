-- Forward-only rollback for 187_pos_table_service_lifecycle.sql
-- Does NOT delete pos_orders, items, tickets, payments, or events.
-- Idempotency rows in pos_rpc_idempotency are retained (audit trail).

drop index if exists public.pos_orders_one_active_service_per_table;

drop function if exists public.open_pos_table_service(text, text, text, text, text, uuid, uuid, text, text, text, uuid);
drop function if exists public.release_pos_table_service(uuid, text, uuid, boolean);

drop function if exists public.pos_load_rpc_idempotency(uuid, text);
drop function if exists public.pos_store_rpc_idempotency(uuid, text, text, text, jsonb);
drop function if exists public.pos_rpc_fingerprint(text[]);
drop function if exists public.pos_assert_release_authorized(uuid, text);
drop function if exists public.pos_classify_release_scenario(uuid);
drop function if exists public.pos_table_has_billing_block(text);
drop function if exists public.pos_table_has_reusable_active_order(text);
drop function if exists public.pos_table_is_zombie_open(text);
drop function if exists public.pos_order_has_payments(uuid);
drop function if exists public.pos_order_ever_sent_to_kds(uuid);
drop function if exists public.pos_order_has_active_items(uuid);
drop function if exists public.is_order_owner(uuid);
drop function if exists public.is_pos_elevated_supervisor();
drop function if exists public.is_pos_admin();
drop function if exists public.is_pos_general_manager();
drop function if exists public.is_pos_supervisor();
drop function if exists public.pos_table_service_active_statuses();

-- Restore pre-187 floor helper semantics (065 original)
create or replace function public.pos_floor_has_open_orders(
  p_table_id text default null,
  p_area_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.status not in ('paid', 'cancelled')
      and (
        (p_table_id is not null and o.table_id = p_table_id)
        or (p_area_id is not null and o.area_id = p_area_id)
      )
  );
$$;

revoke all on function public.pos_floor_has_open_orders(text, text) from public;
grant execute on function public.pos_floor_has_open_orders(text, text) to authenticated;
grant execute on function public.pos_floor_has_open_orders(text, text) to service_role;

-- Optional: drop idempotency table only in controlled maintenance (commented — preserves audit data)
-- drop table if exists public.pos_rpc_idempotency;

-- Frontend: revert to createOrGetOpenOrder SELECT+INSERT path via feature flag removal.
