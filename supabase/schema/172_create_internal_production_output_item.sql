-- Restore missing create_internal_production_output_item from 038_internal_production.sql.
-- Apply after 171_set_standard_recipe_output_inventory_item.sql.

create or replace function public.create_internal_production_output_item(p_recipe_id uuid)
returns public.inventory_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  output_item public.inventory_items;
  base_unit_value text;
begin
  select * into recipe
  from public.standard_recipes
  where id = p_recipe_id and active = true;

  if recipe.id is null then
    raise exception 'La receta no existe o esta inactiva.';
  end if;
  if not public.can_create_internal_production(recipe.production_area_id) then
    raise exception 'No tienes permiso para crear producto terminado en esta area.';
  end if;
  if recipe.output_inventory_item_id is not null then
    select * into output_item from public.inventory_items where id = recipe.output_inventory_item_id;
    return output_item;
  end if;

  base_unit_value := coalesce(nullif(trim(recipe.yield_unit), ''), 'Unidad');

  select * into output_item
  from public.inventory_items
  where lower(trim(name)) = lower(trim(recipe.name))
    and active = true
  limit 1;

  if output_item.id is null then
    insert into public.inventory_items (
      name, sku, category, purchase_unit, base_unit, conversion_factor,
      purchase_price, cost_per_base_unit, supplier, active, notes
    )
    values (
      trim(recipe.name), null, 'Preparaciones', base_unit_value, base_unit_value, 1,
      null, coalesce(recipe.estimated_cost / nullif(recipe.yield_quantity, 0), 0),
      null, true, 'Creado desde produccion interna'
    )
    returning * into output_item;
  end if;

  insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
  values (output_item.id, recipe.production_area_id, 0, 0)
  on conflict (item_id, area_id) do nothing;

  update public.standard_recipes
  set output_inventory_item_id = output_item.id
  where id = recipe.id;

  return output_item;
end;
$$;

revoke all on function public.create_internal_production_output_item(uuid) from public;
grant execute on function public.create_internal_production_output_item(uuid) to authenticated;
