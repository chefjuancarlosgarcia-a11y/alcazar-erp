-- Audit presence of 038_internal_production.sql objects in production.
-- Read-only diagnostic.

select 'column_output_inventory_item_id' as check_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'standard_recipes'
      and column_name = 'output_inventory_item_id'
  ) as present;

select 'table_production_batches' as check_name,
  to_regclass('public.production_batches') is not null as present;

select 'table_production_batch_inputs' as check_name,
  to_regclass('public.production_batch_inputs') is not null as present;

select 'table_production_batch_outputs' as check_name,
  to_regclass('public.production_batch_outputs') is not null as present;

select 'movement_type_production_input' as check_name,
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'inventory_movements'
      and c.conname = 'inventory_movements_movement_type_check'
      and pg_get_constraintdef(c.oid) like '%production_input%'
  ) as present;

select routine_name, routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'set_standard_recipe_output_inventory_item',
    'create_internal_production_output_item',
    'can_create_internal_production',
    'can_manage_internal_production',
    'next_production_batch_number',
    'create_internal_production_batch',
    'complete_internal_production_batch',
    'cancel_internal_production_batch'
  )
order by routine_name;
