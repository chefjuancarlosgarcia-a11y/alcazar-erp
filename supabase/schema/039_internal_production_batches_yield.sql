-- Yield-based internal production batches.
-- Apply after 038_internal_production.sql.

alter table public.production_batches
  add column if not exists batch_multiplier numeric not null default 1 check (batch_multiplier > 0),
  add column if not exists expected_output_quantity numeric,
  add column if not exists actual_output_quantity numeric,
  add column if not exists yield_quantity numeric,
  add column if not exists yield_unit text,
  add column if not exists cost_per_batch numeric not null default 0 check (cost_per_batch >= 0),
  add column if not exists total_batch_cost numeric not null default 0 check (total_batch_cost >= 0),
  add column if not exists actual_unit_cost numeric not null default 0 check (actual_unit_cost >= 0);

update public.production_batches
set
  expected_output_quantity = coalesce(expected_output_quantity, expected_quantity, output_quantity),
  actual_output_quantity = coalesce(actual_output_quantity, output_quantity),
  yield_quantity = coalesce(yield_quantity, expected_quantity, output_quantity),
  yield_unit = coalesce(yield_unit, output_unit),
  total_batch_cost = coalesce(nullif(total_batch_cost, 0), total_cost),
  actual_unit_cost = coalesce(nullif(actual_unit_cost, 0), unit_cost)
where expected_output_quantity is null
   or actual_output_quantity is null
   or yield_quantity is null
   or yield_unit is null;

create or replace function public.create_internal_production_batch(
  p_batch jsonb,
  p_inputs jsonb,
  p_outputs jsonb
)
returns public.production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.production_batches;
  area_record public.areas;
  recipe_record public.standard_recipes;
  output_item public.inventory_items;
  row_data jsonb;
  input_item public.inventory_items;
  batch_multiplier_value numeric := greatest(0, coalesce((p_batch ->> 'batch_multiplier')::numeric, 1));
  yield_qty numeric;
  expected_output_qty numeric;
  actual_output_qty numeric := coalesce((p_batch ->> 'actual_output_quantity')::numeric, (p_batch ->> 'output_quantity')::numeric, 0);
  cost_per_batch_value numeric := 0;
begin
  if batch_multiplier_value <= 0 then
    raise exception 'Las tandas a producir deben ser mayores que cero.';
  end if;

  select * into area_record
  from public.areas
  where id = nullif(trim(p_batch ->> 'production_area_id'), '') and active = true;
  if area_record.id is null then
    raise exception 'Selecciona un area activa.';
  end if;

  if not public.can_create_internal_production(area_record.id) then
    raise exception 'No tienes permiso para crear produccion en esta area.';
  end if;

  if nullif(trim(p_batch ->> 'recipe_id'), '') is not null then
    select * into recipe_record
    from public.standard_recipes
    where id = (p_batch ->> 'recipe_id')::uuid and active = true;
    if recipe_record.id is null then
      raise exception 'La receta seleccionada no existe o esta inactiva.';
    end if;
    if recipe_record.output_inventory_item_id is null then
      raise exception 'La receta seleccionada no tiene producto terminado configurado.';
    end if;
  end if;

  select * into output_item
  from public.inventory_items
  where id = (p_batch ->> 'output_inventory_item_id')::uuid and active = true;
  if output_item.id is null then
    raise exception 'Selecciona un producto terminado activo.';
  end if;
  if recipe_record.id is not null and output_item.id <> recipe_record.output_inventory_item_id then
    raise exception 'El producto terminado no corresponde a la receta seleccionada.';
  end if;

  yield_qty := coalesce(recipe_record.yield_quantity, nullif((p_batch ->> 'yield_quantity'), '')::numeric, actual_output_qty);
  expected_output_qty := yield_qty * batch_multiplier_value;
  actual_output_qty := coalesce(nullif(actual_output_qty, 0), expected_output_qty);
  if actual_output_qty <= 0 then
    raise exception 'La produccion real debe ser mayor que cero.';
  end if;
  cost_per_batch_value := coalesce(recipe_record.estimated_cost, 0);

  insert into public.production_batches (
    batch_number, production_area_id, production_area_name, recipe_id,
    output_inventory_item_id, output_name, output_quantity, output_unit, status,
    started_at, produced_by, notes, expected_quantity, waste_quantity,
    batch_multiplier, expected_output_quantity, actual_output_quantity,
    yield_quantity, yield_unit, cost_per_batch, total_batch_cost, unit_cost, actual_unit_cost
  )
  values (
    public.next_production_batch_number(), area_record.id, area_record.name, recipe_record.id,
    output_item.id, output_item.name, actual_output_qty, output_item.base_unit, 'in_progress',
    now(), auth.uid(), nullif(trim(p_batch ->> 'notes'), ''), expected_output_qty,
    greatest(0, expected_output_qty - actual_output_qty),
    batch_multiplier_value, expected_output_qty, actual_output_qty,
    yield_qty, coalesce(nullif(trim(recipe_record.yield_unit), ''), output_item.base_unit),
    cost_per_batch_value, cost_per_batch_value * batch_multiplier_value,
    case when actual_output_qty > 0 then (cost_per_batch_value * batch_multiplier_value) / actual_output_qty else 0 end,
    case when actual_output_qty > 0 then (cost_per_batch_value * batch_multiplier_value) / actual_output_qty else 0 end
  )
  returning * into created;

  for row_data in select value from jsonb_array_elements(coalesce(p_inputs, '[]'::jsonb))
  loop
    select * into input_item
    from public.inventory_items
    where id = (row_data ->> 'inventory_item_id')::uuid and active = true;
    if input_item.id is null then
      raise exception 'La produccion contiene un insumo inactivo o inexistente.';
    end if;
    insert into public.production_batch_inputs (
      batch_id, inventory_item_id, item_name, quantity, unit, cost_unit, total_cost
    )
    values (
      created.id, input_item.id, input_item.name,
      greatest(0, coalesce((row_data ->> 'quantity')::numeric, 0)) * batch_multiplier_value,
      input_item.base_unit, input_item.cost_per_base_unit,
      greatest(0, coalesce((row_data ->> 'quantity')::numeric, 0)) * batch_multiplier_value * input_item.cost_per_base_unit
    );
  end loop;

  insert into public.production_batch_outputs (
    batch_id, inventory_item_id, item_name, quantity, unit, unit_cost, total_cost
  )
  values (
    created.id, output_item.id, output_item.name, actual_output_qty, output_item.base_unit,
    created.actual_unit_cost, created.total_batch_cost
  );

  return created;
