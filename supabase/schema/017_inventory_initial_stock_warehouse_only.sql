-- Initial inventory loads belong only to Almacen.
-- Safe to run even if 016_inventory_purchase_price.sql was not applied.
-- This does not delete existing zero-quantity rows from operational areas.

alter table public.inventory_items
  add column if not exists purchase_price numeric;

alter table public.inventory_items
  drop constraint if exists inventory_items_purchase_price_check;

alter table public.inventory_items
  add constraint inventory_items_purchase_price_check
  check (purchase_price is null or purchase_price >= 0);

create or replace function public.import_inventory_rows(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row_data jsonb;
  inventory_item public.inventory_items;
  previous_value numeric;
  was_existing boolean;
  created_count integer := 0;
  updated_count integer := 0;
  stock_count integer := 0;
  movement_count integer := 0;
begin
  if not public.is_inventory_manager() then
    raise exception 'No tienes permiso para importar inventario.';
  end if;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(trim(row_data ->> 'name'), '') is null or nullif(trim(row_data ->> 'base_unit'), '') is null then
      raise exception 'La importacion contiene una fila sin nombre o unidad base.';
    end if;

    inventory_item := null;
    if nullif(trim(row_data ->> 'matched_item_id'), '') is not null then
      select * into inventory_item
      from public.inventory_items
      where id = (row_data ->> 'matched_item_id')::uuid;
    elsif nullif(trim(row_data ->> 'sku'), '') is not null then
      select * into inventory_item
      from public.inventory_items
      where sku = nullif(trim(row_data ->> 'sku'), '');
    end if;

    was_existing := inventory_item.id is not null;
    if was_existing then
      update public.inventory_items
      set
        name = trim(row_data ->> 'name'),
        sku = nullif(trim(row_data ->> 'sku'), ''),
        category = nullif(trim(row_data ->> 'category'), ''),
        purchase_unit = nullif(trim(row_data ->> 'purchase_unit'), ''),
        base_unit = trim(row_data ->> 'base_unit'),
        conversion_factor = (row_data ->> 'conversion_factor')::numeric,
        cost_per_base_unit = case
          when inventory_item.purchase_price is not null
            then inventory_item.purchase_price / (row_data ->> 'conversion_factor')::numeric
          else (row_data ->> 'cost_per_base_unit')::numeric
        end,
        supplier = nullif(trim(row_data ->> 'supplier'), ''),
        image_url = coalesce(nullif(trim(row_data ->> 'image_url'), ''), image_url),
        notes = 'Importado desde Excel/CSV',
        active = true
      where id = inventory_item.id
      returning * into inventory_item;
      updated_count := updated_count + 1;
    else
      insert into public.inventory_items (
        name, sku, category, purchase_unit, base_unit, conversion_factor,
        cost_per_base_unit, supplier, image_url, notes, active
      )
      values (
        trim(row_data ->> 'name'),
        nullif(trim(row_data ->> 'sku'), ''),
        nullif(trim(row_data ->> 'category'), ''),
        nullif(trim(row_data ->> 'purchase_unit'), ''),
        trim(row_data ->> 'base_unit'),
        (row_data ->> 'conversion_factor')::numeric,
        (row_data ->> 'cost_per_base_unit')::numeric,
        nullif(trim(row_data ->> 'supplier'), ''),
        nullif(trim(row_data ->> 'image_url'), ''),
        'Importado desde Excel/CSV',
        true
      )
      returning * into inventory_item;
      created_count := created_count + 1;
    end if;

    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
    values (inventory_item.id, 'almacen', 0, 0)
    on conflict (item_id, area_id) do nothing;

    select quantity into previous_value
    from public.area_inventory
    where item_id = inventory_item.id
      and area_id = 'almacen'
    for update;

    update public.area_inventory
    set
      quantity = (row_data ->> 'quantity')::numeric,
      minimum_quantity = (row_data ->> 'minimum_quantity')::numeric
    where item_id = inventory_item.id
      and area_id = 'almacen';

    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, notes, performed_by
    )
    values (
      inventory_item.id, 'adjustment', 'almacen',
      abs((row_data ->> 'quantity')::numeric - previous_value),
      row_data ->> 'base_unit', previous_value, (row_data ->> 'quantity')::numeric,
      'file_import', 'Importacion Excel/CSV', auth.uid()
    );

    stock_count := stock_count + 1;
    movement_count := movement_count + 1;
  end loop;

  return jsonb_build_object(
    'created', created_count,
    'updated', updated_count,
    'stocks', stock_count,
    'movements', movement_count
  );
end;
$$;

revoke all on function public.import_inventory_rows(jsonb) from public;
grant execute on function public.import_inventory_rows(jsonb) to authenticated;
