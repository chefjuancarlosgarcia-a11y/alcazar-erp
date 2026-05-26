-- Official POS catalog backed by Supabase recipes and production areas.
-- Apply after 007_recipes.sql.

create table if not exists public.pos_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric not null default 0 check (price >= 0),
  image_url text,
  category_id text,
  category_name text,
  recipe_id uuid references public.standard_recipes(id),
  production_area_id text references public.areas(id),
  active boolean not null default true,
  production_ready boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_products_active_category_idx
  on public.pos_products (active, production_ready, category_id, sort_order);
create index if not exists pos_products_recipe_idx
  on public.pos_products (recipe_id);

alter table public.pos_products enable row level security;

grant select, insert, update on public.pos_products to authenticated;
grant all on public.pos_products to service_role;

-- Internal operations can inspect incomplete products while the legacy catalog is migrated.
drop policy if exists "pos_products_authenticated_read" on public.pos_products;
create policy "pos_products_authenticated_read"
  on public.pos_products for select to authenticated
  using (true);

drop policy if exists "pos_products_managers_insert" on public.pos_products;
create policy "pos_products_managers_insert"
  on public.pos_products for insert to authenticated
  with check (public.is_profile_manager());

drop policy if exists "pos_products_managers_update" on public.pos_products;
create policy "pos_products_managers_update"
  on public.pos_products for update to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

create or replace function public.validate_pos_product_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  area public.areas;
begin
  new.updated_at := now();
  if new.active and (new.recipe_id is null or new.production_area_id is null) then
    raise exception 'Un producto POS activo debe tener receta y área de producción.';
  end if;

  new.production_ready := false;
  if not new.active then
    return new;
  end if;

  select * into recipe
  from public.standard_recipes
  where id = new.recipe_id
    and active = true
    and recipe_type = 'final_product';
  if recipe.id is null then
    raise exception 'El producto POS requiere una receta final activa.';
  end if;
  if recipe.production_area_id is distinct from new.production_area_id then
    raise exception 'El área del producto POS debe coincidir con el área de la receta.';
  end if;

  select * into area
  from public.areas
  where id = new.production_area_id
    and active = true
    and is_production_area = true;
  if area.id is null then
    raise exception 'El producto POS requiere un área productiva activa.';
  end if;

  new.production_ready := true;
  return new;
end;
$$;

drop trigger if exists validate_pos_product_readiness on public.pos_products;
create trigger validate_pos_product_readiness
  before insert or update on public.pos_products
  for each row execute procedure public.validate_pos_product_readiness();

create or replace function public.save_pos_product_from_recipe(
  p_product_id uuid,
  p_recipe_id uuid,
  p_product jsonb
)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  saved public.pos_products;
  category_id text := nullif(trim(p_product ->> 'category_id'), '');
