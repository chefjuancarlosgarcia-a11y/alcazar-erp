-- Realtime feeds for POS, KDS and inventory operational screens.
-- Apply after 012_fix_send_pos_order_recipe_alias.sql.

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'production_tickets',
    'production_ticket_items',
    'pos_orders',
    'pos_order_items',
    'area_inventory',
    'inventory_movements'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;
