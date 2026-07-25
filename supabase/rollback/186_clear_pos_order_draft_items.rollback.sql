-- Rollback forward: restore pre-186 clear_pos_order_draft_items (blocks mixed orders).
-- Does NOT delete data. Re-apply frontend guard in POS.jsx handleClearDraftItems if reverting UI.
-- Apply only if 186 caused regression.

begin;

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
  if exists (
    select 1 from public.pos_order_items
    where order_id = p_order_id and status <> 'draft' and status <> 'cancelled'
  ) then
    raise exception 'Esta orden ya tiene productos enviados. Para cancelar debes solicitar autorizacion.';
  end if;
  delete from public.pos_order_items where order_id = p_order_id and status = 'draft';
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

commit;

-- Frontend rollback (manual): restore in POS.jsx handleClearDraftItems:
--   if (sentItems.length > 0) {
--     setOrdenError("Esta orden ya tiene productos enviados. Para cancelar debes solicitar autorizacion.")
--     return
--   }
