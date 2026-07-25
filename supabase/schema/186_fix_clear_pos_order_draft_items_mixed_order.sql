-- Fix: allow clearing draft POS items on mixed orders (draft + sent_to_production).
-- Root cause: clear_pos_order_draft_items rejected orders with any non-draft item.
-- Apply after 185_fix_send_pos_order_product_ambiguity.sql (or latest schema).
-- Does NOT change sent items, KDS tickets, inventory, owner/waiter, or post-send authorization flows.

create or replace function public.clear_pos_order_draft_items(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para limpiar esta orden.';
  end if;

  delete from public.pos_order_items
  where order_id = p_order_id
    and status = 'draft';

  get diagnostics removed_count = row_count;

  if removed_count > 0 then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (p_order_id, 'draft_cleared', 'Se limpiaron los productos nuevos de la orden.', auth.uid());
  end if;

  return removed_count;
end;
$$;

revoke all on function public.clear_pos_order_draft_items(uuid) from public;
grant execute on function public.clear_pos_order_draft_items(uuid) to authenticated;
