-- Partial requisition fulfillment: per-line delivery, pending qty, purchase suggestions.
-- Apply after 143_purchase_order_receipts.sql.

-- ---------------------------------------------------------------------------
-- Schema extensions
-- ---------------------------------------------------------------------------
alter table public.requisition_items
  drop constraint if exists requisition_items_approved_quantity_check;

alter table public.requisition_items
  add constraint requisition_items_approved_quantity_check
    check (approved_quantity is null or approved_quantity >= 0);

alter table public.requisition_items
  add column if not exists delivered_quantity numeric,
  add column if not exists converted_delivered_quantity numeric,
  add column if not exists pending_quantity numeric not null default 0,
  add column if not exists fulfillment_status text,
  add column if not exists shortage_reason text,
  add column if not exists shortage_notes text,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfilled_by uuid references public.profiles(id);

alter table public.requisition_items
  drop constraint if exists requisition_items_delivered_quantity_check;

alter table public.requisition_items
  add constraint requisition_items_delivered_quantity_check
    check (delivered_quantity is null or delivered_quantity >= 0);

alter table public.requisition_items
  drop constraint if exists requisition_items_fulfillment_status_check;

alter table public.requisition_items
  add constraint requisition_items_fulfillment_status_check
    check (
      fulfillment_status is null
      or fulfillment_status in (
        'pending_fulfillment',
        'fulfilled',
        'partial',
        'out_of_stock',
        'cancelled'
      )
    );

alter table public.requisition_items
  drop constraint if exists requisition_items_shortage_reason_check;

alter table public.requisition_items
  add constraint requisition_items_shortage_reason_check
    check (
      shortage_reason is null
      or shortage_reason in (
        'sin_existencia',
        'vencido_danado',
        'error_solicitud',
        'otro'
      )
    );

alter table public.requisitions
  drop constraint if exists requisitions_status_check;

alter table public.requisitions
  add constraint requisitions_status_check
    check (status in (
      'draft',
      'pending',
      'approved',
      'rejected',
      'completed',
      'partially_fulfilled',
      'pending_fulfillment',
      'cancelled'
    ));

alter table public.requisition_low_stock_suggestion_logs
  add column if not exists requisition_item_id uuid references public.requisition_items(id) on delete set null,
  add column if not exists pending_quantity numeric,
  add column if not exists source text;

alter table public.requisition_low_stock_suggestion_logs
  drop constraint if exists requisition_low_stock_logs_source_check;

alter table public.requisition_low_stock_suggestion_logs
  add constraint requisition_low_stock_logs_source_check
    check (
      source is null
      or source in ('requisition_shortage', 'low_stock', 'both')
    );

create index if not exists requisition_items_pending_idx
  on public.requisition_items (item_id, fulfillment_status)
  where coalesce(pending_quantity, 0) > 0;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.requisition_line_fulfillment_status(
  p_requested numeric,
  p_delivered numeric
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_requested, 0) <= 0 then 'fulfilled'
    when coalesce(p_delivered, 0) <= 0 then 'out_of_stock'
    when coalesce(p_delivered, 0) >= coalesce(p_requested, 0) then 'fulfilled'
    else 'partial'
  end;
$$;

