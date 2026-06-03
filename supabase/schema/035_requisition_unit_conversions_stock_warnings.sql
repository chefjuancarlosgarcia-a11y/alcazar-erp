-- Requisition unit conversions and non-blocking stock availability.
-- Apply after 025_requisition_requested_by_profile.sql.

create table if not exists public.inventory_unit_conversions (
  from_unit text not null,
  to_unit text not null,
  factor numeric not null check (factor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (from_unit, to_unit),
  check (nullif(trim(from_unit), '') is not null),
  check (nullif(trim(to_unit), '') is not null),
  check (lower(trim(from_unit)) <> lower(trim(to_unit)))
);

alter table public.inventory_unit_conversions enable row level security;

grant select on public.inventory_unit_conversions to authenticated;
grant all on public.inventory_unit_conversions to service_role;

drop policy if exists "inventory_unit_conversions_authenticated_read" on public.inventory_unit_conversions;
create policy "inventory_unit_conversions_authenticated_read"
  on public.inventory_unit_conversions for select to authenticated
  using (true);

insert into public.inventory_unit_conversions (from_unit, to_unit, factor)
values
  ('libra', 'onza', 16),
  ('onza', 'libra', 0.0625),
  ('kilogramo', 'gramo', 1000),
  ('gramo', 'kilogramo', 0.001),
  ('kg', 'gramo', 1000),
  ('gramo', 'kg', 0.001)
on conflict (from_unit, to_unit) do update
set factor = excluded.factor,
    updated_at = now();

alter table public.requisition_items
  add column if not exists requested_unit text,
  add column if not exists conversion_factor numeric,
  add column if not exists converted_requested_quantity numeric,
  add column if not exists converted_approved_quantity numeric,
  add column if not exists availability_status text not null default 'Disponible'
    check (availability_status in ('Disponible', 'Parcial', 'Sin stock')),
  add column if not exists stock_available_at_request numeric,
  add column if not exists stock_minimum_at_request numeric,
  add column if not exists conversion_warning boolean not null default false;

update public.requisition_items
set requested_unit = coalesce(requested_unit, unit),
    conversion_factor = coalesce(conversion_factor, 1),
    converted_requested_quantity = coalesce(converted_requested_quantity, requested_quantity),
    converted_approved_quantity = coalesce(converted_approved_quantity, approved_quantity)
where requested_unit is null
   or conversion_factor is null
   or converted_requested_quantity is null;

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
    when unit_key in ('unidad', 'unidades', 'u') then 'unidad'
    when unit_key in ('libra', 'libras', 'lb', 'lbs') then 'libra'
    when unit_key in ('onza', 'onzas', 'oz') then 'onza'
    when unit_key in ('kilogramo', 'kilogramos', 'kg') then 'kilogramo'
    when unit_key in ('gramo', 'gramos', 'g') then 'gramo'
    else unit_key
  end
  from normalized;
$$;

create or replace function public.resolve_inventory_unit_factor(p_from_unit text, p_to_unit text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.normalize_inventory_unit(p_from_unit) = public.normalize_inventory_unit(p_to_unit) then 1
    else coalesce((
      select c.factor
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_from_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_to_unit)
      limit 1
    ), (
      select 1 / c.factor
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_to_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_from_unit)
        and c.factor > 0
      limit 1
    ), 1)
  end;
$$;

create or replace function public.has_inventory_unit_conversion(p_from_unit text, p_to_unit text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_inventory_unit(p_from_unit) = public.normalize_inventory_unit(p_to_unit)
    or exists (
      select 1
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_from_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_to_unit)
    )
    or exists (
      select 1
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_to_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_from_unit)
    );
$$;

revoke all on function
  public.normalize_inventory_unit(text),
  public.resolve_inventory_unit_factor(text, text),
  public.has_inventory_unit_conversion(text, text)
from public;

grant execute on function
  public.normalize_inventory_unit(text),
  public.resolve_inventory_unit_factor(text, text),
  public.has_inventory_unit_conversion(text, text)