begin
  select * into recipe
  from public.standard_recipes
  where id = p_recipe_id
    and active = true
    and recipe_type = 'final_product';
  if recipe.id is null then
    raise exception 'Solo una receta final activa puede publicarse en POS.';
  end if;
  if not public.can_manage_recipe_area(recipe.production_area_id) then
    raise exception 'No tienes permiso para publicar productos de esta área.';
  end if;
  if nullif(trim(p_product ->> 'name'), '') is null then
    raise exception 'El nombre del producto POS es obligatorio.';
  end if;
  if coalesce((p_product ->> 'price')::numeric, 0) <= 0 then
    raise exception 'El precio de venta del producto POS debe ser mayor que cero.';
  end if;

  if p_product_id is null then
    insert into public.pos_products (
      name, description, price, image_url, category_id, category_name,
      recipe_id, production_area_id, active, sort_order, created_by
    ) values (
      trim(p_product ->> 'name'),
      nullif(trim(p_product ->> 'description'), ''),
      (p_product ->> 'price')::numeric,
      nullif(trim(p_product ->> 'image_url'), ''),
      category_id,
      nullif(trim(p_product ->> 'category_name'), ''),
      recipe.id,
      recipe.production_area_id,
      true,
      coalesce((p_product ->> 'sort_order')::integer, 0),
      auth.uid()
    ) returning * into saved;
  else
    update public.pos_products set
      name = trim(p_product ->> 'name'),
      description = nullif(trim(p_product ->> 'description'), ''),
      price = (p_product ->> 'price')::numeric,
      image_url = nullif(trim(p_product ->> 'image_url'), ''),
      category_id = category_id,
      category_name = nullif(trim(p_product ->> 'category_name'), ''),
      recipe_id = recipe.id,
      production_area_id = recipe.production_area_id,
      active = true,
      sort_order = coalesce((p_product ->> 'sort_order')::integer, 0)
    where id = p_product_id
    returning * into saved;
    if saved.id is null then raise exception 'El producto POS seleccionado no existe.'; end if;
  end if;

  insert into public.pos_recipe_links (pos_product_id, recipe_id, auto_consume)
  values (saved.id::text, recipe.id, true)
  on conflict (pos_product_id) do update
    set recipe_id = excluded.recipe_id, auto_consume = true;
  return saved;
end;
$$;

revoke all on function public.save_pos_product_from_recipe(uuid, uuid, jsonb) from public;
grant execute on function public.save_pos_product_from_recipe(uuid, uuid, jsonb) to authenticated;

-- Replace the transitional consumer: pos_products is now the source of truth.
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
  product public.pos_products;
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

  select * into prior_consumption
  from public.pos_recipe_consumptions
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

  select * into product
  from public.pos_products
  where id::text = trim(p_pos_product_id)
    and active = true
    and production_ready = true;
  if product.id is null then
    raise exception 'Este producto POS no está activo o listo para producción.';
  end if;

  select * into recipe
  from public.standard_recipes
  where id = product.recipe_id
    and active = true
    and recipe_type = 'final_product';
  if recipe.id is null then
    raise exception 'Este producto no tiene receta estandarizada conectada.';
  end if;
  if product.production_area_id is null or product.production_area_id is distinct from recipe.production_area_id then
    raise exception 'El producto POS no tiene área de producción válida.';
  end if;
  if not exists (select 1 from public.recipe_ingredients where recipe_id = recipe.id) then
    raise exception 'La receta conectada no tiene ingredientes.';
  end if;

  for ingredient in select * from public.recipe_ingredients where recipe_id = recipe.id
  loop
    required_quantity := (ingredient.quantity / recipe.yield_quantity) * p_quantity;
    select quantity into stock_before from public.area_inventory
      where item_id = ingredient.inventory_item_id and area_id = product.production_area_id
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
      where item_id = ingredient.inventory_item_id and area_id = product.production_area_id
      for update;
    update public.area_inventory set quantity = stock_before - required_quantity
      where item_id = ingredient.inventory_item_id and area_id = product.production_area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    ) values (
      ingredient.inventory_item_id, 'consumption', product.production_area_id,
      required_quantity, ingredient.unit, stock_before, stock_before - required_quantity,
      'pos_order', trim(p_order_item_id),
      'Consumo receta POS: ' || recipe.name, auth.uid()
    );
  end loop;

  insert into public.pos_recipe_consumptions (
    order_item_id, pos_product_id, recipe_id, production_area_id, quantity_sold, consumed_by
  ) values (
    trim(p_order_item_id), product.id::text, recipe.id, product.production_area_id, p_quantity, auth.uid()
  );

  return jsonb_build_object(
    'consumed', true,
    'already_consumed', false,
    'recipe_id', recipe.id,
    'recipe_name', recipe.name,
    'production_area_id', product.production_area_id,
    'pos_product_id', product.id
  );
end;
$$;

revoke all on function public.consume_recipe_inventory(text, text, numeric) from public;
grant execute on function public.consume_recipe_inventory(text, text, numeric) to authenticated;
