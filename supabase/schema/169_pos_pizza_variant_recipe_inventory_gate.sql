-- ---------------------------------------------------------------------------
-- Pizza: receta en variantes solo cuando inventory_tracking_enabled = true
-- Corrige trigger validate_pos_product_variant (051) que exigía receta siempre.
-- ---------------------------------------------------------------------------

create or replace function public.validate_pos_product_variant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_product public.pos_products;
  recipe public.standard_recipes;
  v_requires_recipe boolean;
begin
  new.updated_at := now();

  select * into parent_product
  from public.pos_products
  where id = new.product_id;

  if parent_product.id is null then
    raise exception 'El producto padre de la variante no existe.';
  end if;

  if not new.is_active then
    return new;
  end if;

  if coalesce(new.price, 0) <= 0 then
    raise exception 'La variante activa debe tener precio de venta mayor que cero.';
  end if;

  v_requires_recipe := coalesce(parent_product.inventory_tracking_enabled, false)
    or coalesce(parent_product.recipe_required_for_sale, false);

  if v_requires_recipe and new.recipe_id is null then
    raise exception 'La variante activa debe tener una receta conectada porque el producto controla inventario.';
  end if;

  if new.recipe_id is null then
    new.production_area_id := parent_product.production_area_id;
    return new;
  end if;

  select * into recipe
  from public.standard_recipes
  where id = new.recipe_id
    and active = true
    and recipe_type = 'final_product';

  if recipe.id is null then
    raise exception 'La variante requiere una receta final activa.';
  end if;

  new.production_area_id := recipe.production_area_id;

  if parent_product.production_area_id is not null
     and parent_product.production_area_id is distinct from new.production_area_id then
    raise exception 'El area de la variante debe coincidir con el area configurada en el producto padre.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- compute_pos_product_recipe_status — pizza sin control de inventario → missing
-- ---------------------------------------------------------------------------
create or replace function public.compute_pos_product_recipe_status(p_product_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.pos_products;
  v_recipe public.standard_recipes;
  v_ingredient_count integer := 0;
  v_valid_variants integer := 0;
begin
  select * into v_product from public.pos_products where id = p_product_id;
  if v_product.id is null then
    return 'missing';
  end if;

  if v_product.is_test_item then
    return 'missing';
  end if;

  if v_product.product_type = 'pizza' then
    if not coalesce(v_product.inventory_tracking_enabled, false) then
      return 'missing';
    end if;

    select count(*) into v_valid_variants
    from public.pos_product_variants variant
    join public.standard_recipes recipe on recipe.id = variant.recipe_id
    where variant.product_id = v_product.id
      and variant.is_active = true
      and recipe.recipe_type = 'final_product';

    if v_valid_variants = 0 then
      return 'missing';
    end if;

    select count(*) into v_valid_variants
    from public.pos_product_variants variant
    join public.standard_recipes recipe on recipe.id = variant.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe.id
    where variant.product_id = v_product.id
      and variant.is_active = true
      and recipe.active = true
      and recipe.recipe_type = 'final_product';

    if v_valid_variants = 0 then
      return case
        when exists (
          select 1
          from public.pos_product_variants variant
          join public.standard_recipes recipe on recipe.id = variant.recipe_id
          where variant.product_id = v_product.id
            and variant.is_active = true
            and recipe.active = false
        ) then 'paused'
        else 'draft'
      end;
    end if;

    return 'active';
  end if;

  if v_product.recipe_id is null then
    return 'missing';
  end if;

  select * into v_recipe
  from public.standard_recipes
  where id = v_product.recipe_id
    and recipe_type = 'final_product';

  if v_recipe.id is null then
    return 'missing';
  end if;

  if not v_recipe.active then
    return 'paused';
  end if;

  select count(*) into v_ingredient_count
  from public.recipe_ingredients
  where recipe_id = v_recipe.id;

  if v_ingredient_count = 0 then
    return 'draft';
  end if;

  return 'active';
end;
$$;

-- ---------------------------------------------------------------------------
-- refresh_pos_product_catalog_state — pizza readiness por inventory_tracking
-- ---------------------------------------------------------------------------
create or replace function public.refresh_pos_product_catalog_state(p_product_id uuid)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.pos_products;
  has_valid_variant boolean := false;
  has_valid_config boolean := false;
  v_mode text := public.get_inventory_deduction_mode();
  v_implementation boolean := v_mode <> 'strict';
  v_min_price numeric := 0;
begin
  select * into saved
  from public.pos_products
  where id = p_product_id
  for update;

  if saved.id is null then
    raise exception 'El producto POS no existe.';
  end if;

  saved.recipe_status := public.compute_pos_product_recipe_status(saved.id);

  if not saved.active then
    update public.pos_products
    set production_ready = false,
        recipe_status = saved.recipe_status
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  if saved.is_test_item then
    update public.pos_products
    set recipe_id = null,
        production_ready = true,
        recipe_status = 'missing'
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  if saved.product_type = 'pizza' then
    if coalesce(saved.inventory_tracking_enabled, false) then
      select exists (
        select 1
        from public.pos_product_variants variant
        join public.standard_recipes recipe on recipe.id = variant.recipe_id
        where variant.product_id = saved.id
          and variant.is_active = true
          and variant.price > 0
          and recipe.active = true
          and recipe.recipe_type = 'final_product'
          and recipe.production_area_id = saved.production_area_id
      ) into has_valid_variant;
    else
      select exists (
        select 1
        from public.pos_product_variants variant
        where variant.product_id = saved.id
          and variant.is_active = true
          and variant.price > 0
      ) into has_valid_variant;
    end if;

    update public.pos_products
    set recipe_id = null,
        production_ready = has_valid_variant
          and saved.production_area_id is not null,
        recipe_status = saved.recipe_status
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  if saved.product_type = 'configurable' then
    has_valid_config := public.pos_configurable_catalog_is_valid(saved.id);
    v_min_price := public.pos_configurable_min_absolute_price(saved.id);

    update public.pos_products
    set recipe_id = null,
        price = case when v_min_price > 0 then v_min_price else price end,
        production_ready = has_valid_config
          and saved.production_area_id is not null,
        recipe_status = saved.recipe_status
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  if v_implementation and not saved.recipe_required_for_sale then
    update public.pos_products
    set production_ready = saved.production_area_id is not null,
        recipe_status = saved.recipe_status
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  update public.pos_products
  set production_ready = (
    recipe_id is not null
    and production_area_id is not null
    and price >= 0
    and saved.recipe_status = 'active'
  ),
  recipe_status = saved.recipe_status
  where id = saved.id
  returning * into saved;

  return saved;
end;
$$;
