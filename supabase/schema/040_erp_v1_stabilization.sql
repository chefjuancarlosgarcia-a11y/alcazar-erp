-- ERP V1 stabilization: reduce checklist round trips and support common list queries.
-- Apply after 039_internal_production_batches_yield.sql.

create or replace function public.evaluate_checklist_run_item_incident_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalculate_checklist_run_points(new.run_id);
  perform public.evaluate_checklist_run_item_incident(new.id);
  return new;
end;
$$;

create index if not exists inventory_movements_created_idx
  on public.inventory_movements (created_at desc);

create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists pos_orders_created_idx
  on public.pos_orders (created_at desc);

create index if not exists production_tickets_created_idx
  on public.production_tickets (created_at desc);

create index if not exists purchase_orders_created_idx
  on public.purchase_orders (created_at desc);

create index if not exists production_batches_created_idx
  on public.production_batches (created_at desc);

create index if not exists requisitions_requested_by_created_idx
  on public.requisitions (requested_by, created_at desc);

create index if not exists requisitions_priority_created_idx
  on public.requisitions (priority, created_at desc);
