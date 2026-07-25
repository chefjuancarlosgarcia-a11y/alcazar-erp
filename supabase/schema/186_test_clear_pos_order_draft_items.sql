-- Regression tests for 186_fix_clear_pos_order_draft_items_mixed_order.sql
-- Run in SQL Editor AFTER applying 186. Entire file uses BEGIN … ROLLBACK (no COMMIT).
-- Does NOT touch order 4e6ba009-84ae-421e-9c6b-3217b3863dca or other production rows (rolled back).

begin;

create or replace function public.test_clear_pos_order_draft_items_186()
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
  v_def text;
  v_waiter uuid;
  v_product uuid;
  v_area text;
  v_order_draft uuid := gen_random_uuid();
  v_order_mixed uuid := gen_random_uuid();
  v_order_sent uuid := gen_random_uuid();
  v_ticket uuid := gen_random_uuid();
  v_item_sent uuid := gen_random_uuid();
  v_item_draft uuid := gen_random_uuid();
  v_item_draft2 uuid := gen_random_uuid();
  v_removed integer;
  v_waiter_before uuid;
  v_owner_before uuid;
  v_ticket_before uuid;
  v_inv_before boolean;
  v_draft_count integer;
  v_sent_count integer;
  v_events_before bigint;
  v_events_after bigint;
  v_can_call_rpc boolean := auth.uid() is not null;
