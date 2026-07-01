-- Default requisition unit per product + strict unit conversion for requisitions.
-- Apply after 145_requisition_area_security_v2.sql.

alter table public.inventory_items
  add column if not exists default_requisition_unit text;

update public.inventory_items
set default_requisition_unit = coalesce(nullif(trim(default_requisition_unit), ''), base_unit)
where default_requisition_unit is null or trim(default_requisition_unit) = '';

-- ---------------------------------------------------------------------------
-- Extended unit normalization
-- ---------------------------------------------------------------------------

create or replace function public.normalize_inventory_unit(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select replace(
      translate(
        lower(trim(coalesce(p_unit, ''))),
        'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜ',
        'aeiouAEIOUaeiouAEIOU'
      ),
      ' ',
      '_'
    ) as unit_key
  )
  select case
    when unit_key in ('', '_') then ''
    when unit_key in ('unidad', 'unidades', 'u', 'unit', 'units', 'pieza', 'piezas', 'piece', 'pieces') then 'unidad'
    when unit_key in ('unidad_pieza', 'unidad/pieza', 'unidad-pieza') then 'unidad'
    when unit_key in ('libra', 'libras', 'lb', 'lbs') then 'libra'
    when unit_key in ('onza', 'onzas', 'oz') then 'onza'
    when unit_key in ('kilogramo', 'kilogramos', 'kg', 'kilo', 'kilos') then 'kilogramo'
    when unit_key in ('gramo', 'gramos', 'g', 'gr') then 'gramo'
    when unit_key in ('mililitro', 'mililitros', 'ml', 'cc') then 'mililitro'
    when unit_key in ('litro', 'litros', 'l') then 'litro'
    when unit_key in ('galon', 'galones', 'gal') then 'galon'
    when unit_key in ('onza_liquida', 'onza_liq', 'fl_oz', 'floz') then 'onza_liquida'
    when unit_key in ('caja', 'cajas', 'box', 'boxes') then 'caja'
    when unit_key in ('paquete', 'paquetes', 'pack', 'packs') then 'paquete'
    when unit_key in ('bolsa', 'bolsas', 'bag', 'bags') then 'bolsa'
    when unit_key in ('lata', 'latas', 'can', 'cans') then 'lata'
    when unit_key in ('botella', 'botellas', 'bottle', 'bottles') then 'botella'
    when unit_key in ('quintal', 'quintales') then 'quintal'
    when unit_key in ('manojo', 'manojos') then 'manojo'
    else unit_key
  end
  from normalized;
$$;

-- ---------------------------------------------------------------------------
-- Global conversions (strict lookup, no silent fallback to 1)
-- ---------------------------------------------------------------------------

insert into public.inventory_unit_conversions (from_unit, to_unit, factor)
values
  ('libra', 'gramo', 453.592),
  ('gramo', 'libra', 0.00220462),
  ('onza', 'gramo', 28.3495),
  ('gramo', 'onza', 0.035274),
  ('litro', 'mililitro', 1000),
  ('mililitro', 'litro', 0.001),
  ('galon', 'mililitro', 3785.41),
  ('mililitro', 'galon', 0.000264172),
  ('onza_liquida', 'mililitro', 29.5735),
  ('mililitro', 'onza_liquida', 0.033814)
on conflict (from_unit, to_unit) do update
set factor = excluded.factor,
    updated_at = now();

create or replace function public.try_global_unit_factor(p_from_unit text, p_to_unit text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.normalize_inventory_unit(p_from_unit) = public.normalize_inventory_unit(p_to_unit) then 1::numeric
    else coalesce(
      (
        select c.factor
        from public.inventory_unit_conversions c
        where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_from_unit)
          and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_to_unit)
        limit 1
      ),
      (
        select 1 / c.factor
        from public.inventory_unit_conversions c
        where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_to_unit)
          and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_from_unit)
          and c.factor > 0
        limit 1
      )
    )
  end;
$$;

