-- Test flow mode for requisitions, purchase orders and inventory movements.
-- Test records are visible in modules but excluded from real stock and operational reports.
-- Includes prerequisite columns from 025 and 035 when those migrations were skipped.

alter table public.requisitions
  add column if not exists requested_by_profile_id uuid references public.profiles(id),
  add column if not exists requested_by_name text,
  add column if not exists requested_by_role text,
  add column if not exists is_test boolean not null default false;

alter table public.requisition_items
  add column if not exists requested_unit text,
  add column if not exists conversion_factor numeric,
  add column if not exists converted_requested_quantity numeric,
  add column if not exists converted_approved_quantity numeric,
  add column if not exists availability_status text,
  add column if not exists stock_available_at_request numeric,
  add column if not exists stock_minimum_at_request numeric,
  add column if not exists conversion_warning boolean not null default false,
  add column if not exists is_test boolean not null default false;

update public.requisitions r
set requested_by_profile_id = coalesce(r.requested_by_profile_id, r.requested_by),
    requested_by_name = coalesce(r.requested_by_name, p.full_name, p.username),
    requested_by_role = coalesce(r.requested_by_role, p.role)
from public.profiles p
where p.id = r.requested_by
  and (r.requested_by_profile_id is null or r.requested_by_name is null or r.requested_by_role is null);

update public.requisition_items
set requested_unit = coalesce(requested_unit, unit),
    availability_status = coalesce(availability_status, 'Disponible')
where requested_unit is null or availability_status is null;

alter table public.requisition_items
  alter column availability_status set default 'Disponible';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requisition_items_availability_status_check'
      and conrelid = 'public.requisition_items'::regclass
  ) then
    alter table public.requisition_items
      add constraint requisition_items_availability_status_check
      check (availability_status in ('Disponible', 'Parcial', 'Sin stock'));
  end if;
exception
  when others then null;
end $$;

alter table public.purchase_orders
  add column if not exists is_test boolean not null default false;

alter table public.inventory_movements
  add column if not exists is_test boolean not null default false;

create index if not exists requisitions_is_test_idx on public.requisitions (is_test);
create index if not exists purchase_orders_is_test_idx on public.purchase_orders (is_test);
create index if not exists inventory_movements_is_test_idx on public.inventory_movements (is_test);

create or replace function public.can_create_test_flow()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
      and status = 'active'
  );
$$;

revoke all on function public.can_create_test_flow() from public;
grant execute on function public.can_create_test_flow() to authenticated;

create or replace function public.process_test_purchase_order_receipt(p_order public.purchase_orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_data jsonb;
  catalog_item public.inventory_items;
  qty numeric;
  sku_text text;
begin
  if not coalesce(p_order.is_test, false) then
    return;
  end if;

  for item_data in
    select value
    from jsonb_array_elements(coalesce(p_order.data -> 'items', '[]'::jsonb))
  loop
    qty := coalesce(
      nullif(item_data ->> 'cantidadRecibidaReal', '')::numeric,
      nullif(item_data ->> 'cantidadComprar', '')::numeric,
      nullif(item_data ->> 'quantity', '')::numeric,
      0
    );
    if qty <= 0 then
      continue;
    end if;

    sku_text := nullif(trim(coalesce(item_data ->> 'sku', item_data ->> 'codigo', item_data ->> 'codigoBarras', '')), '');
    select * into catalog_item
    from public.inventory_items
    where active = true
      and (
        (sku_text is not null and sku = sku_text)
        or lower(name) = lower(coalesce(item_data ->> 'nombre', item_data ->> 'name', ''))
      )
    order by created_at
    limit 1;

    if catalog_item.id is null then
      continue;
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit,
      previous_quantity, new_quantity, source_type, source_id, notes, performed_by, is_test
    ) values (
      catalog_item.id,
      'purchase',
      'almacen',
      qty,
      coalesce(catalog_item.base_unit, 'unidad'),
      null,
      null,
      'purchase_order_test',
      p_order.id,
      'PRUEBA: recepcion simulada de ' || coalesce(p_order.order_number, p_order.id),
      auth.uid(),
      true
    );
  end loop;
end;
$$;

revoke all on function public.process_test_purchase_order_receipt(public.purchase_orders) from public;
grant execute on function public.process_test_purchase_order_receipt(public.purchase_orders) to authenticated;

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
  conversion_missing boolean;
  is_test_flow boolean := coalesce((p_data ->> 'is_test')::boolean, false);
