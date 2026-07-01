-- Permanently delete rejected or cancelled requisitions only.
-- Apply after 150_requisition_submit_trust_snapshot.sql.

create or replace function public.delete_closed_requisition(p_requisition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.requisitions;
begin
  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  select * into current_row
  from public.requisitions
  where id = p_requisition_id;

  if current_row.id is null then
    raise exception 'Requisicion no encontrada.';
  end if;

  if current_row.status not in ('rejected', 'cancelled') then
    raise exception 'Solo se pueden eliminar requisiciones rechazadas o canceladas.';
  end if;

  if not (
    public.is_inventory_manager()
    or current_row.to_area_id = any(public.get_current_user_requisition_area_ids())
    or current_row.from_area_id = any(public.get_current_user_requisition_area_ids())
  ) then
    raise exception 'No tienes permiso para eliminar esta requisicion.';
  end if;

  if current_row.requested_by <> auth.uid()
     and not public.is_profile_manager()
     and not public.is_inventory_manager() then
    raise exception 'No tienes permiso para eliminar esta requisicion.';
  end if;

  delete from public.requisitions
  where id = p_requisition_id
    and status in ('rejected', 'cancelled');
end;
$$;

revoke all on function public.delete_closed_requisition(uuid) from public;
grant execute on function public.delete_closed_requisition(uuid) to authenticated;
