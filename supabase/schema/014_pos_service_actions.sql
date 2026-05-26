-- Service actions for the operational POS view.
-- Apply after 013_realtime_operations.sql.

create or replace function public.mark_pos_order_item_served(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  served_item public.pos_order_items;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para marcar productos servidos.';
  end if;

  select * into served_item
  from public.pos_order_items
  where id = p_item_id
    and status = 'ready';
  if served_item.id is null then
    raise exception 'Solo puedes marcar servido un producto listo.';
  end if;

  update public.production_ticket_items
  set status = 'served'
  where ticket_id = served_item.production_ticket_id
    and order_item_id = served_item.id::text;

  if not found then
    update public.pos_order_items
    set status = 'served'
    where id = served_item.id;
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (served_item.order_id, 'production_served', served_item.product_name || ': servido.', auth.uid());
  end if;

  if served_item.production_ticket_id is not null
    and not exists (
      select 1 from public.production_ticket_items
      where ticket_id = served_item.production_ticket_id
        and status not in ('served', 'cancelled')
    ) then
    update public.production_tickets
    set status = 'served', served_at = now()
    where id = served_item.production_ticket_id;
  end if;
end;
$$;

create or replace function public.request_pos_order_bill(p_order_id uuid)
returns public.pos_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_order public.pos_orders;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para solicitar cuenta.';
  end if;
  if exists (
    select 1 from public.pos_order_items
    where order_id = p_order_id and status = 'draft'
  ) then
    raise exception 'Envía o quita los productos nuevos antes de solicitar cuenta.';
  end if;
  update public.pos_orders
  set status = 'awaiting_bill'
  where id = p_order_id
    and status = 'open'
    and exists (
      select 1 from public.pos_order_items
      where order_id = p_order_id and status <> 'cancelled'
    )
  returning * into updated_order;
  if updated_order.id is null then
    raise exception 'La orden no está disponible para solicitar cuenta.';
  end if;
  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (p_order_id, 'bill_requested', 'Cuenta solicitada por el mesero.', auth.uid());
  return updated_order;
end;
$$;

create or replace function public.send_pos_order_to_cashier(p_order_id uuid)
returns public.pos_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_order public.pos_orders;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para enviar cuentas a caja.';
  end if;
  update public.pos_orders
  set status = 'sent_to_cashier'
  where id = p_order_id
    and status = 'awaiting_bill'
  returning * into updated_order;
  if updated_order.id is null then
    raise exception 'Solicita la cuenta antes de enviarla a caja.';
  end if;
  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (p_order_id, 'sent_to_cashier', 'Cuenta enviada a caja.', auth.uid());
  return updated_order;
end;
$$;

revoke all on function public.mark_pos_order_item_served(uuid) from public;
revoke all on function public.request_pos_order_bill(uuid) from public;
revoke all on function public.send_pos_order_to_cashier(uuid) from public;
grant execute on function public.mark_pos_order_item_served(uuid) to authenticated;
grant execute on function public.request_pos_order_bill(uuid) to authenticated;
grant execute on function public.send_pos_order_to_cashier(uuid) to authenticated;
