-- Fix PL/pgSQL / SQL name collisions in send_pos_order_to_production (42702 product_id ambiguous)
-- Apply after 157_pos_implementation_mode.sql

create or replace function public.send_pos_order_to_production(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos_order public.pos_orders;
  v_item public.pos_order_items;
  v_product public.pos_products;
  v_recipe public.standard_recipes;
  v_variant public.pos_product_variants;
  v_required record;
  v_area_row record;
  v_ticket public.production_tickets;
  v_stock_before numeric;
  v_ticket_ids uuid[] := '{}'::uuid[];
  v_draft_count integer;
  v_mode text := public.get_inventory_deduction_mode();
  v_strict boolean := v_mode = 'strict';
  v_eval jsonb;
  v_skip_reason text;
  v_skipped_count integer := 0;
  v_deducted_count integer := 0;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para enviar ordenes POS.';
  end if;

  select po.*
  into v_pos_order
  from public.pos_orders po
  where po.id = p_order_id
  for update;

  if v_pos_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  if v_pos_order.status <> 'open' then
    raise exception 'Solo una orden abierta puede enviarse a produccion.';
  end if;

  select count(*)
  into v_draft_count
  from public.pos_order_items poi
  where poi.order_id = p_order_id
    and poi.status = 'draft';

  if v_draft_count = 0 then
    raise exception 'No hay productos nuevos para enviar.';
  end if;

  for v_item in
    select poi.*
    from public.pos_order_items poi
    where poi.order_id = p_order_id
      and poi.status = 'draft'
  loop
    if v_strict then
      select pop.*
      into v_product
      from public.pos_products pop
      where pop.id = v_item.product_id
        and pop.active = true
        and pop.production_ready = true;

      if v_product.id is null then
        raise exception 'Producto % no esta listo para produccion.', v_item.product_name;
      end if;

      if v_product.is_test_item then
        continue;
      end if;

      if v_item.recipe_id is null
        or v_item.production_area_id is null
        or not v_item.production_ready then
        raise exception 'Producto % no esta listo para produccion.', v_item.product_name;
      end if;

      if v_item.product_variant_id is not null then
        select ppv.*
        into v_variant
        from public.pos_product_variants ppv
        where ppv.id = v_item.product_variant_id
          and ppv.product_id = v_item.product_id
          and ppv.is_active = true;

        if v_variant.id is null then
          raise exception 'La variante seleccionada para % no esta activa.', v_item.product_name;
        end if;

        select sr.*
        into v_recipe
        from public.standard_recipes sr
        where sr.id = v_variant.recipe_id
          and sr.active = true
          and sr.recipe_type = 'final_product';

        if v_recipe.id is null
          or v_variant.recipe_id is distinct from v_item.recipe_id
          or v_variant.production_area_id is distinct from v_item.production_area_id
          or v_recipe.production_area_id is distinct from v_item.production_area_id then
          raise exception 'Producto % tiene variante, receta o area de produccion invalida.', v_item.product_name;
        end if;
      else
        select sr.*
        into v_recipe
        from public.standard_recipes sr
        where sr.id = v_item.recipe_id
          and sr.active = true
          and sr.recipe_type = 'final_product';

        if v_recipe.id is null
          or v_product.recipe_id is distinct from v_item.recipe_id
          or v_product.production_area_id is distinct from v_item.production_area_id
          or v_recipe.production_area_id is distinct from v_item.production_area_id then
          raise exception 'Producto % tiene receta o area de produccion invalida.', v_item.product_name;
        end if;
      end if;
    else
      select pop.*
      into v_product
      from public.pos_products pop
      where pop.id = v_item.product_id
        and pop.active = true;

      if v_product.id is null then
        raise exception 'Producto % no esta activo.', v_item.product_name;
      end if;

      if v_item.production_area_id is null then
        raise exception 'Producto % no tiene area KDS configurada.', v_item.product_name;
      end if;

      if not exists (
        select 1
        from public.areas ar
        where ar.id = v_item.production_area_id
          and ar.active = true
          and ar.is_production_area = true
      ) then
        raise exception 'El area KDS de % no esta activa.', v_item.product_name;
      end if;
    end if;
  end loop;

  for v_required in
    select
      ri.inventory_item_id as item_id,
      max(ri.ingredient_name) as ingredient_name,
      max(ri.unit) as unit,
      poi.production_area_id as area_id,
      max(ar.name) as area_name,
      sum(ri.quantity * poi.quantity) as quantity
    from public.pos_order_items poi
    join public.pos_products pop on pop.id = poi.product_id
    join public.standard_recipes sr on sr.id = poi.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = sr.id
    join public.areas ar on ar.id = poi.production_area_id
    where poi.order_id = p_order_id
      and poi.status = 'draft'
      and not poi.is_test_item
      and poi.recipe_id is not null
      and (public.evaluate_pos_inventory_deduction(pop, poi) ->> 'deduct')::boolean = true
    group by ri.inventory_item_id, poi.production_area_id
  loop
    select ai.quantity
    into v_stock_before
    from public.area_inventory ai
    where ai.item_id = v_required.item_id
      and ai.area_id = v_required.area_id
    for update;

    v_stock_before := coalesce(v_stock_before, 0);

    if v_stock_before < v_required.quantity then
      raise exception 'No hay suficiente % en %. Disponible %, requerido %.',
        v_required.ingredient_name, v_required.area_name, v_stock_before, v_required.quantity;
    end if;
  end loop;

  for v_area_row in
    select distinct poi.production_area_id as area_id
    from public.pos_order_items poi
    where poi.order_id = p_order_id
      and poi.status = 'draft'
  loop
    insert into public.production_tickets (
      order_id, table_id, table_name, area_id, area_name, waiter_id, waiter_name, status, priority, notes
    )
    select
      v_pos_order.id::text,
      v_pos_order.table_id,
      coalesce(v_pos_order.table_name, 'Orden POS'),
      ar.id,
      ar.name,
      v_pos_order.waiter_id,
      v_pos_order.waiter_name,
      'pending',
      'normal',
      v_pos_order.notes
    from public.areas ar
    where ar.id = v_area_row.area_id
      and ar.active = true
      and ar.is_production_area = true
    returning * into v_ticket;

    if v_ticket.id is null then
      raise exception 'El area de produccion % no esta activa.', v_area_row.area_id;
    end if;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket.id);

    insert into public.production_ticket_items (
      ticket_id, order_item_id, product_id, product_name, quantity, notes, modifiers, status
    )
    select
      v_ticket.id,
      poi.id::text,
      poi.product_id,
      poi.product_name,
      poi.quantity,
      poi.notes,
      poi.modifiers,
      'pending'
    from public.pos_order_items poi
    where poi.order_id = p_order_id
      and poi.status = 'draft'
      and poi.production_area_id = v_area_row.area_id;

    for v_item in
      select poi.*
      from public.pos_order_items poi
      where poi.order_id = p_order_id
        and poi.status = 'draft'
        and poi.production_area_id = v_area_row.area_id
    loop
      select pop.*
      into v_product
      from public.pos_products pop
      where pop.id = v_item.product_id;

      v_eval := public.evaluate_pos_inventory_deduction(v_product, v_item);
      v_skip_reason := nullif(v_eval ->> 'reason', '');

      update public.pos_order_items poi
      set status = 'sent_to_production',
          inventory_consumed = coalesce((v_eval ->> 'deduct')::boolean, false),
          production_ticket_id = v_ticket.id
      where poi.id = v_item.id;

      if coalesce((v_eval ->> 'deduct')::boolean, false) then
        v_deducted_count := v_deducted_count + 1;
      else
        v_skipped_count := v_skipped_count + 1;
        if v_skip_reason is not null and v_skip_reason <> 'test_item' then
          perform public.log_pos_inventory_deduction_skip(
            v_pos_order.id,
            v_item.id,
            v_item.product_id,
            v_item.product_name,
            v_skip_reason
          );
        end if;
      end if;
    end loop;

    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      v_pos_order.id,
      'ticket_created',
      'Ticket creado en KDS para ' || v_ticket.area_name || '.',
      auth.uid()
    );
  end loop;

  for v_required in
    select
      ri.inventory_item_id as item_id,
      max(ri.ingredient_name) as ingredient_name,
      max(ri.unit) as unit,
      poi.production_area_id as area_id,
      sum(ri.quantity * poi.quantity) as quantity
    from public.pos_order_items poi
    join public.pos_products pop on pop.id = poi.product_id
    join public.standard_recipes sr on sr.id = poi.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = sr.id
    where poi.order_id = p_order_id
      and poi.production_ticket_id = any(v_ticket_ids)
      and not poi.is_test_item
      and poi.recipe_id is not null
      and (public.evaluate_pos_inventory_deduction(pop, poi) ->> 'deduct')::boolean = true
    group by ri.inventory_item_id, poi.production_area_id
  loop
    select ai.quantity
    into v_stock_before
    from public.area_inventory ai
    where ai.item_id = v_required.item_id
      and ai.area_id = v_required.area_id
    for update;

    update public.area_inventory ai
    set quantity = v_stock_before - v_required.quantity
    where ai.item_id = v_required.item_id
      and ai.area_id = v_required.area_id;

    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    ) values (
      v_required.item_id,
      'consumption',
      v_required.area_id,
      v_required.quantity,
      v_required.unit,
      v_stock_before,
      v_stock_before - v_required.quantity,
      'pos_order',
      v_pos_order.id::text,
      'Consumo por comanda POS',
      auth.uid()
    );
  end loop;

  if v_skipped_count > 0 then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      v_pos_order.id,
      'inventory_deduction_skipped',
      v_skipped_count::text || ' linea(s) omitieron descarga de inventario (modo implementacion).',
      auth.uid()
    );
  end if;

  update public.pos_orders po
  set sent_at = now()
  where po.id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    v_pos_order.id,
    'sent_to_production',
    v_draft_count::text || ' producto(s) enviado(s) a produccion.'
      || case
        when v_deducted_count > 0 and v_skipped_count > 0 then
          ' Inventario descontado en ' || v_deducted_count::text || ' linea(s); omitido en ' || v_skipped_count::text || '.'
        when v_deducted_count > 0 then ' Inventario descontado.'
        else ' Sin descarga de inventario (modo implementacion).'
      end,
    auth.uid()
  );

  return jsonb_build_object(
    'order_id', v_pos_order.id,
    'ticket_ids', to_jsonb(v_ticket_ids),
    'items_sent', v_draft_count,
    'inventory_deducted_count', v_deducted_count,
    'inventory_skipped_count', v_skipped_count,
    'deduction_mode', v_mode,
    'inventory_consumed', v_deducted_count > 0
  );
end;
$$;

revoke all on function public.send_pos_order_to_production(uuid) from public;
grant execute on function public.send_pos_order_to_production(uuid) to authenticated;
