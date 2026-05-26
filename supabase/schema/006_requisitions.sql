-- Internal requisitions connected to live area inventory.
-- Apply after 005_inventory_images.sql.

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_number text not null unique,
  requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  completed_by uuid references public.profiles(id),
  from_area_id text not null references public.areas(id),
  to_area_id text not null references public.areas(id),
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected', 'completed', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  notes text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint requisitions_distinct_areas check (from_area_id <> to_area_id)
);

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  item_name text not null,
  unit text not null,
  requested_quantity numeric not null check (requested_quantity > 0),
  approved_quantity numeric check (approved_quantity is null or approved_quantity > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists requisitions_status_created_idx
  on public.requisitions (status, created_at desc);
create index if not exists requisitions_areas_idx
  on public.requisitions (from_area_id, to_area_id);
create index if not exists requisition_items_requisition_idx
  on public.requisition_items (requisition_id);

alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;

grant select, insert, update on public.requisitions to authenticated;
grant select, insert, update, delete on public.requisition_items to authenticated;
grant all on public.requisitions, public.requisition_items to service_role;

create or replace function public.set_requisition_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_requisition_updated_at on public.requisitions;
create trigger set_requisition_updated_at
  before update on public.requisitions
  for each row execute procedure public.set_requisition_updated_at();

create or replace function public.can_request_requisition_to_area(p_area_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_profile_manager()
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and status = 'active'
        and role = 'supervisor'
        and area_id = p_area_id
    )
    or exists (
      select 1
      from public.areas
      where id = p_area_id
        and active = true
        and responsible_user_id = auth.uid()
    );
$$;

revoke all on function public.can_request_requisition_to_area(text) from public;
grant execute on function public.can_request_requisition_to_area(text) to authenticated;

-- Internal testing phase: authenticated staff may inspect the requisition queue.
-- TODO: narrow read access per area when operational permissions are finalized.
drop policy if exists "requisitions_authenticated_read" on public.requisitions;
create policy "requisitions_authenticated_read"
  on public.requisitions for select to authenticated
  using (true);

drop policy if exists "requisition_items_authenticated_read" on public.requisition_items;
create policy "requisition_items_authenticated_read"
  on public.requisition_items for select to authenticated
  using (true);

drop policy if exists "requisitions_managers_insert" on public.requisitions;
create policy "requisitions_managers_insert"
  on public.requisitions for insert to authenticated
  with check (
    requested_by = auth.uid()
    and public.is_profile_manager()
  );

drop policy if exists "requisitions_requester_update_open" on public.requisitions;
drop policy if exists "requisitions_managers_update_all" on public.requisitions;
create policy "requisitions_managers_update_all"
  on public.requisitions for update to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "requisition_items_requester_insert" on public.requisition_items;
drop policy if exists "requisition_items_requester_edit_draft" on public.requisition_items;
drop policy if exists "requisition_items_managers_all" on public.requisition_items;
create policy "requisition_items_managers_all"
  on public.requisition_items for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

-- Non-manager creation and workflow transitions go only through the
-- validated SECURITY DEFINER functions below; no open direct-write policy is granted.
create or replace function public.next_requisition_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_prefix text := 'REQ-' || to_char(current_date, 'YYYYMMDD') || '-';
  next_value integer;
begin
  perform pg_advisory_xact_lock(hashtext(day_prefix));
  select coalesce(max((right(requisition_number, 4))::integer), 0) + 1
    into next_value
  from public.requisitions
  where requisition_number like day_prefix || '%';
  return day_prefix || lpad(next_value::text, 4, '0');
end;
$$;

revoke all on function public.next_requisition_number() from public;
grant execute on function public.next_requisition_number() to authenticated;

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
  from_id text := nullif(trim(p_data ->> 'from_area_id'), '');
  to_id text := nullif(trim(p_data ->> 'to_area_id'), '');
begin
  if not public.can_request_requisition_to_area(to_id) then
    raise exception 'No tienes permiso para solicitar inventario hacia esta área.';
  end if;
  if from_id is null or to_id is null or from_id = to_id then
    raise exception 'Selecciona áreas de origen y destino diferentes.';
  end if;
  if not exists (select 1 from public.areas where id = from_id and active = true)
    or not exists (select 1 from public.areas where id = to_id and active = true) then
    raise exception 'El área de origen o destino no está activa.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos un producto a la requisición.';
  end if;

  insert into public.requisitions (
    requisition_number, requested_by, from_area_id, to_area_id, priority,
    notes, status, submitted_at
  )
  values (
    public.next_requisition_number(), auth.uid(), from_id, to_id,
    coalesce(nullif(trim(p_data ->> 'priority'), ''), 'normal'),
    nullif(trim(p_data ->> 'notes'), ''),
    case when p_submit then 'pending' else 'draft' end,
    case when p_submit then now() else null end
  )
  returning * into created;

  for row_data in select value from jsonb_array_elements(p_items)
  loop
    select * into catalog_item
    from public.inventory_items
    where id = (row_data ->> 'item_id')::uuid and active = true;

    if catalog_item.id is null then
      raise exception 'La requisición contiene un producto inactivo o inexistente.';
    end if;
    if coalesce((row_data ->> 'requested_quantity')::numeric, 0) <= 0 then
      raise exception 'Las cantidades solicitadas deben ser mayores que cero.';
    end if;

    insert into public.requisition_items (
      requisition_id, item_id, item_name, unit, requested_quantity, notes
    ) values (
      created.id, catalog_item.id, catalog_item.name, catalog_item.base_unit,
      (row_data ->> 'requested_quantity')::numeric,
      nullif(trim(row_data ->> 'notes'), '')
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
  from_id text := nullif(trim(p_data ->> 'from_area_id'), '');
  to_id text := nullif(trim(p_data ->> 'to_area_id'), '');
begin
  select * into current_row from public.requisitions where id = p_requisition_id;
  if current_row.id is null or current_row.status <> 'draft' then
    raise exception 'Solo se pueden editar requisiciones en borrador.';
  end if;
  if current_row.requested_by <> auth.uid() and not public.is_profile_manager() then
    raise exception 'No tienes permiso para editar esta requisición.';
  end if;
  if not public.can_request_requisition_to_area(to_id) or from_id = to_id then
    raise exception 'No tienes permiso para solicitar hacia esa área.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos un producto a la requisición.';
  end if;

  update public.requisitions
    set from_area_id = from_id,
        to_area_id = to_id,
        priority = coalesce(nullif(trim(p_data ->> 'priority'), ''), 'normal'),
        notes = nullif(trim(p_data ->> 'notes'), '')
  where id = p_requisition_id
  returning * into updated;

  delete from public.requisition_items where requisition_id = p_requisition_id;
  for row_data in select value from jsonb_array_elements(p_items)
  loop
    select * into catalog_item from public.inventory_items
      where id = (row_data ->> 'item_id')::uuid and active = true;
    if catalog_item.id is null or coalesce((row_data ->> 'requested_quantity')::numeric, 0) <= 0 then
      raise exception 'Producto o cantidad inválida en la requisición.';
    end if;
    insert into public.requisition_items (
      requisition_id, item_id, item_name, unit, requested_quantity, notes
    ) values (
      updated.id, catalog_item.id, catalog_item.name, catalog_item.base_unit,
      (row_data ->> 'requested_quantity')::numeric,
      nullif(trim(row_data ->> 'notes'), '')
    );
  end loop;
  return updated;
end;
$$;

create or replace function public.submit_requisition(p_requisition_id uuid)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted public.requisitions;
begin
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

create or replace function public.approve_requisition(p_requisition_id uuid, p_items jsonb)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved public.requisitions;
  row_data jsonb;
begin
  -- TODO: include encargado_almacen and authorized supervisors once roles are defined.
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para aprobar requisiciones.';
  end if;
  if not exists (select 1 from public.requisitions where id = p_requisition_id and status = 'pending') then
    raise exception 'Solo se pueden aprobar requisiciones pendientes.';
  end if;
  for row_data in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if coalesce((row_data ->> 'approved_quantity')::numeric, 0) <= 0 then
      raise exception 'La cantidad aprobada debe ser mayor que cero.';
    end if;
    update public.requisition_items
      set approved_quantity = (row_data ->> 'approved_quantity')::numeric
      where id = (row_data ->> 'id')::uuid and requisition_id = p_requisition_id;
  end loop;
  update public.requisition_items
    set approved_quantity = requested_quantity
    where requisition_id = p_requisition_id and approved_quantity is null;
  update public.requisitions
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_requisition_id
    returning * into approved;
  return approved;
end;
$$;

create or replace function public.reject_requisition(p_requisition_id uuid, p_reason text)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  rejected public.requisitions;
begin
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para rechazar requisiciones.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;
  update public.requisitions
    set status = 'rejected', rejection_reason = trim(p_reason)
    where id = p_requisition_id and status in ('pending', 'approved')
    returning * into rejected;
  if rejected.id is null then raise exception 'No se puede rechazar esta requisición.'; end if;
  return rejected;
end;
$$;

create or replace function public.cancel_requisition(p_requisition_id uuid, p_reason text)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled public.requisitions;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;
  update public.requisitions
    set status = 'cancelled', rejection_reason = trim(p_reason), cancelled_at = now()
    where id = p_requisition_id
      and status in ('draft', 'pending', 'approved')
      and (requested_by = auth.uid() or public.is_profile_manager())
    returning * into cancelled;
  if cancelled.id is null then raise exception 'No se puede cancelar esta requisición.'; end if;
  return cancelled;
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
  completed public.requisitions;
begin
  -- TODO: include encargado_almacen after adding it to the profile role catalog.
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para completar traslados.';
  end if;
  select * into requisition
  from public.requisitions
  where id = p_requisition_id
  for update;
  if requisition.id is null then raise exception 'La requisición no existe.'; end if;
  if requisition.status = 'completed' then raise exception 'Esta requisición ya fue completada.'; end if;
  if requisition.status <> 'approved' then
    raise exception 'La requisición debe estar aprobada antes del traslado.';
  end if;
  if not exists (select 1 from public.requisition_items where requisition_id = p_requisition_id) then
    raise exception 'La requisición no tiene productos.';
  end if;

  for detail in select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    moved_quantity := coalesce(detail.approved_quantity, detail.requested_quantity);
    if moved_quantity <= 0 then raise exception 'La cantidad para % no es válida.', detail.item_name; end if;
    select quantity into source_before
    from public.area_inventory
    where item_id = detail.item_id and area_id = requisition.from_area_id
    for update;
    source_before := coalesce(source_before, 0);
    if source_before < moved_quantity then
      raise exception 'Stock insuficiente para %. Disponible: % %, requerido: % %.',
        detail.item_name, source_before, detail.unit, moved_quantity, detail.unit;
    end if;
  end loop;

  for detail in select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    moved_quantity := coalesce(detail.approved_quantity, detail.requested_quantity);
    select quantity into source_before from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.from_area_id for update;
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
      values (detail.item_id, requisition.to_area_id, 0, 0)
      on conflict (item_id, area_id) do nothing;
    select quantity into destination_before from public.area_inventory
      where item_id = detail.item_id and area_id = requisition.to_area_id for update;

    update public.area_inventory set quantity = source_before - moved_quantity
      where item_id = detail.item_id and area_id = requisition.from_area_id;
    update public.area_inventory set quantity = destination_before + moved_quantity
      where item_id = detail.item_id and area_id = requisition.to_area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, to_area_id, quantity, unit,
      previous_quantity, new_quantity, source_type, source_id, notes, performed_by
    ) values (
      detail.item_id, 'transfer', requisition.from_area_id, requisition.to_area_id,
      moved_quantity, detail.unit, source_before, source_before - moved_quantity,
      'requisition', requisition.id::text,
      'Traslado requisición ' || requisition.requisition_number ||
        '. Destino antes: ' || destination_before || ', después: ' || (destination_before + moved_quantity),
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

revoke all on function public.create_requisition(jsonb, jsonb, boolean) from public;
revoke all on function public.update_draft_requisition(uuid, jsonb, jsonb) from public;
revoke all on function public.submit_requisition(uuid) from public;
revoke all on function public.approve_requisition(uuid, jsonb) from public;
revoke all on function public.reject_requisition(uuid, text) from public;
revoke all on function public.cancel_requisition(uuid, text) from public;
revoke all on function public.complete_requisition(uuid) from public;
grant execute on function public.create_requisition(jsonb, jsonb, boolean) to authenticated;
grant execute on function public.update_draft_requisition(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.submit_requisition(uuid) to authenticated;
grant execute on function public.approve_requisition(uuid, jsonb) to authenticated;
grant execute on function public.reject_requisition(uuid, text) to authenticated;
grant execute on function public.cancel_requisition(uuid, text) to authenticated;
grant execute on function public.complete_requisition(uuid) to authenticated;
