-- Fix ambiguous shortage_reason reference in approve_requisition.
-- Apply after 144_requisition_partial_fulfillment.sql (or latest requisition migrations).
--
-- Root cause: PL/pgSQL variable "shortage_reason" collided with
-- requisition_items.shortage_reason inside UPDATE ... SET.

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
  pending_qty numeric;
  v_shortage_reason text;
begin
  if not (public.is_profile_manager() or public.is_inventory_manager()) then
    raise exception 'No tienes permiso para aprobar requisiciones.';
  end if;

  if not exists (
    select 1 from public.requisitions
    where id = p_requisition_id and status = 'pending'
  ) then
    raise exception 'Solo se pueden aprobar requisiciones pendientes.';
  end if;

  for row_data in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    approved_qty := coalesce((row_data ->> 'approved_quantity')::numeric, 0);
    if approved_qty < 0 then
      raise exception 'La cantidad aprobada no puede ser negativa.';
    end if;

    select * into item_row
    from public.requisition_items
    where id = (row_data ->> 'id')::uuid
      and requisition_id = p_requisition_id;

    if item_row.id is null then
      continue;
    end if;

    if approved_qty > item_row.requested_quantity then
      raise exception
        'La cantidad aprobada para % no puede superar lo solicitado (%).',
        item_row.item_name,
        item_row.requested_quantity;
    end if;

    v_shortage_reason := nullif(trim(row_data ->> 'shortage_reason'), '');
    if public.requisition_shortage_reason_required(item_row.requested_quantity, approved_qty)
       and v_shortage_reason is null then
      raise exception
        'Debes indicar el motivo del faltante para %.',
        item_row.item_name;
    end if;

    pending_qty := greatest(item_row.requested_quantity - approved_qty, 0);

    update public.requisition_items ri
    set
      approved_quantity = approved_qty,
      converted_approved_quantity = approved_qty * coalesce(ri.conversion_factor, 1),
      pending_quantity = pending_qty,
      shortage_reason = case
        when public.requisition_shortage_reason_required(ri.requested_quantity, approved_qty)
          then v_shortage_reason
        else null
      end,
      shortage_notes = nullif(trim(row_data ->> 'shortage_notes'), '')
    where ri.id = item_row.id;
  end loop;

  update public.requisition_items
  set
    approved_quantity = requested_quantity,
    converted_approved_quantity = coalesce(converted_requested_quantity, requested_quantity),
    pending_quantity = 0
  where requisition_id = p_requisition_id
    and approved_quantity is null;

  update public.requisitions
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_requisition_id
  returning * into approved;

  return approved;
end;
$$;

revoke all on function public.approve_requisition(uuid, jsonb) from public;
grant execute on function public.approve_requisition(uuid, jsonb) to authenticated;
