-- Submit requisition: trust persisted conversion snapshots from draft engine (149/148)
-- and emit explicit per-line validation errors.
-- Apply after 149_requisition_duplicate_template.sql.

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
  requested_unit text;
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

  if not exists (
    select 1 from public.requisition_items where requisition_id = p_requisition_id
  ) then
    raise exception 'Agrega al menos un producto a la requisicion.';
  end if;

  for detail in
    select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    requested_unit := coalesce(nullif(trim(detail.requested_unit), ''), detail.unit);

    if coalesce(detail.requested_quantity, 0) <= 0 then
      raise exception
        'La linea % tiene cantidad solicitada invalida. Corrige el borrador antes de enviar.',
        detail.item_name;
    end if;

    if requested_unit is null then
      raise exception
        'La linea % no tiene unidad solicitada. Corrige el borrador antes de enviar.',
        detail.item_name;
    end if;

    if coalesce(detail.conversion_warning, false) then
      continue;
    end if;

    if detail.conversion_factor is not null
       and detail.conversion_factor > 0
       and detail.converted_requested_quantity is not null
       and detail.converted_requested_quantity > 0 then
      continue;
    end if;

    select * into catalog_item from public.inventory_items where id = detail.item_id;
    if catalog_item.id is null then
      raise exception 'La requisicion contiene un producto inexistente: %.', detail.item_name;
    end if;
    if coalesce(catalog_item.active, false) = false then
      raise exception 'La requisicion contiene un producto inactivo: %.', detail.item_name;
    end if;

    resolved_factor := public.resolve_item_requisition_unit_factor(
      catalog_item.id,
      coalesce(requested_unit, catalog_item.default_requisition_unit, catalog_item.base_unit)
    );
    if resolved_factor is null or resolved_factor <= 0 then
      raise exception
        'La unidad % no esta configurada para el producto %. Corrige la unidad o configura la conversion antes de enviar.',
        requested_unit,
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
