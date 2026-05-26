-- Product images for the Supabase inventory catalog.
-- Apply after 004_inventory.sql.

alter table public.inventory_items
  add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-images',
  'inventory-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "inventory_images_public_read" on storage.objects;
create policy "inventory_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'inventory-images');

drop policy if exists "inventory_images_managers_insert" on storage.objects;
create policy "inventory_images_managers_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'inventory-images'
    and public.is_profile_manager()
  );

drop policy if exists "inventory_images_managers_update" on storage.objects;
create policy "inventory_images_managers_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'inventory-images'
    and public.is_profile_manager()
  )
  with check (
    bucket_id = 'inventory-images'
    and public.is_profile_manager()
  );

drop policy if exists "inventory_images_managers_delete" on storage.objects;
create policy "inventory_images_managers_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'inventory-images'
    and public.is_profile_manager()
  );

-- Replace the bulk importer so optional image URLs from spreadsheets are preserved.
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
  if not public.is_profile_manager() then
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
        cost_per_base_unit = (row_data ->> 'cost_per_base_unit')::numeric,
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
    select inventory_item.id, areas.id, 0, 0
    from public.areas
    where areas.active = true
    on conflict (item_id, area_id) do nothing;

    select quantity into previous_value
    from public.area_inventory
    where item_id = inventory_item.id
      and area_id = row_data ->> 'area_id'
    for update;

    update public.area_inventory
    set
      quantity = (row_data ->> 'quantity')::numeric,
      minimum_quantity = (row_data ->> 'minimum_quantity')::numeric
    where item_id = inventory_item.id
      and area_id = row_data ->> 'area_id';

    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, notes, performed_by
    )
    values (
      inventory_item.id, 'adjustment', row_data ->> 'area_id',
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