begin
  if is_test_flow and not public.can_create_test_flow() then
    raise exception 'Solo Administracion puede crear pruebas de flujo.';
  end if;
  if requester_id is null then raise exception 'Selecciona quien esta haciendo la requisicion.'; end if;
  select * into requester from public.profiles where id = requester_id and status = 'active';
  if requester.id is null then raise exception 'Selecciona quien esta haciendo la requisicion.'; end if;
  if not public.can_request_requisition_to_area(to_id) then raise exception 'No tienes permiso para solicitar inventario hacia esta area.'; end if;
  if from_id is null or to_id is null or from_id = to_id then raise exception 'Selecciona areas de origen y destino diferentes.'; end if;
  if not exists (select 1 from public.areas where id = from_id and active = true)
    or not exists (select 1 from public.areas where id = to_id and active = true) then
    raise exception 'El area de origen o destino no esta activa.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un producto a la requisicion.'; end if;

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

    requested_unit := coalesce(nullif(trim(row_data ->> 'requested_unit'), ''), catalog_item.base_unit);
    conversion_factor := public.resolve_inventory_unit_factor(requested_unit, catalog_item.base_unit);
    converted_qty := requested_qty * conversion_factor;
    conversion_missing := not public.has_inventory_unit_conversion(requested_unit, catalog_item.base_unit);

    select quantity, minimum_quantity into source_stock, source_minimum
    from public.area_inventory
    where item_id = catalog_item.id and area_id = from_id;
    source_stock := coalesce(source_stock, 0);
    source_minimum := coalesce(source_minimum, 0);
    availability := case when source_stock <= 0 then 'Sin stock' when source_stock < converted_qty then 'Parcial' else 'Disponible' end;

    insert into public.requisition_items (
      requisition_id, item_id, item_name, unit, requested_quantity, approved_quantity,
      requested_unit, conversion_factor, converted_requested_quantity, availability_status,
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes, is_test
    ) values (
      created.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, conversion_missing, nullif(trim(row_data ->> 'notes'), ''),
      is_test_flow
    );
  end loop;

  return created;
end;
$$;

create or replace function public.complete_requisition(p_requisition_id uuid)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  requisition public.requisitions;
  detail public.requisition_items;
  moved_quantity numeric;
  source_before numeric;
  destination_before numeric;
  movement_unit text;
  completed public.requisitions;
begin
  if not public.is_profile_manager() then raise exception 'No tienes permiso para completar traslados.'; end if;
  select * into requisition from public.requisitions where id = p_requisition_id for update;
  if requisition.id is null or requisition.status <> 'approved' then raise exception 'La requisición debe estar aprobada antes del traslado.'; end if;
  if not exists (select 1 from public.requisition_items where requisition_id = p_requisition_id) then raise exception 'La requisición no tiene productos.'; end if;

  for detail in select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    moved_quantity := coalesce(detail.converted_approved_quantity, detail.converted_requested_quantity, detail.approved_quantity, detail.requested_quantity);
    if moved_quantity <= 0 then raise exception 'La cantidad para % no es valida.', detail.item_name; end if;
    select base_unit into movement_unit from public.inventory_items where id = detail.item_id;
    movement_unit := coalesce(movement_unit, detail.unit);

    if coalesce(requisition.is_test, false) then
      insert into public.inventory_movements (
        item_id, movement_type, from_area_id, to_area_id, quantity, unit,
        previous_quantity, new_quantity, source_type, source_id, notes, performed_by, is_test
      ) values (
        detail.item_id, 'transfer', requisition.from_area_id, requisition.to_area_id,
        moved_quantity, movement_unit, null, null,
        'requisition_test', requisition.id::text,
        'PRUEBA: traslado simulado ' || requisition.requisition_number ||
          '. Solicitado: ' || detail.requested_quantity || ' ' || coalesce(detail.requested_unit, detail.unit),
        auth.uid(),
        true
      );
      continue;
    end if;

    select quantity into source_before from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.from_area_id for update;
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
      values (detail.item_id, requisition.to_area_id, 0, 0)
      on conflict (item_id, area_id) do nothing;
    select quantity into destination_before from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.to_area_id for update;

    source_before := coalesce(source_before, 0);
    destination_before := coalesce(destination_before, 0);

    update public.area_inventory set quantity = source_before - moved_quantity
      where item_id = detail.item_id and area_id = requisition.from_area_id;
    update public.area_inventory set quantity = destination_before + moved_quantity
      where item_id = detail.item_id and area_id = requisition.to_area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, to_area_id, quantity, unit,
      previous_quantity, new_quantity, source_type, source_id, notes, performed_by, is_test
    ) values (
      detail.item_id, 'transfer', requisition.from_area_id, requisition.to_area_id,
      moved_quantity, movement_unit, source_before, source_before - moved_quantity,
      'requisition', requisition.id::text,
      'Traslado requisicion ' || requisition.requisition_number ||
        '. Solicitado: ' || detail.requested_quantity || ' ' || coalesce(detail.requested_unit, detail.unit) ||
        '. Destino antes: ' || destination_before || ', despues: ' || (destination_before + moved_quantity),
      auth.uid(),
      false
    );
  end loop;

  update public.requisitions
    set status = 'completed', completed_by = auth.uid(), completed_at = now()
    where id = p_requisition_id
    returning * into completed;
  return completed;
