-- Standard recipes linked to Supabase inventory and legacy POS product identifiers.
-- Apply after 006_requisitions.sql.

create table if not exists public.standard_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  recipe_type text not null default 'subrecipe'
    check (recipe_type in ('subrecipe', 'final_product')),
  pos_category_id text,
  production_area_id text references public.areas(id),
  yield_quantity numeric not null default 1 check (yield_quantity > 0),
  yield_unit text,
  estimated_cost numeric not null default 0 check (estimated_cost >= 0),
  active boolean not null default true,
  image_url text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.standard_recipes(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  ingredient_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  waste_percentage numeric not null default 0 check (waste_percentage >= 0 and waste_percentage <= 100),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_recipe_links (
  id uuid primary key default gen_random_uuid(),
  pos_product_id text not null unique,
  recipe_id uuid not null references public.standard_recipes(id) on delete cascade,
  auto_consume boolean not null default true,
  created_at timestamptz not null default now()
);

-- POS orders remain local during this migration phase. This bridge gives each
-- local order line server-side idempotency and auditability for consumption.
create table if not exists public.pos_recipe_consumptions (
  id uuid primary key default gen_random_uuid(),
  order_item_id text not null unique,
  pos_product_id text not null,
  recipe_id uuid not null references public.standard_recipes(id),
  production_area_id text not null references public.areas(id),
  quantity_sold numeric not null check (quantity_sold > 0),
  consumed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);
create index if not exists recipes_production_area_idx on public.standard_recipes (production_area_id);

alter table public.standard_recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.pos_recipe_links enable row level security;
alter table public.pos_recipe_consumptions enable row level security;

grant select, insert, update on public.standard_recipes to authenticated;
grant select, insert, update, delete on public.recipe_ingredients to authenticated;
grant select, insert, update on public.pos_recipe_links to authenticated;
grant select on public.pos_recipe_consumptions to authenticated;
grant all on public.standard_recipes, public.recipe_ingredients, public.pos_recipe_links, public.pos_recipe_consumptions to service_role;

create or replace function public.set_recipe_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_recipe_updated_at on public.standard_recipes;
create trigger set_recipe_updated_at
  before update on public.standard_recipes
  for each row execute procedure public.set_recipe_updated_at();

create or replace function public.can_manage_recipe_area(p_area_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_profile_manager()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and status = 'active'
        and role = 'supervisor'
        and area_id = p_area_id
    );
$$;

revoke all on function public.can_manage_recipe_area(text) from public;
grant execute on function public.can_manage_recipe_area(text) to authenticated;

drop policy if exists "recipes_authenticated_read_active" on public.standard_recipes;
create policy "recipes_authenticated_read_active"
  on public.standard_recipes for select to authenticated
  using (active = true or public.is_profile_manager());

drop policy if exists "recipe_ingredients_authenticated_read" on public.recipe_ingredients;
create policy "recipe_ingredients_authenticated_read"
  on public.recipe_ingredients for select to authenticated
  using (
    exists (
      select 1 from public.standard_recipes as recipe
      where recipe.id = recipe_ingredients.recipe_id
        and (recipe.active = true or public.is_profile_manager())
    )
  );

drop policy if exists "pos_recipe_links_authenticated_read" on public.pos_recipe_links;
create policy "pos_recipe_links_authenticated_read"
  on public.pos_recipe_links for select to authenticated
  using (true);

drop policy if exists "pos_recipe_consumptions_authenticated_read" on public.pos_recipe_consumptions;
create policy "pos_recipe_consumptions_authenticated_read"
  on public.pos_recipe_consumptions for select to authenticated
  using (true);

drop policy if exists "recipes_managers_direct_write" on public.standard_recipes;
create policy "recipes_managers_direct_write"
  on public.standard_recipes for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "recipe_ingredients_managers_direct_write" on public.recipe_ingredients;
create policy "recipe_ingredients_managers_direct_write"
  on public.recipe_ingredients for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "pos_recipe_links_managers_direct_write" on public.pos_recipe_links;
create policy "pos_recipe_links_managers_direct_write"
  on public.pos_recipe_links for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

-- Supervisors create/edit their area only through RPC validation below.
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
begin
  if not public.can_manage_recipe_area(area_id) then
    raise exception 'No tienes permiso para administrar recetas de esta área.';
  end if;
  if nullif(trim(p_recipe ->> 'name'), '') is null then
    raise exception 'El nombre de la receta es obligatorio.';
  end if;
  if recipe_kind not in ('subrecipe', 'final_product') then
    raise exception 'El tipo de receta no es válido.';
  end if;
  if area_id is null or not exists (select 1 from public.areas where id = area_id and active = true) then
    raise exception 'Selecciona un área de producción activa.';
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
    if coalesce((ingredient ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'La cantidad de % debe ser mayor que cero.', inventory_item.name;
    end if;
    if trim(ingredient ->> 'unit') <> inventory_item.base_unit then
      raise exception 'La unidad de % debe ser la unidad base del inventario: %.', inventory_item.name, inventory_item.base_unit;
    end if;
    total_cost := total_cost + ((ingredient ->> 'quantity')::numeric * inventory_item.cost_per_base_unit);
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
      notes = nullif(trim(p_recipe ->> 'notes'), '')
    where id = p_recipe_id returning * into saved;
    delete from public.recipe_ingredients where recipe_id = p_recipe_id;
  else
    insert into public.standard_recipes (
      name, recipe_type, pos_category_id, production_area_id, yield_quantity,
      yield_unit, estimated_cost, active, image_url, notes, created_by
    ) values (
      trim(p_recipe ->> 'name'), recipe_kind, nullif(trim(p_recipe ->> 'pos_category_id'), ''),
      area_id, coalesce((p_recipe ->> 'yield_quantity')::numeric, 1),
      nullif(trim(p_recipe ->> 'yield_unit'), ''), total_cost,
      coalesce((p_recipe ->> 'active')::boolean, true), nullif(trim(p_recipe ->> 'image_url'), ''),
      nullif(trim(p_recipe ->> 'notes'), ''), auth.uid()
    ) returning * into saved;
  end if;

  for ingredient in select value from jsonb_array_elements(p_ingredients)
  loop
    select * into inventory_item from public.inventory_items where id = (ingredient ->> 'inventory_item_id')::uuid;
    insert into public.recipe_ingredients (
      recipe_id, inventory_item_id, ingredient_name, quantity, unit, waste_percentage, notes
    ) values (
      saved.id, inventory_item.id, inventory_item.name,
      (ingredient ->> 'quantity')::numeric, trim(ingredient ->> 'unit'),
      coalesce((ingredient ->> 'waste_percentage')::numeric, 0),
      nullif(trim(ingredient ->> 'notes'), '')
    );
  end loop;
  return saved;
end;
$$;

create or replace function public.deactivate_standard_recipe(p_recipe_id uuid)
returns public.standard_recipes
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
begin
  select * into recipe from public.standard_recipes where id = p_recipe_id;
  if recipe.id is null or not public.can_manage_recipe_area(recipe.production_area_id) then
    raise exception 'No tienes permiso para desactivar esta receta.';
  end if;
  update public.standard_recipes set active = false where id = p_recipe_id returning * into recipe;
  return recipe;
end;
$$;

create or replace function public.link_recipe_to_pos(
  p_pos_product_id text,
  p_recipe_id uuid
)
returns public.pos_recipe_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  linked public.pos_recipe_links;
begin
  select * into recipe from public.standard_recipes where id = p_recipe_id and active = true;
  if recipe.id is null or recipe.recipe_type <> 'final_product' then
    raise exception 'Solo una receta final activa puede conectarse al POS.';
  end if;
  if not public.can_manage_recipe_area(recipe.production_area_id) then
    raise exception 'No tienes permiso para enlazar esta receta.';
  end if;
  if nullif(trim(p_pos_product_id), '') is null then
    raise exception 'Selecciona un producto POS.';
  end if;
  insert into public.pos_recipe_links (pos_product_id, recipe_id, auto_consume)
  values (trim(p_pos_product_id), recipe.id, true)
  on conflict (pos_product_id) do update
    set recipe_id = excluded.recipe_id, auto_consume = true
  returning * into linked;
  return linked;
end;
$$;

create or replace function public.consume_recipe_inventory(
  p_order_item_id text,
  p_pos_product_id text,
  p_quantity numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked public.pos_recipe_links;
  recipe public.standard_recipes;
  ingredient public.recipe_ingredients;
  prior_consumption public.pos_recipe_consumptions;
  required_quantity numeric;
  stock_before numeric;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('admin', 'gerente_general', 'supervisor', 'mesero')
  ) then
    raise exception 'Usuario no autorizado para enviar comandas.';
  end if;
  if nullif(trim(p_order_item_id), '') is null or nullif(trim(p_pos_product_id), '') is null or p_quantity <= 0 then
    raise exception 'La línea de comanda o cantidad no es válida.';
  end if;
  select * into prior_consumption from public.pos_recipe_consumptions
    where order_item_id = trim(p_order_item_id);
  if prior_consumption.id is not null then
    return jsonb_build_object(
      'consumed', false,
      'already_consumed', true,
      'order_item_id', trim(p_order_item_id),
      'recipe_id', prior_consumption.recipe_id,
      'production_area_id', prior_consumption.production_area_id
    );
  end if;

  select * into linked from public.pos_recipe_links
    where pos_product_id = trim(p_pos_product_id) and auto_consume = true;
  if linked.id is null then
    raise exception 'Este producto no tiene receta estandarizada conectada.';
  end if;
  select * into recipe from public.standard_recipes
    where id = linked.recipe_id and active = true and recipe_type = 'final_product';
  if recipe.id is null or recipe.production_area_id is null then
    raise exception 'La receta final no tiene área de producción válida.';
  end if;
  if not exists (select 1 from public.recipe_ingredients where recipe_id = recipe.id) then
    raise exception 'La receta conectada no tiene ingredientes.';
  end if;

  for ingredient in select * from public.recipe_ingredients where recipe_id = recipe.id
  loop
    required_quantity := (ingredient.quantity / recipe.yield_quantity) * p_quantity;
    select quantity into stock_before from public.area_inventory
      where item_id = ingredient.inventory_item_id and area_id = recipe.production_area_id
      for update;
    stock_before := coalesce(stock_before, 0);
    if stock_before < required_quantity then
      raise exception 'Stock insuficiente para %. Disponible: % %, requerido: % %.',
        ingredient.ingredient_name, stock_before, ingredient.unit, required_quantity, ingredient.unit;
    end if;
  end loop;

  for ingredient in select * from public.recipe_ingredients where recipe_id = recipe.id
  loop
    required_quantity := (ingredient.quantity / recipe.yield_quantity) * p_quantity;
    select quantity into stock_before from public.area_inventory
      where item_id = ingredient.inventory_item_id and area_id = recipe.production_area_id
      for update;
    update public.area_inventory set quantity = stock_before - required_quantity
      where item_id = ingredient.inventory_item_id and area_id = recipe.production_area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    ) values (
      ingredient.inventory_item_id, 'consumption', recipe.production_area_id,
      required_quantity, ingredient.unit, stock_before, stock_before - required_quantity,
      'pos_order', trim(p_order_item_id),
      'Consumo receta POS: ' || recipe.name, auth.uid()
    );
  end loop;

  insert into public.pos_recipe_consumptions (
    order_item_id, pos_product_id, recipe_id, production_area_id, quantity_sold, consumed_by
  ) values (
    trim(p_order_item_id), trim(p_pos_product_id), recipe.id, recipe.production_area_id, p_quantity, auth.uid()
  );
  return jsonb_build_object(
    'consumed', true,
    'already_consumed', false,
    'recipe_id', recipe.id,
    'recipe_name', recipe.name,
    'production_area_id', recipe.production_area_id
  );
end;
$$;

revoke all on function public.save_standard_recipe(uuid, jsonb, jsonb) from public;
revoke all on function public.deactivate_standard_recipe(uuid) from public;
revoke all on function public.link_recipe_to_pos(text, uuid) from public;
revoke all on function public.consume_recipe_inventory(text, text, numeric) from public;
grant execute on function public.save_standard_recipe(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.deactivate_standard_recipe(uuid) to authenticated;
grant execute on function public.link_recipe_to_pos(text, uuid) to authenticated;
grant execute on function public.consume_recipe_inventory(text, text, numeric) to authenticated;
