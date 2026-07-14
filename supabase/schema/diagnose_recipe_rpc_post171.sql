select exists (
  select 1 from information_schema.routines
  where routine_schema = 'public'
    and routine_name = 'create_internal_production_output_item'
) as has_create_internal_production_output_item;

select id, name, output_inventory_item_id, production_area_id
from public.standard_recipes
where id = '31c485f6-7102-45e3-9638-ad0f880b135e';

select id, name, active
from public.inventory_items
where active = true
order by name
limit 5;