end;
$$;

create or replace function public.save_purchase_order(p_data jsonb)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_profile_role();
  order_id text := nullif(trim(p_data ->> 'id'), '');
  next_status text := nullif(trim(p_data ->> 'status'), '');
  current_order public.purchase_orders;
  saved_order public.purchase_orders;
  is_test_flow boolean := coalesce((p_data ->> 'is_test')::boolean, false);
  previous_status text;
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'encargado_almacen') then
    raise exception 'No tienes permiso para operar ordenes de compra.';
  end if;
  if order_id is null or nullif(trim(p_data ->> 'numeroOrden'), '') is null then
    raise exception 'La orden no contiene identificador o numero.';
  end if;
  if is_test_flow and not public.can_create_test_flow() then
    raise exception 'Solo Administracion puede crear pruebas de flujo.';
  end if;

  select * into current_order from public.purchase_orders where id = order_id;

  if current_order.id is null then
    if actor_role in ('gerente', 'encargado_almacen') then
      next_status := 'pendiente_aprobacion';
      p_data := jsonb_set(p_data, '{status}', to_jsonb(next_status));
    end if;
    insert into public.purchase_orders (
      id, order_number, status, data, created_by, created_by_role, is_test
    )
    values (
      order_id, p_data ->> 'numeroOrden', next_status, p_data, auth.uid(), actor_role, is_test_flow
    )
    returning * into saved_order;
    return saved_order;
  end if;

  is_test_flow := coalesce(current_order.is_test, is_test_flow, false);
  previous_status := current_order.status;

  if current_order.status <> next_status then
    if next_status in ('aprobada', 'rechazada') and actor_role not in ('admin', 'gerente_general') then
      raise exception 'Solo Admin o Gerente General pueden aprobar o rechazar ordenes.';
    elsif next_status = 'enviada_proveedor' and current_order.status <> 'aprobada' then
      raise exception 'Solo una orden aprobada puede enviarse al proveedor.';
    elsif next_status in ('recibida_parcial', 'recibida_completa')
      and (actor_role not in ('admin', 'gerente_general', 'encargado_almacen')
        or current_order.status not in ('aprobada', 'enviada_proveedor')) then
      raise exception 'La orden no esta lista para recepcion.';
    end if;
  end if;

  p_data := jsonb_set(p_data, '{is_test}', to_jsonb(is_test_flow));

  update public.purchase_orders
  set
    order_number = p_data ->> 'numeroOrden',
    status = next_status,
    data = p_data,
    is_test = is_test_flow,
    updated_at = now()
  where id = order_id
  returning * into saved_order;

  if is_test_flow
    and previous_status not in ('recibida_parcial', 'recibida_completa')
    and next_status in ('recibida_parcial', 'recibida_completa') then
    perform public.process_test_purchase_order_receipt(saved_order);
  end if;

  return saved_order;
end;
$$;

revoke all on function public.can_create_test_flow() from public;
grant execute on function public.can_create_test_flow() to authenticated;

revoke all on function
  public.create_requisition(jsonb, jsonb, boolean),
  public.complete_requisition(uuid),
  public.save_purchase_order(jsonb)
from public;

grant execute on function
  public.create_requisition(jsonb, jsonb, boolean),
  public.complete_requisition(uuid),
  public.save_purchase_order(jsonb)
to authenticated;