create or replace function public.resolve_inventory_unit_factor(p_from_unit text, p_to_unit text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.try_global_unit_factor(p_from_unit, p_to_unit);
$$;

create or replace function public.has_inventory_unit_conversion(p_from_unit text, p_to_unit text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.try_global_unit_factor(p_from_unit, p_to_unit) is not null;
$$;

create or replace function public.resolve_item_requisition_unit_factor(
  p_item_id uuid,
  p_requested_unit text
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item_row public.inventory_items;
  requested text := nullif(trim(p_requested_unit), '');
  factor numeric;
begin
  if p_item_id is null then
    raise exception 'Producto invalido en la requisicion.';
  end if;
  if requested is null then
    raise exception 'Debes indicar la unidad solicitada.';
  end if;

  select * into item_row from public.inventory_items where id = p_item_id;
  if item_row.id is null then
    raise exception 'Producto no encontrado.';
  end if;

  if public.normalize_inventory_unit(requested) = public.normalize_inventory_unit(item_row.base_unit) then
    return 1;
  end if;

  if item_row.purchase_unit is not null
     and public.normalize_inventory_unit(requested) = public.normalize_inventory_unit(item_row.purchase_unit) then
    return greatest(coalesce(item_row.conversion_factor, 1), 0.0000001);
  end if;

  factor := public.try_global_unit_factor(requested, item_row.base_unit);
  if factor is not null then
    return factor;
  end if;

  raise exception
    'La unidad % no esta configurada para el producto %. Corrige la unidad o configura la conversion antes de enviar.',
    requested,
    item_row.name;
end;
$$;

create or replace function public.has_item_requisition_unit_conversion(
  p_item_id uuid,
  p_requested_unit text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.resolve_item_requisition_unit_factor(p_item_id, p_requested_unit);
  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function public.try_global_unit_factor(text, text) from public;
grant execute on function public.try_global_unit_factor(text, text) to authenticated;

revoke all on function public.resolve_item_requisition_unit_factor(uuid, text) from public;
grant execute on function public.resolve_item_requisition_unit_factor(uuid, text) to authenticated;

revoke all on function public.has_item_requisition_unit_conversion(uuid, text) from public;
grant execute on function public.has_item_requisition_unit_conversion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Requisition RPCs: strict conversion on create/update draft
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
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes, is_test
    ) values (
      created.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, false, nullif(trim(row_data ->> 'notes'), ''),
      is_test_flow
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
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes, is_test
    ) values (
      updated.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, false, nullif(trim(row_data ->> 'notes'), ''),
      coalesce(current_row.is_test, false)
    );
  end loop;
  return updated;
end;
$$;

revoke all on function public.create_requisition(jsonb, jsonb, boolean) from public;
grant execute on function public.create_requisition(jsonb, jsonb, boolean) to authenticated;

revoke all on function public.update_draft_requisition(uuid, jsonb, jsonb) from public;
grant execute on function public.update_draft_requisition(uuid, jsonb, jsonb) to authenticated;

create or replace function public.submit_requisition(p_requisition_id uuid)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.requisitions;
  submitted public.requisitions;
  detail public.requisition_items;
  catalog_item public.inventory_items;
  resolved_factor numeric;
begin
  select * into current_row from public.requisitions where id = p_requisition_id;
  if current_row.id is null then
    raise exception 'No se pudo enviar la requisicion.';
  end if;
  if current_row.status <> 'draft' then
    raise exception 'Solo se pueden enviar requisiciones en borrador.';
  end if;
  if current_row.requested_by <> auth.uid() and not public.is_profile_manager() then
    raise exception 'No tienes permiso para enviar esta requisicion.';
  end if;

  perform public.assert_requisition_request_permissions(
    current_row.from_area_id,
    current_row.to_area_id,
    current_row.requested_by_profile_id
  );

  for detail in
    select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    if coalesce(detail.conversion_warning, false) then
      continue;
    end if;
    select * into catalog_item from public.inventory_items where id = detail.item_id;
    if catalog_item.id is null then
      raise exception 'La requisicion contiene un producto inexistente.';
    end if;
    resolved_factor := public.resolve_item_requisition_unit_factor(
      catalog_item.id,
      coalesce(nullif(trim(detail.requested_unit), ''), detail.unit, catalog_item.default_requisition_unit, catalog_item.base_unit)
    );
    if resolved_factor is null or resolved_factor <= 0 then
      raise exception
        'La unidad % no esta configurada para el producto %. Corrige la unidad o configura la conversion antes de enviar.',
        coalesce(detail.requested_unit, detail.unit),
        detail.item_name;
    end if;
  end loop;

  update public.requisitions
  set status = 'pending', submitted_at = now()
  where id = p_requisition_id
    and status = 'draft'
    and (requested_by = auth.uid() or public.is_profile_manager())
  returning * into submitted;

  if submitted.id is null then
    raise exception 'No se pudo enviar la requisicion.';
  end if;
  return submitted;
end;
$$;

revoke all on function public.submit_requisition(uuid) from public;
grant execute on function public.submit_requisition(uuid) to authenticated;