to authenticated;

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
begin
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
    from_area_id, to_area_id, priority, notes, status, submitted_at
  )
  values (
    public.next_requisition_number(), auth.uid(), requester.id,
    coalesce(requester.full_name, requester.username), requester.role, from_id, to_id,
    coalesce(nullif(trim(p_data ->> 'priority'), ''), 'normal'),
    nullif(trim(p_data ->> 'notes'), ''),
    case when p_submit then 'pending' else 'draft' end,
    case when p_submit then now() else null end
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
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes
    ) values (
      created.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, conversion_missing, nullif(trim(row_data ->> 'notes'), '')
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
  conversion_missing boolean;
begin
  select * into current_row from public.requisitions where id = p_requisition_id;
  if current_row.id is null or current_row.status <> 'draft' then raise exception 'Solo se pueden editar requisiciones en borrador.'; end if;
  if current_row.requested_by <> auth.uid() and not public.is_profile_manager() then raise exception 'No tienes permiso para editar esta requisicion.'; end if;
  if requester_id is null then raise exception 'Selecciona quien esta haciendo la requisicion.'; end if;
  select * into requester from public.profiles where id = requester_id and status = 'active';
  if requester.id is null then raise exception 'Selecciona quien esta haciendo la requisicion.'; end if;
  if not public.can_request_requisition_to_area(to_id) or from_id = to_id then raise exception 'No tienes permiso para solicitar hacia esa area.'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un producto a la requisicion.'; end if;

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
      stock_available_at_request, stock_minimum_at_request, conversion_warning, notes
    ) values (
      updated.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, conversion_missing, nullif(trim(row_data ->> 'notes'), '')
    );
  end loop;
  return updated;
end;
$$;

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
begin
  if not public.is_profile_manager() then raise exception 'No tienes permiso para aprobar requisiciones.'; end if;
  if not exists (select 1 from public.requisitions where id = p_requisition_id and status = 'pending') then
    raise exception 'Solo se pueden aprobar requisiciones pendientes.';
  end if;

  for row_data in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    approved_qty := coalesce((row_data ->> 'approved_quantity')::numeric, 0);
    if approved_qty <= 0 then raise exception 'La cantidad aprobada debe ser mayor que cero.'; end if;
    select * into item_row from public.requisition_items
    where id = (row_data ->> 'id')::uuid and requisition_id = p_requisition_id;
    if item_row.id is not null then
      update public.requisition_items
        set approved_quantity = approved_qty,
            converted_approved_quantity = approved_qty * coalesce(item_row.conversion_factor, 1)
      where id = item_row.id;
    end if;
  end loop;

  update public.requisition_items
    set approved_quantity = requested_quantity,
        converted_approved_quantity = coalesce(converted_requested_quantity, requested_quantity)
    where requisition_id = p_requisition_id and approved_quantity is null;

  update public.requisitions
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_requisition_id
    returning * into approved;
  return approved;
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
    select quantity into source_before from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.from_area_id for update;
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
      values (detail.item_id, requisition.to_area_id, 0, 0)
      on conflict (item_id, area_id) do nothing;
    select quantity into destination_before from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.to_area_id for update;
    select base_unit into movement_unit from public.inventory_items where id = detail.item_id;

    source_before := coalesce(source_before, 0);
    destination_before := coalesce(destination_before, 0);
    movement_unit := coalesce(movement_unit, detail.unit);

    update public.area_inventory set quantity = source_before - moved_quantity
      where item_id = detail.item_id and area_id = requisition.from_area_id;
    update public.area_inventory set quantity = destination_before + moved_quantity
      where item_id = detail.item_id and area_id = requisition.to_area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, to_area_id, quantity, unit,
      previous_quantity, new_quantity, source_type, source_id, notes, performed_by
    ) values (
      detail.item_id, 'transfer', requisition.from_area_id, requisition.to_area_id,
      moved_quantity, movement_unit, source_before, source_before - moved_quantity,
      'requisition', requisition.id::text,
      'Traslado requisicion ' || requisition.requisition_number ||
        '. Solicitado: ' || detail.requested_quantity || ' ' || coalesce(detail.requested_unit, detail.unit) ||
        '. Destino antes: ' || destination_before || ', despues: ' || (destination_before + moved_quantity),
      auth.uid()
    );
  end loop;

  update public.requisitions
    set status = 'completed', completed_by = auth.uid(), completed_at = now()
    where id = p_requisition_id
    returning * into completed;
  return completed;
end;
$$;

revoke all on function
  public.create_requisition(jsonb, jsonb, boolean),
  public.update_draft_requisition(uuid, jsonb, jsonb),
  public.approve_requisition(uuid, jsonb),
  public.complete_requisition(uuid)
from public;

grant execute on function
  public.create_requisition(jsonb, jsonb, boolean),
  public.update_draft_requisition(uuid, jsonb, jsonb),
  public.approve_requisition(uuid, jsonb),
  public.complete_requisition(uuid)
to authenticated;
