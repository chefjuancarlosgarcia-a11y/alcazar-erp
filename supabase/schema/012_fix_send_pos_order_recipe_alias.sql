-- Fix ambiguous recipe alias in transactional POS dispatch.
-- Apply after 011_fix_pos_order_audit.sql.

create or replace function public.send_pos_order_to_production(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pos_order public.pos_orders;
  detail public.pos_order_items;
  product public.pos_products;
  recipe_row public.standard_recipes;
  required record;
  area_row record;
  ticket public.production_tickets;
  stock_before numeric;
  ticket_ids uuid[] := '{}'::uuid[];
  draft_count integer;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para enviar ordenes POS.';
  end if;

  select * into pos_order from public.pos_orders where id = p_order_id for update;
  if pos_order.id is null then raise exception 'La orden POS no existe.'; end if;
  if pos_order.status <> 'open' then raise exception 'Solo una orden abierta puede enviarse a produccion.'; end if;

  select count(*) into draft_count from public.pos_order_items
  where order_id = p_order_id and status = 'draft';
  if draft_count = 0 then raise exception 'No hay productos nuevos para enviar.'; end if;

  for detail in select * from public.pos_order_items where order_id = p_order_id and status = 'draft'
  loop
    if detail.product_id is null or detail.recipe_id is null or detail.production_area_id is null or not detail.production_ready then
      raise exception 'Producto % no esta listo para produccion.', detail.product_name;
    end if;
    select * into product from public.pos_products
      where id = detail.product_id and active = true and production_ready = true;
    select * into recipe_row from public.standard_recipes
      where id = detail.recipe_id and active = true and recipe_type = 'final_product';
    if product.id is null or recipe_row.id is null
      or product.recipe_id is distinct from detail.recipe_id
      or product.production_area_id is distinct from detail.production_area_id
      or recipe_row.production_area_id is distinct from detail.production_area_id then
      raise exception 'Producto % tiene receta o area de produccion invalida.', detail.product_name;
    end if;
  end loop;

  for required in
    select
      ingredient.inventory_item_id as item_id,
      max(ingredient.ingredient_name) as ingredient_name,
      max(ingredient.unit) as unit,
      order_item.production_area_id as area_id,
      max(area.name) as area_name,
      sum(ingredient.quantity * order_item.quantity) as quantity
    from public.pos_order_items order_item
    join public.standard_recipes recipe_source on recipe_source.id = order_item.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe_source.id
    join public.areas area on area.id = order_item.production_area_id
    where order_item.order_id = p_order_id and order_item.status = 'draft'
    group by ingredient.inventory_item_id, order_item.production_area_id
  loop
    select quantity into stock_before from public.area_inventory
      where item_id = required.item_id and area_id = required.area_id for update;
    stock_before := coalesce(stock_before, 0);
    if stock_before < required.quantity then
      raise exception 'No hay suficiente % en %. Disponible %, requerido %.',
        required.ingredient_name, required.area_name, stock_before, required.quantity;
    end if;
  end loop;

  for area_row in
    select distinct production_area_id as area_id
    from public.pos_order_items
    where order_id = p_order_id and status = 'draft'
  loop
    insert into public.production_tickets (
      order_id, table_id, table_name, area_id, area_name, waiter_id, waiter_name, status, priority, notes
    )
    select pos_order.id::text, pos_order.table_id, coalesce(pos_order.table_name, 'Orden POS'),
      area.id, area.name, pos_order.waiter_id, pos_order.waiter_name, 'pending', 'normal', pos_order.notes
    from public.areas area
    where area.id = area_row.area_id and area.active = true and area.is_production_area = true
    returning * into ticket;
    if ticket.id is null then raise exception 'El area de produccion % no esta activa.', area_row.area_id; end if;
    ticket_ids := array_append(ticket_ids, ticket.id);

    insert into public.production_ticket_items (
      ticket_id, order_item_id, product_id, product_name, quantity, notes, modifiers, status
    )
    select ticket.id, item.id::text, item.product_id, item.product_name, item.quantity,
      item.notes, item.modifiers, 'pending'
    from public.pos_order_items item
    where item.order_id = p_order_id and item.status = 'draft'
      and item.production_area_id = area_row.area_id;

    update public.pos_order_items
    set status = 'sent_to_production', inventory_consumed = true, production_ticket_id = ticket.id
    where order_id = p_order_id and status = 'draft'
      and production_area_id = area_row.area_id;

    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      pos_order.id, 'ticket_created',
      'Ticket creado en KDS para ' || ticket.area_name || '.', auth.uid()
    );
  end loop;

  for required in
    select
      ingredient.inventory_item_id as item_id,
      max(ingredient.ingredient_name) as ingredient_name,
      max(ingredient.unit) as unit,
      order_item.production_area_id as area_id,
      sum(ingredient.quantity * order_item.quantity) as quantity
    from public.pos_order_items order_item
    join public.standard_recipes recipe_source on recipe_source.id = order_item.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe_source.id
    where order_item.order_id = p_order_id and order_item.production_ticket_id = any(ticket_ids)
    group by ingredient.inventory_item_id, order_item.production_area_id
  loop
    select quantity into stock_before from public.area_inventory
      where item_id = required.item_id and area_id = required.area_id for update;
    update public.area_inventory set quantity = stock_before - required.quantity
      where item_id = required.item_id and area_id = required.area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    ) values (
      required.item_id, 'consumption', required.area_id, required.quantity, required.unit,
      stock_before, stock_before - required.quantity, 'pos_order', pos_order.id::text,
      'Consumo por comanda POS', auth.uid()
    );
  end loop;

  update public.pos_orders set sent_at = now()
  where id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    pos_order.id, 'sent_to_production',
    draft_count::text || ' producto(s) enviado(s) a produccion. Inventario descontado.', auth.uid()
  );

  return jsonb_build_object('order_id', pos_order.id, 'ticket_ids', to_jsonb(ticket_ids), 'items_sent', draft_count);
end;
$$;

revoke all on function public.send_pos_order_to_production(uuid) from public;
grant execute on function public.send_pos_order_to_production(uuid) to authenticated;
