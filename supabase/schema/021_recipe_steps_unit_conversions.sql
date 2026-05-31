-- Recipe UX and costing improvements.
-- Apply after 007_recipes.sql.

alter table public.standard_recipes
  add column if not exists preparation_steps jsonb not null default '[]'::jsonb;

alter table public.recipe_ingredients
  add column if not exists recipe_quantity numeric,
  add column if not exists recipe_unit text,
  add column if not exists inventory_quantity numeric,
  add column if not exists inventory_unit text,
  add column if not exists conversion_factor numeric not null default 1 check (conversion_factor > 0);

update public.recipe_ingredients
set
  recipe_quantity = coalesce(recipe_quantity, quantity),
  recipe_unit = coalesce(recipe_unit, unit),
  inventory_quantity = coalesce(inventory_quantity, quantity),
  inventory_unit = coalesce(inventory_unit, unit),
  conversion_factor = coalesce(conversion_factor, 1)
where recipe_quantity is null
   or recipe_unit is null
   or inventory_quantity is null
   or inventory_unit is null;

create or replace function public.save_standard_recipe(
  p_recipe_id uuid,
  p_recipe jsonb,
  p_ingredients jsonb
)
returns public.standard_recipes
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.standard_recipes;
  existing public.standard_recipes;
  ingredient jsonb;
  inventory_item public.inventory_items;
  total_cost numeric := 0;
  area_id text := nullif(trim(p_recipe ->> 'production_area_id'), '');
  recipe_kind text := coalesce(nullif(trim(p_recipe ->> 'recipe_type'), ''), 'subrecipe');
  recipe_qty numeric;
  inventory_qty numeric;
  conversion numeric;
  recipe_unit_value text;
begin
  if not public.can_manage_recipe_area(area_id) then
    raise exception 'No tienes permiso para administrar recetas de esta area.';
  end if;
  if nullif(trim(p_recipe ->> 'name'), '') is null then
    raise exception 'El nombre de la receta es obligatorio.';
  end if;
  if recipe_kind not in ('subrecipe', 'final_product') then
    raise exception 'El tipo de receta no es valido.';
  end if;
  if area_id is null or not exists (select 1 from public.areas where id = area_id and active = true) then
    raise exception 'Selecciona un area de produccion activa.';
  end if;
  if jsonb_array_length(coalesce(p_ingredients, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos un ingrediente.';
  end if;

  for ingredient in select value from jsonb_array_elements(p_ingredients)
  loop
    select * into inventory_item from public.inventory_items
    where id = (ingredient ->> 'inventory_item_id')::uuid and active = true;
    if inventory_item.id is null then
      raise exception 'La receta contiene un ingrediente inactivo o inexistente.';
    end if;

    recipe_qty := coalesce((ingredient ->> 'recipe_quantity')::numeric, (ingredient ->> 'quantity')::numeric, 0);
    inventory_qty := coalesce((ingredient ->> 'inventory_quantity')::numeric, (ingredient ->> 'quantity')::numeric, 0);
    if recipe_qty <= 0 or inventory_qty <= 0 then
      raise exception 'La cantidad de % debe ser mayor que cero.', inventory_item.name;
    end if;
    if nullif(trim(coalesce(ingredient ->> 'inventory_unit', ingredient ->> 'unit', '')), '') is not null
       and trim(coalesce(ingredient ->> 'inventory_unit', ingredient ->> 'unit')) <> inventory_item.base_unit then
      raise exception 'El equivalente de inventario de % debe estar en la unidad base: %.', inventory_item.name, inventory_item.base_unit;
    end if;

    total_cost := total_cost + (inventory_qty * inventory_item.cost_per_base_unit);
  end loop;

  if p_recipe_id is not null then
    select * into existing from public.standard_recipes where id = p_recipe_id;
    if existing.id is null then raise exception 'La receta no existe.'; end if;
    if not public.can_manage_recipe_area(existing.production_area_id) then
      raise exception 'No tienes permiso para editar esta receta.';
    end if;
    update public.standard_recipes set
      name = trim(p_recipe ->> 'name'),
      recipe_type = recipe_kind,
      pos_category_id = nullif(trim(p_recipe ->> 'pos_category_id'), ''),
      production_area_id = area_id,
      yield_quantity = coalesce((p_recipe ->> 'yield_quantity')::numeric, 1),
      yield_unit = nullif(trim(p_recipe ->> 'yield_unit'), ''),
      estimated_cost = total_cost,
      active = coalesce((p_recipe ->> 'active')::boolean, true),
      image_url = nullif(trim(p_recipe ->> 'image_url'), ''),
      preparation_steps = coalesce(p_recipe -> 'preparation_steps', '[]'::jsonb),
      notes = nullif(trim(p_recipe ->> 'notes'), '')
    where id = p_recipe_id returning * into saved;
    delete from public.recipe_ingredients where recipe_id = p_recipe_id;
  else
    insert into public.standard_recipes (
      name, recipe_type, pos_category_id, production_area_id, yield_quantity,
      yield_unit, estimated_cost, active, image_url, preparation_steps, notes, created_by
    ) values (
      trim(p_recipe ->> 'name'), recipe_kind, nullif(trim(p_recipe ->> 'pos_category_id'), ''),
      area_id, coalesce((p_recipe ->> 'yield_quantity')::numeric, 1),
      nullif(trim(p_recipe ->> 'yield_unit'), ''), total_cost,
      coalesce((p_recipe ->> 'active')::boolean, true), nullif(trim(p_recipe ->> 'image_url'), ''),
      coalesce(p_recipe -> 'preparation_steps', '[]'::jsonb),
      nullif(trim(p_recipe ->> 'notes'), ''), auth.uid()
    ) returning * into saved;
  end if;

  for ingredient in select value from jsonb_array_elements(p_ingredients)
  loop
    select * into inventory_item from public.inventory_items where id = (ingredient ->> 'inventory_item_id')::uuid;
    recipe_qty := coalesce((ingredient ->> 'recipe_quantity')::numeric, (ingredient ->> 'quantity')::numeric, 0);
    inventory_qty := coalesce((ingredient ->> 'inventory_quantity')::numeric, (ingredient ->> 'quantity')::numeric, 0);
    conversion := coalesce((ingredient ->> 'conversion_factor')::numeric, inventory_qty / recipe_qty, 1);
    recipe_unit_value := coalesce(nullif(trim(ingredient ->> 'recipe_unit'), ''), inventory_item.base_unit);

    insert into public.recipe_ingredients (
      recipe_id, inventory_item_id, ingredient_name, quantity, unit,
      recipe_quantity, recipe_unit, inventory_quantity, inventory_unit, conversion_factor,
      waste_percentage, notes
    ) values (
      saved.id, inventory_item.id, inventory_item.name, inventory_qty, inventory_item.base_unit,
      recipe_qty, recipe_unit_value, inventory_qty, inventory_item.base_unit, conversion,
      coalesce((ingredient ->> 'waste_percentage')::numeric, 0),
      nullif(trim(ingredient ->> 'notes'), '')
    );
  end loop;
  return saved;
end;
$$;
