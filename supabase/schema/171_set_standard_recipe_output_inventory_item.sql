-- Ensure recipe output inventory item RPC exists (from 038_internal_production.sql).
-- Apply after 170_duplicate_schedule_week.sql.

alter table public.standard_recipes
  add column if not exists output_inventory_item_id uuid references public.inventory_items(id);

create or replace function public.set_standard_recipe_output_inventory_item(
  p_recipe_id uuid,
  p_output_inventory_item_id uuid
)
returns public.standard_recipes
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  output_item public.inventory_items;
begin
  select * into recipe
  from public.standard_recipes
  where id = p_recipe_id;

  if recipe.id is null then
    raise exception 'La receta no existe.';
  end if;
  if not public.can_manage_recipe_area(recipe.production_area_id) then
    raise exception 'No tienes permiso para configurar esta receta.';
  end if;

  if p_output_inventory_item_id is not null then
    select * into output_item
    from public.inventory_items
    where id = p_output_inventory_item_id and active = true;
    if output_item.id is null then
      raise exception 'El producto terminado no existe o esta inactivo.';
    end if;
  end if;

  update public.standard_recipes
  set output_inventory_item_id = p_output_inventory_item_id
  where id = recipe.id
  returning * into recipe;

  return recipe;
end;
$$;

revoke all on function public.set_standard_recipe_output_inventory_item(uuid, uuid) from public;
grant execute on function public.set_standard_recipe_output_inventory_item(uuid, uuid) to authenticated;
