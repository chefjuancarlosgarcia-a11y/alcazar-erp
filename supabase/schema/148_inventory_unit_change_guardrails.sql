-- Guardrails for inventory unit changes vs open requisitions + fulfillment stock validation.
-- Apply after 147_requisition_shortage_reason_ambiguity_fix.sql (or latest requisition migrations).

alter table public.requisition_items
  add column if not exists inventory_base_unit_at_request text;

update public.requisition_items ri
set inventory_base_unit_at_request = coalesce(
  nullif(trim(ri.inventory_base_unit_at_request), ''),
  (
    select ii.base_unit
    from public.inventory_items ii
    where ii.id = ri.item_id
  ),
  ri.unit
)
where ri.inventory_base_unit_at_request is null
   or trim(ri.inventory_base_unit_at_request) = '';

-- ---------------------------------------------------------------------------
-- Open requisitions lookup (for product unit change warnings)
-- ---------------------------------------------------------------------------

create or replace function public.is_requisition_open_for_unit_guard(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_status, '') in (
    'draft',
    'pending',
    'approved',
    'partially_fulfilled',
    'pending_fulfillment'
  );
$$;

create or replace function public.get_item_open_requisitions_for_unit_change(p_item_id uuid)
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'requisition_id', q.requisition_id,
        'requisition_number', q.requisition_number,
        'status', q.status,
        'from_area_id', q.from_area_id,
        'to_area_id', q.to_area_id,
        'requested_quantity', q.requested_quantity,
        'requested_unit', q.requested_unit,
        'inventory_base_unit_at_request', q.inventory_base_unit_at_request,
        'created_at', q.created_at
      )
      order by q.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select distinct on (r.id)
      r.id as requisition_id,
      r.requisition_number,
      r.status,
      r.from_area_id,
      r.to_area_id,
      ri.requested_quantity,
      coalesce(ri.requested_unit, ri.unit) as requested_unit,
      coalesce(ri.inventory_base_unit_at_request, ri.unit) as inventory_base_unit_at_request,
      r.created_at
    from public.requisition_items ri
    join public.requisitions r on r.id = ri.requisition_id
    where ri.item_id = p_item_id
      and coalesce(r.is_test, false) = false
      and public.is_requisition_open_for_unit_guard(r.status)
    order by r.id, r.created_at desc
  ) q;

  return result;
end;
$$;

revoke all on function public.is_requisition_open_for_unit_guard(text) from public;
grant execute on function public.is_requisition_open_for_unit_guard(text) to authenticated;

revoke all on function public.get_item_open_requisitions_for_unit_change(uuid) from public;
grant execute on function public.get_item_open_requisitions_for_unit_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot inventory base unit on create / update draft
-- ---------------------------------------------------------------------------

create or replace function public.create_requisition(
  p_data jsonb,
  p_items jsonb,
  p_submit boolean default false
)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.requisitions;
  row_data jsonb;
  catalog_item public.inventory_items;
  requester public.profiles;
  from_id text := nullif(trim(p_data ->> 'from_area_id'), '');
  to_id text := nullif(trim(p_data ->> 'to_area_id'), '');
  requester_id uuid := nullif(p_data ->> 'requested_by_profile_id', '')::uuid;
  requested_qty numeric;
  requested_unit text;
  conversion_factor numeric;
  converted_qty numeric;
  source_stock numeric;
  source_minimum numeric;
  availability text;
  is_test_flow boolean := coalesce((p_data ->> 'is_test')::boolean, false);