end;
$$;

create or replace function public.complete_internal_production_batch(p_batch_id uuid)
returns public.production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.production_batches;
  input_row public.production_batch_inputs;
  output_row public.production_batch_outputs;
  stock_before numeric;
  stock_after numeric;
  batch_total numeric := 0;
  output_total numeric := 0;
  unit_cost_value numeric := 0;
begin
  select * into batch
  from public.production_batches
  where id = p_batch_id
  for update;

  if batch.id is null then raise exception 'La produccion no existe.'; end if;
  if batch.status not in ('draft', 'in_progress') then raise exception 'Solo se puede completar una produccion abierta.'; end if;
  if not public.can_create_internal_production(batch.production_area_id) then raise exception 'No tienes permiso para completar esta produccion.'; end if;
  if batch.output_inventory_item_id is null then raise exception 'La receta seleccionada no tiene producto terminado configurado.'; end if;
  if coalesce(batch.actual_output_quantity, batch.output_quantity, 0) <= 0 then raise exception 'La produccion real debe ser mayor que cero.'; end if;
  if batch.recipe_id is not null and not exists (
    select 1
    from public.standard_recipes recipe
    where recipe.id = batch.recipe_id
      and recipe.output_inventory_item_id = batch.output_inventory_item_id
  ) then
    raise exception 'La receta seleccionada no tiene producto terminado configurado.';
  end if;

  for input_row in select * from public.production_batch_inputs where batch_id = batch.id
  loop
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
    values (input_row.inventory_item_id, batch.production_area_id, 0, 0)
    on conflict (item_id, area_id) do nothing;

    select quantity into stock_before
    from public.area_inventory
    where item_id = input_row.inventory_item_id and area_id = batch.production_area_id
    for update;
    stock_before := coalesce(stock_before, 0);
    stock_after := stock_before - input_row.quantity;
    if stock_after < 0 then
      raise exception 'Stock insuficiente de %. Disponible: %, requerido: %.',
        input_row.item_name, stock_before, input_row.quantity;
    end if;

    update public.area_inventory
    set quantity = stock_after
    where item_id = input_row.inventory_item_id and area_id = batch.production_area_id;

    update public.production_batch_inputs
    set area_stock_before = stock_before,
        area_stock_after = stock_after,
        total_cost = input_row.quantity * input_row.cost_unit
    where id = input_row.id;

    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    )
    values (
      input_row.inventory_item_id, 'production_input', batch.production_area_id,
      input_row.quantity, input_row.unit, stock_before, stock_after,
      'internal_production', batch.id::text,
      'Insumo usado en produccion ' || batch.batch_number, auth.uid()
    );

    batch_total := batch_total + (input_row.quantity * input_row.cost_unit);
  end loop;

  select coalesce(sum(quantity), 0) into output_total
  from public.production_batch_outputs
  where batch_id = batch.id;

  if output_total <= 0 then raise exception 'La produccion debe tener una salida mayor que cero.'; end if;
  unit_cost_value := batch_total / output_total;

  for output_row in select * from public.production_batch_outputs where batch_id = batch.id
  loop
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
    values (output_row.inventory_item_id, batch.production_area_id, 0, 0)
    on conflict (item_id, area_id) do nothing;

    select quantity into stock_before
    from public.area_inventory
    where item_id = output_row.inventory_item_id and area_id = batch.production_area_id
    for update;
    stock_before := coalesce(stock_before, 0);
    stock_after := stock_before + output_row.quantity;

    update public.area_inventory
    set quantity = stock_after
    where item_id = output_row.inventory_item_id and area_id = batch.production_area_id;

    update public.production_batch_outputs
    set unit_cost = unit_cost_value,
        total_cost = output_row.quantity * unit_cost_value,
        area_stock_before = stock_before,
        area_stock_after = stock_after
    where id = output_row.id;

    update public.inventory_items
    set cost_per_base_unit = unit_cost_value
    where id = output_row.inventory_item_id;

    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    )
    values (
      output_row.inventory_item_id, 'production_output', batch.production_area_id,
      output_row.quantity, output_row.unit, stock_before, stock_after,
      'internal_production', batch.id::text,
      'Salida de produccion ' || batch.batch_number, auth.uid()
    );
  end loop;

  update public.production_batches
  set status = 'completed',
      completed_at = now(),
      approved_by = auth.uid(),
      total_cost = batch_total,
      total_batch_cost = batch_total,
      unit_cost = unit_cost_value,
      actual_unit_cost = unit_cost_value,
      output_quantity = output_total,
      actual_output_quantity = output_total,
      waste_quantity = greatest(0, coalesce(expected_output_quantity, expected_quantity, output_total) - output_total),
      updated_at = now()
  where id = batch.id
  returning * into batch;

  return batch;
end;
$$;

grant execute on function
  public.create_internal_production_batch(jsonb, jsonb, jsonb),
  public.complete_internal_production_batch(uuid)
to authenticated;
