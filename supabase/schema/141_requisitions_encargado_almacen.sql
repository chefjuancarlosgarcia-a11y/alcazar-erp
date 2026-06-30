-- Allow encargado_almacen to create and complete requisitions without gerencial approval rights.
-- Apply after 140_attendance_register_always_classify.sql.

create or replace function public.can_request_requisition_to_area(p_area_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_profile_manager()
    or public.is_inventory_manager()
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and status = 'active'
        and public.normalize_profile_role(role) = 'supervisor'
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
  if not public.is_inventory_manager() then
    raise exception 'No tienes permiso para completar traslados.';
  end if;

  select * into requisition from public.requisitions where id = p_requisition_id for update;
  if requisition.id is null or requisition.status <> 'approved' then
    raise exception 'La requisición debe estar aprobada antes del traslado.';
  end if;
  if not exists (select 1 from public.requisition_items where requisition_id = p_requisition_id) then
    raise exception 'La requisición no tiene productos.';
  end if;

  for detail in select * from public.requisition_items where requisition_id = p_requisition_id
  loop
    moved_quantity := coalesce(
      detail.converted_approved_quantity,
      detail.converted_requested_quantity,
      detail.approved_quantity,
      detail.requested_quantity
    );
    if moved_quantity <= 0 then
      raise exception 'La cantidad para % no es valida.', detail.item_name;
    end if;
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

revoke all on function public.complete_requisition(uuid) from public;
grant execute on function public.complete_requisition(uuid) to authenticated;