begin
  if is_test_flow and not public.can_create_test_flow() then
    raise exception 'Solo Administracion puede crear pruebas de flujo.';
  end if;

  perform public.assert_requisition_request_permissions(from_id, to_id, requester_id);

  select * into requester from public.profiles where id = requester_id and status = 'active';
  if requester.id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos un producto a la requisicion.';
  end if;

  insert into public.requisitions (
    requisition_number, requested_by, requested_by_profile_id, requested_by_name, requested_by_role,
    from_area_id, to_area_id, priority, notes, status, submitted_at, is_test
  )
  values (
    public.next_requisition_number(), auth.uid(), requester.id,
    coalesce(requester.full_name, requester.username), requester.role, from_id, to_id,
    coalesce(nullif(trim(p_data ->> 'priority'), ''), 'normal'),
    nullif(trim(p_data ->> 'notes'), ''),
    case when p_submit then 'pending' else 'draft' end,
    case when p_submit then now() else null end,
    is_test_flow
  )
  returning * into created;

  for row_data in select value from jsonb_array_elements(p_items)
  loop
    select * into catalog_item from public.inventory_items where id = (row_data ->> 'item_id')::uuid and active = true;
    if catalog_item.id is null then raise exception 'La requisicion contiene un producto inactivo o inexistente.'; end if;
    requested_qty := coalesce((row_data ->> 'requested_quantity')::numeric, 0);
    if requested_qty <= 0 then raise exception 'Las cantidades solicitadas deben ser mayores que cero.'; end if;

    requested_unit := coalesce(
      nullif(trim(row_data ->> 'requested_unit'), ''),
      nullif(trim(catalog_item.default_requisition_unit), ''),
      catalog_item.base_unit
    );
    conversion_factor := public.resolve_item_requisition_unit_factor(catalog_item.id, requested_unit);
    converted_qty := requested_qty * conversion_factor;

    select quantity, minimum_quantity into source_stock, source_minimum
    from public.area_inventory
    where item_id = catalog_item.id and area_id = from_id;
    source_stock := coalesce(source_stock, 0);
    source_minimum := coalesce(source_minimum, 0);
    availability := case when source_stock <= 0 then 'Sin stock' when source_stock < converted_qty then 'Parcial' else 'Disponible' end;

    insert into public.requisition_items (
      requisition_id, item_id, item_name, unit, requested_quantity, approved_quantity,
      requested_unit, conversion_factor, converted_requested_quantity, availability_status,
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes, is_test,
      inventory_base_unit_at_request
    ) values (
      created.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, false, nullif(trim(row_data ->> 'notes'), ''),
      is_test_flow, catalog_item.base_unit
    );
  end loop;

  return created;
end;
$$;

create or replace function public.update_draft_requisition(
  p_requisition_id uuid,
  p_data jsonb,
  p_items jsonb
)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.requisitions;
  updated public.requisitions;
  row_data jsonb;
  catalog_item public.inventory_items;
  requester public.profiles;
  from_id text := nullif(trim(p_data ->> 'from_area_id'), '');
  to_id text := nullif(trim(p_data ->> 'to_area_id'), '');
  requester_id uuid := nullif(p_data ->> 'requested_by_profile_id', '')::uuid;
  requested_qty numeric;
  requested_unit text;
  conversion_factor numeric;
  converted_qty numeric;
  source_stock numeric;
  source_minimum numeric;
  availability text;
