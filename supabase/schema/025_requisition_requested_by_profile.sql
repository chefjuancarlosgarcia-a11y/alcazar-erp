-- Requisition requester profile metadata and friendlier creation payloads.
-- Apply after 006_requisitions.sql.

alter table public.requisitions
  add column if not exists requested_by_profile_id uuid references public.profiles(id),
  add column if not exists requested_by_name text,
  add column if not exists requested_by_role text;

update public.requisitions r
set requested_by_profile_id = coalesce(r.requested_by_profile_id, r.requested_by),
    requested_by_name = coalesce(r.requested_by_name, p.full_name, p.username),
    requested_by_role = coalesce(r.requested_by_role, p.role)
from public.profiles p
where p.id = r.requested_by
  and (r.requested_by_profile_id is null or r.requested_by_name is null or r.requested_by_role is null);

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
begin
  if requester_id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;
  select * into requester from public.profiles where id = requester_id and status = 'active';
  if requester.id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;
  if not public.can_request_requisition_to_area(to_id) then
    raise exception 'No tienes permiso para solicitar inventario hacia esta area.';
  end if;
  if from_id is null or to_id is null or from_id = to_id then
    raise exception 'Selecciona areas de origen y destino diferentes.';
  end if;
  if not exists (select 1 from public.areas where id = from_id and active = true)
    or not exists (select 1 from public.areas where id = to_id and active = true) then
    raise exception 'El area de origen o destino no esta activa.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos un producto a la requisicion.';
  end if;

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
    select * into catalog_item
    from public.inventory_items
    where id = (row_data ->> 'item_id')::uuid and active = true;

    if catalog_item.id is null then
      raise exception 'La requisicion contiene un producto inactivo o inexistente.';
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
  requester public.profiles;
  from_id text := nullif(trim(p_data ->> 'from_area_id'), '');
  to_id text := nullif(trim(p_data ->> 'to_area_id'), '');
  requester_id uuid := nullif(p_data ->> 'requested_by_profile_id', '')::uuid;
begin
  select * into current_row from public.requisitions where id = p_requisition_id;
  if current_row.id is null or current_row.status <> 'draft' then
    raise exception 'Solo se pueden editar requisiciones en borrador.';
  end if;
  if current_row.requested_by <> auth.uid() and not public.is_profile_manager() then
    raise exception 'No tienes permiso para editar esta requisicion.';
  end if;
  if requester_id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;
  select * into requester from public.profiles where id = requester_id and status = 'active';
  if requester.id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;
  if not public.can_request_requisition_to_area(to_id) or from_id = to_id then
    raise exception 'No tienes permiso para solicitar hacia esa area.';
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
    select * into catalog_item from public.inventory_items
      where id = (row_data ->> 'item_id')::uuid and active = true;
    if catalog_item.id is null or coalesce((row_data ->> 'requested_quantity')::numeric, 0) <= 0 then
      raise exception 'Producto o cantidad invalida en la requisicion.';
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
