-- Requisition area security v2: operational users may only request from warehouse to their assigned area(s).
-- Apply after 144_requisition_partial_fulfillment.sql.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.get_warehouse_area_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select a.id
      from public.areas a
      where a.active = true
        and (
          a.id = 'almacen'
          or lower(trim(a.name)) in ('almacen', 'almacén')
        )
      order by case when a.id = 'almacen' then 0 else 1 end
      limit 1
    ),
    (
      select a.id
      from public.areas a
      where a.active = true
        and a.type = 'principal'
        and coalesce(a.can_request_inventory, false) = false
      order by a.sort_order, a.name
      limit 1
    )
  );
$$;

revoke all on function public.get_warehouse_area_id() from public;
grant execute on function public.get_warehouse_area_id() to authenticated;

create or replace function public.get_current_user_requisition_area_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct area_id), array[]::text[])
  from (
    select p.area_id as area_id
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.area_id is not null
    union
    select a.id
    from public.areas a
    where a.active = true
      and a.responsible_user_id = auth.uid()
    union
    select upa.production_area_id
    from public.user_production_areas upa
    inner join public.areas pa on pa.id = upa.production_area_id and pa.active = true
    where upa.profile_id = auth.uid()
      and coalesce(upa.is_active, true) = true
  ) sources
  where area_id is not null;
$$;

revoke all on function public.get_current_user_requisition_area_ids() from public;
grant execute on function public.get_current_user_requisition_area_ids() to authenticated;

create or replace function public.can_request_requisition_from_area(p_from_area_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_from_area_id is not null
    and exists (
      select 1
      from public.areas a
      where a.id = p_from_area_id
        and a.active = true
    )
    and (
      public.is_inventory_manager()
      or p_from_area_id = public.get_warehouse_area_id()
    );
$$;

revoke all on function public.can_request_requisition_from_area(text) from public;
grant execute on function public.can_request_requisition_from_area(text) to authenticated;

create or replace function public.can_request_requisition_to_area(p_area_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_area_id is not null
    and exists (
      select 1
      from public.areas a
      where a.id = p_area_id
        and a.active = true
        and (
          public.is_inventory_manager()
          or (
            coalesce(a.can_request_inventory, true) = true
            and p_area_id = any(public.get_current_user_requisition_area_ids())
          )
        )
    );
$$;

revoke all on function public.can_request_requisition_to_area(text) from public;
grant execute on function public.can_request_requisition_to_area(text) to authenticated;

create or replace function public.assert_requisition_request_permissions(
  p_from_area_id text,
  p_to_area_id text,
  p_requester_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  warehouse_id text := public.get_warehouse_area_id();
begin
  if p_from_area_id is null or p_to_area_id is null or p_from_area_id = p_to_area_id then
    raise exception 'Selecciona areas de origen y destino diferentes.';
  end if;

  if not exists (select 1 from public.areas where id = p_from_area_id and active = true)
    or not exists (select 1 from public.areas where id = p_to_area_id and active = true) then
    raise exception 'El area de origen o destino no esta activa.';
  end if;

  if p_requester_profile_id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_requester_profile_id
      and status = 'active'
  ) then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;

  if not public.can_request_requisition_from_area(p_from_area_id) then
    raise exception 'No tienes permiso para solicitar desde esta area.';
  end if;

  if not public.can_request_requisition_to_area(p_to_area_id) then
    raise exception 'No tienes permiso para solicitar inventario hacia esta area.';
  end if;

  if not public.is_inventory_manager() then
    if warehouse_id is null then
      raise exception 'No existe un area de Almacen activa. Contacta a administracion.';
    end if;

    if coalesce(array_length(public.get_current_user_requisition_area_ids(), 1), 0) = 0 then
      raise exception 'Tu usuario no tiene area de requisicion asignada.';
    end if;

    if p_from_area_id <> warehouse_id then
      raise exception 'No tienes permiso para solicitar desde esta area.';
    end if;

    if not (p_to_area_id = any(public.get_current_user_requisition_area_ids())) then
      raise exception 'No tienes permiso para solicitar inventario hacia esta area.';
    end if;

    if p_requester_profile_id <> auth.uid() then
      raise exception 'No puedes crear requisiciones a nombre de otro usuario.';
    end if;
  end if;
end;
$$;

revoke all on function public.assert_requisition_request_permissions(text, text, uuid) from public;
grant execute on function public.assert_requisition_request_permissions(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: create / update / submit
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
  conversion_missing boolean;
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

revoke all on function public.create_requisition(jsonb, jsonb, boolean) from public;
grant execute on function public.create_requisition(jsonb, jsonb, boolean) to authenticated;

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
      updated.id, catalog_item.id, catalog_item.name, requested_unit, requested_qty, null,
      requested_unit, conversion_factor, converted_qty, availability,
      source_stock, source_minimum, conversion_missing, nullif(trim(row_data ->> 'notes'), ''),
      coalesce(current_row.is_test, false)
    );
  end loop;
  return updated;
end;
$$;

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
begin
  select * into current_row from public.requisitions where id = p_requisition_id;
  if current_row.id is null then
    raise exception 'No se pudo enviar la requisición.';
  end if;
  if current_row.status <> 'draft' then
    raise exception 'Solo se pueden enviar requisiciones en borrador.';
  end if;
  if current_row.requested_by <> auth.uid() and not public.is_profile_manager() then
    raise exception 'No tienes permiso para enviar esta requisición.';
  end if;

  perform public.assert_requisition_request_permissions(
    current_row.from_area_id,
    current_row.to_area_id,
    current_row.requested_by_profile_id
  );

  update public.requisitions
  set status = 'pending', submitted_at = now()
  where id = p_requisition_id
    and status = 'draft'
    and (requested_by = auth.uid() or public.is_profile_manager())
  returning * into submitted;

  if submitted.id is null then
    raise exception 'No se pudo enviar la requisición.';
  end if;
  return submitted;
end;
$$;

revoke all on function public.submit_requisition(uuid) from public;
grant execute on function public.submit_requisition(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS visibility
-- ---------------------------------------------------------------------------

drop policy if exists "requisitions_authenticated_read" on public.requisitions;
create policy "requisitions_authenticated_read"
  on public.requisitions for select to authenticated
  using (
    public.is_inventory_manager()
    or to_area_id = any(public.get_current_user_requisition_area_ids())
    or from_area_id = any(public.get_current_user_requisition_area_ids())
  );

drop policy if exists "requisition_items_authenticated_read" on public.requisition_items;
create policy "requisition_items_authenticated_read"
  on public.requisition_items for select to authenticated
  using (
    public.is_inventory_manager()
    or exists (
      select 1
      from public.requisitions r
      where r.id = requisition_id
        and (
          r.to_area_id = any(public.get_current_user_requisition_area_ids())
          or r.from_area_id = any(public.get_current_user_requisition_area_ids())
        )
    )
  );