begin
  select * into current_row from public.requisitions where id = p_requisition_id;
  if current_row.id is null or current_row.status <> 'draft' then
    raise exception 'Solo se pueden editar requisiciones en borrador.';
  end if;
  if current_row.requested_by <> auth.uid() and not public.is_profile_manager() then
    raise exception 'No tienes permiso para editar esta requisicion.';
  end if;

  perform public.assert_requisition_request_permissions(from_id, to_id, requester_id);

  select * into requester from public.profiles where id = requester_id and status = 'active';
  if requester.id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos un producto a la requisicion.';
  end if;

  update public.requisitions
    set from_area_id = from_id,
        to_area_id = to_id,
        priority = coalesce(nullif(trim(p_data ->> 'priority'), ''), 'normal'),
        notes = nullif(trim(p_data ->> 'notes'), ''),
        requested_by_profile_id = requester.id,
        requested_by_name = coalesce(requester.full_name, requester.username),
        requested_by_role = requester.role
  where id = p_requisition_id
  returning * into updated;

  delete from public.requisition_items where requisition_id = p_requisition_id;
  for row_data in select value from jsonb_array_elements(p_items)
  loop
    select * into catalog_item from public.inventory_items where id = (row_data ->> 'item_id')::uuid and active = true;
    requested_qty := coalesce((row_data ->> 'requested_quantity')::numeric, 0);
    if catalog_item.id is null or requested_qty <= 0 then raise exception 'Producto o cantidad invalida en la requisicion.'; end if;

    requested_unit := coalesce(
      nullif(trim(row_data ->> 'requested_unit'), ''),
      nullif(trim(catalog_item.default_requisition_unit), ''),
      catalog_item.base_unit
    );
    conversion_factor := public.resolve_item_requisition_unit_factor(catalog_item.id, requested_unit);
    converted_qty := requested_qty * conversion_factor;

    select quantity, minimum_quantity into source_stock, source_minimum
    from public.area_inventory
    where item_id = catalog_item.id and area_id = from_id;
    source_stock := coalesce(source_stock, 0);
    source_minimum := coalesce(source_minimum, 0);
    availability := case when source_stock <= 0 then 'Sin stock' when source_stock < converted_qty then 'Parcial' else 'Disponible' end;

    insert into public.requisition_items (
      requisition_id, item_id, item_name, unit, requested_quantity, approved_quantity,
      requested_unit, conversion_factor, converted_requested_quantity, availability_status,
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes, is_test,
      inventory_base_unit_at_request
    ) values (
      updated.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, false, nullif(trim(row_data ->> 'notes'), ''),
      coalesce(current_row.is_test, false), catalog_item.base_unit
    );
  end loop;
  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_requisition: config snapshot check + stock validation before deduct
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
  snapshot_base_unit text;
  current_base_unit text;
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

    snapshot_base_unit := coalesce(nullif(trim(detail.inventory_base_unit_at_request), ''), detail.unit);
    select ii.base_unit into current_base_unit
    from public.inventory_items ii
    where ii.id = detail.item_id;

    if current_base_unit is null then
      raise exception 'El producto % ya no existe en el inventario.', detail.item_name;
    end if;

    if public.normalize_inventory_unit(snapshot_base_unit)
       <> public.normalize_inventory_unit(current_base_unit) then
      raise exception
        'La requisicion fue creada con una configuracion anterior del producto %. Unidad de inventario al crear: %. Unidad actual: %. Cancele la requisicion y vuelva a crearla con la configuracion actual.',
        detail.item_name,
        snapshot_base_unit,
        current_base_unit;
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
    movement_unit := current_base_unit;

    if delivered_qty > 0 and not coalesce(requisition.is_test, false) then
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

      if source_before < moved_quantity then
        raise exception
          E'No hay suficiente inventario para surtir este producto.\nProducto:\n%\nDisponible:\n% %\nIntentas entregar:\n% %',
          detail.item_name,
          source_before,
          current_base_unit,
          moved_quantity,
          current_base_unit;
      end if;

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

    update public.requisition_items ri
    set
      delivered_quantity = delivered_qty,
      converted_delivered_quantity = delivered_base,
      pending_quantity = pending_qty,
      fulfillment_status = line_status,
      shortage_reason = case
        when public.requisition_shortage_reason_required(ri.requested_quantity, delivered_qty)
          then coalesce(line_shortage_reason, detail.shortage_reason)
        else null
      end,
      shortage_notes = case
        when public.requisition_shortage_reason_required(ri.requested_quantity, delivered_qty)
          then line_shortage_notes
        else null
      end,
      fulfilled_at = now(),
      fulfilled_by = auth.uid()
    where ri.id = detail.id;
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

revoke all on function public.create_requisition(jsonb, jsonb, boolean) from public;
grant execute on function public.create_requisition(jsonb, jsonb, boolean) to authenticated;

revoke all on function public.update_draft_requisition(uuid, jsonb, jsonb) from public;
grant execute on function public.update_draft_requisition(uuid, jsonb, jsonb) to authenticated;

revoke all on function public.complete_requisition(uuid, jsonb) from public;
grant execute on function public.complete_requisition(uuid, jsonb) to authenticated;
