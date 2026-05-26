-- Fix POS audit trigger when order totals update after adding an item.
-- Apply after 010_pos_orders.sql.

create or replace function public.audit_pos_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'pos_orders' then
    if tg_op = 'INSERT' then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (new.id, 'order_created', 'Orden creada para ' || coalesce(new.table_name, 'mesa'), auth.uid());
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (
        new.id, 'order_' || new.status,
        'Estado de la orden actualizado a ' || new.status || '.', auth.uid()
      );
    end if;
    return new;
  end if;

  if tg_table_name = 'pos_order_items' then
    if tg_op = 'INSERT' then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (new.order_id, 'item_added', new.product_name || ' agregado a la orden.', auth.uid());
      return new;
    elsif tg_op = 'UPDATE' then
      if new.quantity is distinct from old.quantity then
        insert into public.pos_order_events (order_id, event_type, description, created_by)
        values (
          new.order_id, 'item_updated',
          new.product_name || ': cantidad actualizada a ' || new.quantity::text || '.',
          auth.uid()
        );
      elsif new.notes is distinct from old.notes then
        insert into public.pos_order_events (order_id, event_type, description, created_by)
        values (new.order_id, 'item_updated', new.product_name || ': notas actualizadas.', auth.uid());
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (old.order_id, 'item_removed', old.product_name || ' eliminado de productos nuevos.', auth.uid());
      return old;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
