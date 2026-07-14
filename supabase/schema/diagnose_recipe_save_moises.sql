-- Post-171 validation for recipes + 038 gap audit.

select id, email, full_name, username, role, status, area_id, area_name
from public.profiles
where lower(coalesce(full_name, username, email, '')) like '%mois%'
order by full_name;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'set_standard_recipe_output_inventory_item',
    'create_internal_production_output_item',
    'create_internal_production_batch',
    'complete_internal_production_batch',
    'cancel_internal_production_batch'
  )
order by routine_name;

select
  to_regclass('public.production_batches') is not null as has_production_batches,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'standard_recipes'
      and column_name = 'output_inventory_item_id'
  ) as has_output_inventory_item_id;

select id, name, production_area_id, output_inventory_item_id, active, updated_at
from public.standard_recipes
where active = true
order by updated_at desc
limit 5;