create or replace function public.requisition_header_fulfillment_status(
  p_all_fulfilled boolean,
  p_any_delivered boolean,
  p_any_pending boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_all_fulfilled then 'completed'
    when not p_any_delivered and p_any_pending then 'pending_fulfillment'
    else 'partially_fulfilled'
  end;
$$;

create or replace function public.requisition_shortage_reason_required(
  p_requested numeric,
  p_quantity numeric
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_quantity, 0) < coalesce(p_requested, 0);
$$;

-- Fase 2: al recibir productos en una OC, buscar requisiciones pendientes por item.
-- TODO: conectar desde receive_purchase_order_lines cuando exista UI de surtido post-recepcion.
create or replace function public.find_pending_requisition_items_for_inventory_item(
  p_item_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb := '[]'::jsonb;
begin
  if p_item_id is null then
    return result;
  end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      ri.id as requisition_item_id,
      ri.requisition_id,
      r.requisition_number,
      r.status as requisition_status,
      r.from_area_id,
      r.to_area_id,
      ri.item_id,
      ri.item_name,
      ri.requested_quantity,
      coalesce(ri.delivered_quantity, 0) as delivered_quantity,
      coalesce(ri.pending_quantity, 0) as pending_quantity,
      ri.fulfillment_status,
      ri.shortage_reason,
      r.created_at
    from public.requisition_items ri
    join public.requisitions r on r.id = ri.requisition_id
    where ri.item_id = p_item_id
      and coalesce(ri.pending_quantity, 0) > 0
      and r.status in ('partially_fulfilled', 'pending_fulfillment', 'approved')
      and coalesce(r.is_test, false) = false
    order by r.created_at desc
    limit greatest(coalesce(p_limit, 20), 1)
  ) q;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.find_pending_requisition_items_for_inventory_item(uuid, integer) from public;
grant execute on function public.find_pending_requisition_items_for_inventory_item(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_requisition: allow qty 0, pending qty, encargado_almacen
-- ---------------------------------------------------------------------------
create or replace function public.approve_requisition(p_requisition_id uuid, p_items jsonb)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  approved public.requisitions;
  item_row public.requisition_items;
  approved_qty numeric;
  pending_qty numeric;
  shortage_reason text;
begin
  if not (public.is_profile_manager() or public.is_inventory_manager()) then
    raise exception 'No tienes permiso para aprobar requisiciones.';
  end if;

  if not exists (
    select 1 from public.requisitions
    where id = p_requisition_id and status = 'pending'
  ) then
    raise exception 'Solo se pueden aprobar requisiciones pendientes.';
  end if;

  for row_data in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    approved_qty := coalesce((row_data ->> 'approved_quantity')::numeric, 0);
    if approved_qty < 0 then
      raise exception 'La cantidad aprobada no puede ser negativa.';
    end if;

    select * into item_row
    from public.requisition_items
    where id = (row_data ->> 'id')::uuid
      and requisition_id = p_requisition_id;

    if item_row.id is null then
      continue;
    end if;

    if approved_qty > item_row.requested_quantity then
      raise exception
        'La cantidad aprobada para % no puede superar lo solicitado (%).',
        item_row.item_name,
        item_row.requested_quantity;
    end if;

    shortage_reason := nullif(trim(row_data ->> 'shortage_reason'), '');
    if public.requisition_shortage_reason_required(item_row.requested_quantity, approved_qty)
       and shortage_reason is null then
      raise exception
        'Debes indicar el motivo del faltante para %.',
        item_row.item_name;
    end if;

    pending_qty := greatest(item_row.requested_quantity - approved_qty, 0);

    update public.requisition_items
    set
      approved_quantity = approved_qty,
      converted_approved_quantity = approved_qty * coalesce(conversion_factor, 1),
      pending_quantity = pending_qty,
      shortage_reason = case
        when public.requisition_shortage_reason_required(requested_quantity, approved_qty)
          then shortage_reason
        else null
      end,
      shortage_notes = nullif(trim(row_data ->> 'shortage_notes'), '')
    where id = item_row.id;
  end loop;

  update public.requisition_items
  set
    approved_quantity = requested_quantity,
    converted_approved_quantity = coalesce(converted_requested_quantity, requested_quantity),
    pending_quantity = 0
  where requisition_id = p_requisition_id
    and approved_quantity is null;

  update public.requisitions
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_requisition_id
  returning * into approved;

  return approved;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_requisition: partial delivery with per-line quantities
-- ---------------------------------------------------------------------------
create or replace function public.complete_requisition(
  p_requisition_id uuid,
  p_items jsonb default null
)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  requisition public.requisitions;
  detail public.requisition_items;
  row_data jsonb;
  delivered_qty numeric;
  delivered_base numeric;
  moved_quantity numeric;
  source_before numeric;
  destination_before numeric;
  movement_unit text;
  completed public.requisitions;
  line_shortage_reason text;
  line_shortage_notes text;
  pending_qty numeric;
  line_status text;
  all_fulfilled boolean := true;
  any_delivered boolean := false;
  any_pending boolean := false;
  new_status text;
begin
  if not public.is_inventory_manager() then
    raise exception 'No tienes permiso para completar traslados.';
  end if;

  select * into requisition
  from public.requisitions
  where id = p_requisition_id
  for update;

  if requisition.id is null or requisition.status <> 'approved' then
    raise exception 'La requisición debe estar aprobada antes del traslado.';
  end if;

  if not exists (
    select 1 from public.requisition_items where requisition_id = p_requisition_id
  ) then
    raise exception 'La requisición no tiene productos.';
  end if;

  for detail in select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    delivered_qty := null;
    line_shortage_reason := null;
    line_shortage_notes := null;

    if p_items is not null and jsonb_typeof(p_items) = 'array' then
      for row_data in select value from jsonb_array_elements(p_items)
      loop
        if (row_data ->> 'id')::uuid = detail.id then
          delivered_qty := coalesce(
            nullif(row_data ->> 'delivered_quantity', '')::numeric,
            nullif(row_data ->> 'approved_quantity', '')::numeric
          );
          line_shortage_reason := nullif(trim(row_data ->> 'shortage_reason'), '');
          line_shortage_notes := nullif(trim(row_data ->> 'shortage_notes'), '');
          exit;
        end if;
      end loop;
    end if;

    if delivered_qty is null then
      delivered_qty := coalesce(detail.approved_quantity, detail.requested_quantity, 0);
    end if;

    if delivered_qty < 0 then
      raise exception 'La cantidad entregada para % no puede ser negativa.', detail.item_name;
    end if;

    if delivered_qty > detail.requested_quantity then
      raise exception
        'La cantidad entregada para % no puede superar lo solicitado (%).',
        detail.item_name,
        detail.requested_quantity;
    end if;

    if public.requisition_shortage_reason_required(detail.requested_quantity, delivered_qty)
       and coalesce(line_shortage_reason, detail.shortage_reason) is null then
      raise exception
        'Debes indicar el motivo del faltante para %.',
        detail.item_name;
    end if;

    pending_qty := greatest(detail.requested_quantity - delivered_qty, 0);
    line_status := public.requisition_line_fulfillment_status(detail.requested_quantity, delivered_qty);

    if line_status <> 'fulfilled' then
      all_fulfilled := false;
    end if;
    if delivered_qty > 0 then
      any_delivered := true;
    end if;
    if pending_qty > 0 then
      any_pending := true;
    end if;

    delivered_base := delivered_qty * coalesce(detail.conversion_factor, 1);
    moved_quantity := delivered_base;

    if delivered_qty > 0 and not coalesce(requisition.is_test, false) then
      select base_unit into movement_unit
      from public.inventory_items
      where id = detail.item_id;
      movement_unit := coalesce(movement_unit, detail.unit);

      insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
      values (detail.item_id, requisition.to_area_id, 0, 0)
      on conflict (item_id, area_id) do nothing;

      select quantity into source_before
      from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.from_area_id
      for update;

      select quantity into destination_before
      from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.to_area_id
      for update;

      source_before := coalesce(source_before, 0);
      destination_before := coalesce(destination_before, 0);

      update public.area_inventory
      set quantity = source_before - moved_quantity
      where item_id = detail.item_id and area_id = requisition.from_area_id;

      update public.area_inventory
      set quantity = destination_before + moved_quantity
      where item_id = detail.item_id and area_id = requisition.to_area_id;

      insert into public.inventory_movements (
        item_id, movement_type, from_area_id, to_area_id, quantity, unit,
        previous_quantity, new_quantity, source_type, source_id, notes, performed_by, is_test
      ) values (
        detail.item_id,
        'transfer',
        requisition.from_area_id,
        requisition.to_area_id,
        moved_quantity,
        movement_unit,
        source_before,
        source_before - moved_quantity,
        'requisition',
        requisition.id::text,
        'Traslado requisicion ' || requisition.requisition_number ||
          '. Solicitado: ' || detail.requested_quantity || ' ' || coalesce(detail.requested_unit, detail.unit) ||
          '. Entregado: ' || delivered_qty || ' ' || coalesce(detail.requested_unit, detail.unit) ||
          '. Pendiente: ' || pending_qty || ' ' || coalesce(detail.requested_unit, detail.unit) ||
          case
            when coalesce(line_shortage_reason, detail.shortage_reason) is not null
              then '. Motivo: ' || coalesce(line_shortage_reason, detail.shortage_reason)
            else ''
          end,
        auth.uid(),
        false
      );
    elsif delivered_qty > 0 and coalesce(requisition.is_test, false) then
      select base_unit into movement_unit
      from public.inventory_items
      where id = detail.item_id;
      movement_unit := coalesce(movement_unit, detail.unit);

      insert into public.inventory_movements (
        item_id, movement_type, from_area_id, to_area_id, quantity, unit,
        previous_quantity, new_quantity, source_type, source_id, notes, performed_by, is_test
      ) values (
        detail.item_id,
        'transfer',
        requisition.from_area_id,
        requisition.to_area_id,
        moved_quantity,
        movement_unit,
        null,
        null,
        'requisition_test',
        requisition.id::text,
        'PRUEBA: traslado simulado ' || requisition.requisition_number ||
          '. Solicitado: ' || detail.requested_quantity || ' ' || coalesce(detail.requested_unit, detail.unit) ||
          '. Entregado: ' || delivered_qty || ' ' || coalesce(detail.requested_unit, detail.unit) ||
          '. Pendiente: ' || pending_qty,
        auth.uid(),
        true
      );
    end if;

    update public.requisition_items
    set
      delivered_quantity = delivered_qty,
      converted_delivered_quantity = delivered_base,
      pending_quantity = pending_qty,
      fulfillment_status = line_status,
      shortage_reason = case
        when public.requisition_shortage_reason_required(requested_quantity, delivered_qty)
          then coalesce(line_shortage_reason, detail.shortage_reason)
        else null
      end,
      shortage_notes = case
        when public.requisition_shortage_reason_required(requested_quantity, delivered_qty)
          then line_shortage_notes
        else null
      end,
      fulfilled_at = now(),
      fulfilled_by = auth.uid()
    where id = detail.id;
  end loop;

  new_status := public.requisition_header_fulfillment_status(all_fulfilled, any_delivered, any_pending);

  update public.requisitions
  set
    status = new_status,
    completed_by = auth.uid(),
    completed_at = now()
  where id = p_requisition_id
  returning * into completed;

  return completed;
end;
$$;

revoke all on function public.complete_requisition(uuid, jsonb) from public;
grant execute on function public.complete_requisition(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Purchase suggestions: shortage + low stock
-- ---------------------------------------------------------------------------
create or replace function public.get_requisition_purchase_suggestions(
  p_requisition_id uuid,
  p_record_suggested boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requisition public.requisitions;
  suggestions jsonb := '[]'::jsonb;
  suggestion_map jsonb := '{}'::jsonb;
  impact_row record;
  shortage_row record;
  item_key text;
  existing jsonb;
  merged jsonb;
  low_stock_qty numeric;
  shortage_qty numeric;
  final_qty numeric;
  final_source text;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para consultar sugerencias de compra.';
  end if;

  select * into requisition
  from public.requisitions
  where id = p_requisition_id;

  if requisition.id is null then
    raise exception 'Requisicion no encontrada.';
  end if;

  if requisition.status not in ('completed', 'partially_fulfilled', 'pending_fulfillment') then
    raise exception 'La requisicion debe estar surtida para evaluar sugerencias de compra.';
  end if;

  if coalesce(requisition.is_test, false) then
    return '[]'::jsonb;
  end if;

  for shortage_row in
    select
      ri.id as requisition_item_id,
      ri.item_id,
      coalesce(ri.item_name, ii.name) as item_name,
      ii.sku,
      coalesce(ri.pending_quantity, 0) as pending_quantity,
      coalesce(ri.requested_unit, ri.unit, ii.base_unit) as unit,
      coalesce(ii.purchase_unit, ri.unit) as purchase_unit,
      ii.supplier,
      coalesce(ii.conversion_factor, ri.conversion_factor, 1) as conversion_factor,
      coalesce(ii.purchase_price, ii.cost_per_base_unit, 0) as purchase_price,
      coalesce(ri.shortage_reason, '') as shortage_reason
    from public.requisition_items ri
    join public.inventory_items ii on ii.id = ri.item_id
    where ri.requisition_id = p_requisition_id
      and coalesce(ri.pending_quantity, 0) > 0
  loop
    item_key := shortage_row.item_id::text;
    shortage_qty := ceil(
      greatest(shortage_row.pending_quantity, 0)
      / greatest(coalesce(nullif(shortage_row.conversion_factor, 0), 1), 0.0001)
    );
    merged := jsonb_build_object(
      'requisition_item_id', shortage_row.requisition_item_id,
      'item_id', shortage_row.item_id,
      'item_name', shortage_row.item_name,
      'sku', shortage_row.sku,
      'pending_quantity', shortage_row.pending_quantity,
      'stock_after', null,
      'minimum_stock', null,
      'unit', shortage_row.unit,
      'purchase_unit', coalesce(nullif(trim(shortage_row.purchase_unit), ''), shortage_row.unit),
      'supplier', shortage_row.supplier,
      'conversion_factor', shortage_row.conversion_factor,
      'purchase_price', shortage_row.purchase_price,
      'shortage_reason', shortage_row.shortage_reason,
      'suggested_quantity', greatest(shortage_qty, 1),
      'source', 'requisition_shortage'
    );
    suggestion_map := suggestion_map || jsonb_build_object(item_key, merged);
  end loop;

  for impact_row in
    select
      ri.id as requisition_item_id,
      ri.item_id,
      coalesce(ri.item_name, ii.name) as item_name,
      ii.sku,
      coalesce(ai.quantity, 0) as stock_after,
      coalesce(ai.minimum_quantity, 0) as minimum_stock,
      coalesce(ii.base_unit, ri.unit) as unit,
      ii.purchase_unit,
      ii.supplier,
      coalesce(ii.conversion_factor, 1) as conversion_factor,
      coalesce(ii.purchase_price, ii.cost_per_base_unit, 0) as purchase_price,
      coalesce(
        ri.converted_delivered_quantity,
        ri.converted_approved_quantity,
        ri.converted_requested_quantity,
        ri.delivered_quantity,
        ri.approved_quantity,
        ri.requested_quantity,
        0
      ) as moved_quantity
    from public.requisition_items ri
    join public.inventory_items ii on ii.id = ri.item_id
    left join public.area_inventory ai
      on ai.item_id = ri.item_id
     and ai.area_id = requisition.from_area_id
    where ri.requisition_id = p_requisition_id
      and coalesce(ri.delivered_quantity, ri.approved_quantity, 0) > 0
      and (
        coalesce(ai.quantity, 0) <= 0
        or (
          coalesce(ai.minimum_quantity, 0) > 0
          and coalesce(ai.quantity, 0) <= coalesce(ai.minimum_quantity, 0)
        )
      )
  loop
    item_key := impact_row.item_id::text;
    low_stock_qty := public.suggest_purchase_quantity(
      impact_row.stock_after,
      impact_row.minimum_stock,
      impact_row.moved_quantity,
      impact_row.conversion_factor
    );
    existing := suggestion_map -> item_key;

    if existing is not null then
      final_qty := greatest(
        coalesce((existing ->> 'suggested_quantity')::numeric, 0),
        low_stock_qty
      );
      final_source := 'both';
      merged := existing
        || jsonb_build_object(
          'stock_after', impact_row.stock_after,
          'minimum_stock', impact_row.minimum_stock,
          'moved_quantity', impact_row.moved_quantity,
          'suggested_quantity', final_qty,
          'source', final_source
        );
    else
      merged := jsonb_build_object(
        'requisition_item_id', impact_row.requisition_item_id,
        'item_id', impact_row.item_id,
        'item_name', impact_row.item_name,
        'sku', impact_row.sku,
        'pending_quantity', 0,
        'stock_after', impact_row.stock_after,
        'minimum_stock', impact_row.minimum_stock,
        'unit', impact_row.unit,
        'purchase_unit', coalesce(nullif(trim(impact_row.purchase_unit), ''), impact_row.unit),
        'supplier', impact_row.supplier,
        'conversion_factor', impact_row.conversion_factor,
        'purchase_price', impact_row.purchase_price,
        'moved_quantity', impact_row.moved_quantity,
        'suggested_quantity', low_stock_qty,
        'source', 'low_stock'
      );
    end if;

    suggestion_map := suggestion_map || jsonb_build_object(item_key, merged);
  end loop;

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into suggestions
  from jsonb_each(suggestion_map);

  if p_record_suggested then
    for impact_row in
      select key, value
      from jsonb_each(suggestion_map)
    loop
      insert into public.requisition_low_stock_suggestion_logs (
        requisition_id,
        requisition_item_id,
        item_id,
        pending_quantity,
        stock_after,
        minimum_stock,
        suggested_quantity,
        user_id,
        action,
        source
      ) values (
        p_requisition_id,
        nullif(impact_row.value ->> 'requisition_item_id', '')::uuid,
        nullif(impact_row.value ->> 'item_id', '')::uuid,
        nullif(impact_row.value ->> 'pending_quantity', '')::numeric,
        nullif(impact_row.value ->> 'stock_after', '')::numeric,
        nullif(impact_row.value ->> 'minimum_stock', '')::numeric,
        coalesce((impact_row.value ->> 'suggested_quantity')::numeric, 1),
        auth.uid(),
        'suggested',
        coalesce(nullif(impact_row.value ->> 'source', ''), 'low_stock')
      );
    end loop;
  end if;

  return coalesce(suggestions, '[]'::jsonb);
end;
$$;

revoke all on function public.get_requisition_purchase_suggestions(uuid, boolean) from public;
grant execute on function public.get_requisition_purchase_suggestions(uuid, boolean) to authenticated;

create or replace function public.get_requisition_low_stock_impacts(
  p_requisition_id uuid,
  p_record_suggested boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.get_requisition_purchase_suggestions(p_requisition_id, p_record_suggested);
end;
$$;

create or replace function public.add_low_stock_items_to_today_purchase_order(
  p_requisition_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_order public.purchase_orders;
  incoming_items jsonb := '[]'::jsonb;
  line jsonb;
  merged_items jsonb;
  updated_payload jsonb;
  item_id uuid;
  qty numeric;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para agregar productos a ordenes de compra.';
  end if;

  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes seleccionar al menos un producto.';
  end if;

  draft_order := public.get_or_create_today_purchase_order_draft();

  for line in select * from jsonb_array_elements(p_items)
  loop
    item_id := nullif(line ->> 'item_id', '')::uuid;
    qty := coalesce((line ->> 'suggested_quantity')::numeric, (line ->> 'quantity')::numeric);
    if item_id is null or qty is null or qty <= 0 then
      raise exception 'Cada producto debe incluir item_id y cantidad valida.';
    end if;
    incoming_items := incoming_items || jsonb_build_array(
      public.build_purchase_order_line(item_id, qty)
    );
  end loop;

  merged_items := public.merge_purchase_order_items(draft_order.data -> 'items', incoming_items);
  updated_payload := jsonb_set(draft_order.data, '{items}', merged_items, true);

  update public.purchase_orders
  set
    data = updated_payload,
    updated_at = now()
  where id = draft_order.id
  returning * into draft_order;

  for line in select * from jsonb_array_elements(p_items)
  loop
    insert into public.requisition_low_stock_suggestion_logs (
      requisition_id,
      requisition_item_id,
      item_id,
      pending_quantity,
      stock_after,
      minimum_stock,
      suggested_quantity,
      user_id,
      action,
      purchase_order_id,
      source
    ) values (
      p_requisition_id,
      nullif(line ->> 'requisition_item_id', '')::uuid,
      nullif(line ->> 'item_id', '')::uuid,
      nullif(line ->> 'pending_quantity', '')::numeric,
      nullif(line ->> 'stock_after', '')::numeric,
      nullif(line ->> 'minimum_stock', '')::numeric,
      coalesce((line ->> 'suggested_quantity')::numeric, (line ->> 'quantity')::numeric),
      auth.uid(),
      'added_to_po',
      draft_order.id,
      coalesce(nullif(line ->> 'source', ''), 'low_stock')
    );
  end loop;

  return jsonb_build_object(
    'purchase_order_id', draft_order.id,
    'order_number', draft_order.order_number,
    'status', draft_order.status,
    'items_count', jsonb_array_length(merged_items)
  );
end;
$$;

create or replace function public.ignore_low_stock_purchase_suggestion(
  p_requisition_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para registrar sugerencias omitidas.';
  end if;

  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes indicar los productos omitidos.';
  end if;

  for line in select * from jsonb_array_elements(p_items)
  loop
    insert into public.requisition_low_stock_suggestion_logs (
      requisition_id,
      requisition_item_id,
      item_id,
      pending_quantity,
      stock_after,
      minimum_stock,
      suggested_quantity,
      user_id,
      action,
      notes,
      source
    ) values (
      p_requisition_id,
      nullif(line ->> 'requisition_item_id', '')::uuid,
      nullif(line ->> 'item_id', '')::uuid,
      nullif(line ->> 'pending_quantity', '')::numeric,
      nullif(line ->> 'stock_after', '')::numeric,
      nullif(line ->> 'minimum_stock', '')::numeric,
      coalesce((line ->> 'suggested_quantity')::numeric, (line ->> 'quantity')::numeric),
      auth.uid(),
      'ignored',
      p_notes,
      coalesce(nullif(line ->> 'source', ''), 'low_stock')
    );
  end loop;
end;
$$;