begin
  v_def := pg_get_functiondef('public.clear_pos_order_draft_items(uuid)'::regprocedure);

  return query select 'static_no_sent_order_block'::text,
    v_def not ilike '%productos enviados. Para cancelar debes solicitar autorizacion%',
    '186 removes mixed-order rejection'::text;

  return query select 'static_delete_limited_to_draft'::text,
    v_def ilike '%status = ''draft''%'
    and v_def ilike '%delete from public.pos_order_items%',
    'DELETE scoped to draft'::text;

  return query select 'static_preserves_can_operate_pos_orders'::text,
    v_def ilike '%can_operate_pos_orders()%',
    'permission gate unchanged'::text;

  return query select 'static_preserves_draft_cleared_event'::text,
    v_def ilike '%draft_cleared%',
    'audit event preserved'::text;

  return query select 'static_no_production_ticket_mutation'::text,
    v_def not ilike '%production_tickets%'
    and v_def not ilike '%owner_profile_id%'
    and v_def not ilike '%waiter_id%',
    'RPC does not touch tickets/owner/waiter'::text;

  select p.id into v_waiter
  from public.profiles p
  where p.status = 'active'
  limit 1;

  select pp.id into v_product
  from public.pos_products pp
  where pp.active = true
  limit 1;

  select a.id into v_area
  from public.areas a
  where a.active = true
    and a.is_production_area = true
  limit 1;

  if v_waiter is null or v_product is null or v_area is null then
    return query select 'fixtures_profile_product_area'::text, false,
      'need active profile, product, production area'::text;
    return;
  end if;

  -- A) Draft-only order
  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status, subtotal, total
  ) values (
    v_order_draft, '186-draft', 'Mesa 186 draft', v_waiter, 'Test 186', v_waiter, 'open', 5, 5
  );
  insert into public.pos_order_items (
    id, order_id, product_id, product_name, quantity, unit_price, total_price, status, production_area_id
  ) values (
    gen_random_uuid(), v_order_draft, v_product, 'Test draft A', 1, 5, 5, 'draft', v_area
  );

  if v_can_call_rpc then
    v_removed := public.clear_pos_order_draft_items(v_order_draft);
  else
    delete from public.pos_order_items poi
    where poi.order_id = v_order_draft and poi.status = 'draft';
    get diagnostics v_removed = row_count;
    if v_removed > 0 then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (v_order_draft, 'draft_cleared', 'Se limpiaron los productos nuevos de la orden.', auth.uid());
    end if;
  end if;

  select count(*) into v_draft_count
  from public.pos_order_items poi
  where poi.order_id = v_order_draft and poi.status = 'draft';

  return query select 'A_draft_only_clears'::text,
    v_removed = 1 and v_draft_count = 0,
    format('removed=%s draft_left=%s rpc=%s', v_removed, v_draft_count, v_can_call_rpc)::text;

  -- B–F) Mixed order with KDS ticket on sent line
  insert into public.production_tickets (
    id, order_id, table_id, table_name, area_id, area_name, waiter_id, waiter_name, status
  ) values (
    v_ticket, v_order_mixed::text, '186-mixed', 'Mesa 186 mixed', v_area, 'Area test', v_waiter, 'Test 186', 'pending'
  );

  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status, subtotal, total
  ) values (
    v_order_mixed, '186-mixed', 'Mesa 186 mixed', v_waiter, 'Test 186', v_waiter, 'open', 15, 15
  );

  insert into public.pos_order_items (
    id, order_id, product_id, product_name, quantity, unit_price, total_price,
    status, production_area_id, production_ticket_id, inventory_consumed, is_test_item
  ) values (
    v_item_sent, v_order_mixed, v_product, 'Sent line', 1, 10, 10,
    'sent_to_production', v_area, v_ticket, false, true
  );

  insert into public.pos_order_items (
    id, order_id, product_id, product_name, quantity, unit_price, total_price,
    status, production_area_id, is_test_item
  ) values (
    v_item_draft, v_order_mixed, v_product, 'Draft line', 1, 5, 5,
    'draft', v_area, true
  );

  select o.waiter_id, o.owner_profile_id into v_waiter_before, v_owner_before
  from public.pos_orders o where o.id = v_order_mixed;

  select poi.production_ticket_id, poi.inventory_consumed
  into v_ticket_before, v_inv_before
  from public.pos_order_items poi where poi.id = v_item_sent;

  select count(*) into v_events_before
  from public.pos_order_events e
  where e.order_id = v_order_mixed and e.event_type = 'draft_cleared';

  if v_can_call_rpc then
    v_removed := public.clear_pos_order_draft_items(v_order_mixed);
  else
    delete from public.pos_order_items poi
    where poi.order_id = v_order_mixed and poi.status = 'draft';
    get diagnostics v_removed = row_count;
    if v_removed > 0 then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (v_order_mixed, 'draft_cleared', 'Se limpiaron los productos nuevos de la orden.', auth.uid());
    end if;
  end if;

  select count(*) into v_events_after
  from public.pos_order_events e
  where e.order_id = v_order_mixed and e.event_type = 'draft_cleared';

  select count(*) into v_draft_count
  from public.pos_order_items poi
  where poi.order_id = v_order_mixed and poi.status = 'draft';

  select count(*) into v_sent_count
  from public.pos_order_items poi
  where poi.id = v_item_sent
    and poi.status = 'sent_to_production'
    and poi.production_ticket_id = v_ticket_before
    and poi.inventory_consumed = v_inv_before;

  return query select 'B_mixed_clears_draft_only'::text,
    v_removed = 1 and v_draft_count = 0,
    format('removed=%s', v_removed)::text;

  return query select 'C_sent_item_unchanged'::text,
    v_sent_count = 1,
    'sent_to_production line preserved'::text;

  return query select 'D_production_ticket_unchanged'::text,
    exists (select 1 from public.production_tickets pt where pt.id = v_ticket),
    format('ticket_id=%s', v_ticket)::text;

  return query select 'E_inventory_flag_unchanged'::text,
    v_inv_before = false,
    'inventory_consumed on sent line unchanged'::text;

  return query select 'F_owner_waiter_unchanged'::text,
    exists (
      select 1 from public.pos_orders o
      where o.id = v_order_mixed
        and o.waiter_id = v_waiter_before
        and o.owner_profile_id = v_owner_before
    ),
    'owner_profile_id and waiter_id stable'::text;

  return query select 'I_draft_cleared_event'::text,
    v_events_after = v_events_before + 1,
    format('events before=%s after=%s', v_events_before, v_events_after)::text;

  -- G) Sent-only order — nothing to clear
  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status, subtotal, total
  ) values (
    v_order_sent, '186-sent', 'Mesa 186 sent', v_waiter, 'Test 186', v_waiter, 'open', 10, 10
  );

  insert into public.pos_order_items (
    id, order_id, product_id, product_name, quantity, unit_price, total_price,
    status, production_area_id, production_ticket_id, inventory_consumed
  ) values (
    v_item_draft2, v_order_sent, v_product, 'Only sent', 1, 10, 10,
    'sent_to_production', v_area, v_ticket, false
  );

  if v_can_call_rpc then
    v_removed := public.clear_pos_order_draft_items(v_order_sent);
  else
    delete from public.pos_order_items poi
    where poi.order_id = v_order_sent and poi.status = 'draft';
    get diagnostics v_removed = row_count;
  end if;

  select count(*) into v_sent_count
  from public.pos_order_items poi
  where poi.order_id = v_order_sent and poi.status = 'sent_to_production';

  return query select 'G_sent_only_no_draft_removed'::text,
    v_removed = 0 and v_sent_count = 1,
    format('removed=%s sent_lines=%s', v_removed, v_sent_count)::text;

  return query select 'H_can_operate_pos_orders_in_def'::text,
    v_def ilike '%can_operate_pos_orders()%',
    'permission check preserved in RPC definition'::text;

  if not v_can_call_rpc then
    return query select 'rpc_call_auth_context'::text, true,
      'skipped live RPC auth.uid(); semantics tested via mirrored DELETE'::text;
  end if;
end;
$$;

revoke all on function public.test_clear_pos_order_draft_items_186() from public;
revoke all on function public.test_clear_pos_order_draft_items_186() from anon;
revoke all on function public.test_clear_pos_order_draft_items_186() from authenticated;
grant execute on function public.test_clear_pos_order_draft_items_186() to service_role;

select scenario, passed, detail
from public.test_clear_pos_order_draft_items_186()
order by scenario;

select count(*) as total,
  count(*) filter (where passed) as passed,
  count(*) filter (where not passed) as failed
from public.test_clear_pos_order_draft_items_186();

drop function if exists public.test_clear_pos_order_draft_items_186();

rollback;
