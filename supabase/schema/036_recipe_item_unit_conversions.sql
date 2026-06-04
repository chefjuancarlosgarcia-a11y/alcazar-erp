-- Per-item culinary unit conversions for recipes.
-- Apply after 021_recipe_steps_unit_conversions.sql.

create table if not exists public.inventory_item_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  from_unit text not null,
  to_unit text not null,
  factor numeric not null check (factor > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, from_unit, to_unit),
  check (nullif(trim(from_unit), '') is not null),
  check (nullif(trim(to_unit), '') is not null),
  check (lower(trim(from_unit)) <> lower(trim(to_unit)))
);

alter table public.inventory_item_unit_conversions enable row level security;

grant select, insert, update, delete on public.inventory_item_unit_conversions to authenticated;
grant all on public.inventory_item_unit_conversions to service_role;

drop policy if exists "inventory_item_unit_conversions_read" on public.inventory_item_unit_conversions;
create policy "inventory_item_unit_conversions_read"
  on public.inventory_item_unit_conversions for select to authenticated
  using (true);

drop policy if exists "inventory_item_unit_conversions_manage" on public.inventory_item_unit_conversions;
create policy "inventory_item_unit_conversions_manage"
  on public.inventory_item_unit_conversions for all to authenticated
  using (
    public.is_profile_manager()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and status = 'active'
        and public.normalize_profile_role(role) in ('supervisor', 'gerente', 'gerente_general', 'admin')
    )
  )
  with check (
    public.is_profile_manager()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and status = 'active'
        and public.normalize_profile_role(role) in ('supervisor', 'gerente', 'gerente_general', 'admin')
    )
  );

drop trigger if exists set_inventory_item_unit_conversions_updated_at on public.inventory_item_unit_conversions;
create trigger set_inventory_item_unit_conversions_updated_at
  before update on public.inventory_item_unit_conversions
  for each row execute procedure public.set_recipe_updated_at();

alter table public.recipe_ingredients
  add column if not exists conversion_warning boolean not null default false;

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
  if coalesce((p_recipe ->> 'yield_quantity')::numeric, 0) <= 0 then
    raise exception 'El rendimiento debe ser mayor que cero.';
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
      conversion_warning, waste_percentage, notes
    ) values (
      saved.id, inventory_item.id, inventory_item.name, inventory_qty, inventory_item.base_unit,
      recipe_qty, recipe_unit_value, inventory_qty, inventory_item.base_unit, conversion,
      coalesce((ingredient ->> 'conversion_warning')::boolean, false),
      coalesce((ingredient ->> 'waste_percentage')::numeric, 0),
      nullif(trim(ingredient ->> 'notes'), '')
    );
  end loop;
  return saved;
end;
$$;

revoke all on function public.save_standard_recipe(uuid, jsonb, jsonb) from public;
grant execute on function public.save_standard_recipe(uuid, jsonb, jsonb) to authenticated;
