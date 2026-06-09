-- POS catalog upgrades for pizza variants, modifiers, and kitchen notes.
-- Apply after 050_notification_action_url_rpc.sql.

alter table public.pos_products
  add column if not exists product_type text not null default 'simple'
    check (product_type in ('pizza', 'simple', 'beverage', 'dessert', 'manual_test')),
  add column if not exists allow_kitchen_notes boolean not null default false,
  add column if not exists prep_time_minutes integer not null default 15 check (prep_time_minutes >= 0);

create table if not exists public.pos_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pos_products(id) on delete cascade,
  name text not null,
  size text not null check (size in ('personal', 'mediana', 'grande')),
  price numeric not null default 0 check (price >= 0),
  recipe_id uuid references public.standard_recipes(id),
  production_area_id text references public.areas(id),
  prep_time_minutes integer not null default 0 check (prep_time_minutes >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size)
);

create table if not exists public.pos_product_modifiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pos_products(id) on delete cascade,
  name text not null,
  modifier_type text not null check (modifier_type in ('remove', 'extra', 'note')),
  price_delta numeric not null default 0 check (price_delta >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pos_order_items
  add column if not exists product_variant_id uuid references public.pos_product_variants(id),
  add column if not exists product_variant_name text,
  add column if not exists selected_size text;

create index if not exists pos_product_variants_product_active_idx
  on public.pos_product_variants (product_id, is_active, sort_order);

create index if not exists pos_product_modifiers_product_active_idx
  on public.pos_product_modifiers (product_id, is_active, sort_order);

create index if not exists pos_order_items_variant_idx
  on public.pos_order_items (product_variant_id);

alter table public.pos_product_variants enable row level security;
alter table public.pos_product_modifiers enable row level security;

grant select, insert, update, delete on public.pos_product_variants, public.pos_product_modifiers to authenticated;
grant all on public.pos_product_variants, public.pos_product_modifiers to service_role;

drop policy if exists "pos_product_variants_authenticated_read" on public.pos_product_variants;
create policy "pos_product_variants_authenticated_read"
  on public.pos_product_variants for select to authenticated
  using (true);

drop policy if exists "pos_product_variants_managers_write" on public.pos_product_variants;
create policy "pos_product_variants_managers_write"
  on public.pos_product_variants for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "pos_product_modifiers_authenticated_read" on public.pos_product_modifiers;
create policy "pos_product_modifiers_authenticated_read"
  on public.pos_product_modifiers for select to authenticated
  using (true);

drop policy if exists "pos_product_modifiers_managers_write" on public.pos_product_modifiers;
create policy "pos_product_modifiers_managers_write"
  on public.pos_product_modifiers for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

create or replace function public.touch_pos_product_child_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.send_pos_order_to_production(uuid) from public;
grant execute on function public.send_pos_order_to_production(uuid) to authenticated;

drop trigger if exists touch_pos_product_variants_updated_at on public.pos_product_variants;
create trigger touch_pos_product_variants_updated_at
  before update on public.pos_product_variants
  for each row execute function public.touch_pos_product_child_updated_at();

drop trigger if exists touch_pos_product_modifiers_updated_at on public.pos_product_modifiers;
create trigger touch_pos_product_modifiers_updated_at
  before update on public.pos_product_modifiers
  for each row execute function public.touch_pos_product_child_updated_at();

create or replace function public.validate_pos_product_variant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_product public.pos_products;
  recipe public.standard_recipes;
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

  if new.recipe_id is null then
    raise exception 'La variante activa debe tener una receta conectada.';
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

drop trigger if exists validate_pos_product_variant on public.pos_product_variants;
create trigger validate_pos_product_variant
  before insert or update on public.pos_product_variants
  for each row execute function public.validate_pos_product_variant();

create or replace function public.refresh_pos_product_catalog_state(p_product_id uuid)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.pos_products;
  has_valid_variant boolean := false;
begin
  select * into saved
  from public.pos_products
  where id = p_product_id
  for update;

  if saved.id is null then
    raise exception 'El producto POS no existe.';
  end if;

  if not saved.active then
    update public.pos_products
    set production_ready = false
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  if saved.is_test_item then
    update public.pos_products
    set recipe_id = null,
        production_ready = true
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  if saved.product_type = 'pizza' then
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

    update public.pos_products
    set recipe_id = null,
        production_ready = has_valid_variant
    where id = saved.id
    returning * into saved;
    return saved;
  end if;

  update public.pos_products
  set production_ready = (
    recipe_id is not null
    and production_area_id is not null
    and price >= 0
  )
  where id = saved.id
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.refresh_pos_product_catalog_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_pos_product_catalog_state(coalesce(new.product_id, old.product_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_pos_product_state_after_variant on public.pos_product_variants;
create trigger refresh_pos_product_state_after_variant
  after insert or update or delete on public.pos_product_variants
  for each row execute function public.refresh_pos_product_catalog_state_trigger();

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
  new.production_ready := false;

  if not new.active then
    return new;
  end if;

  select * into area
  from public.areas
  where id = new.production_area_id
    and active = true
    and is_production_area = true;

  if area.id is null then
    raise exception 'El producto POS requiere un destino KDS activo.';
  end if;

  if new.is_test_item or new.product_type = 'manual_test' then
    new.recipe_id := null;
    new.production_ready := true;
    return new;
  end if;

  if new.product_type = 'pizza' then
    new.recipe_id := null;
    return new;
  end if;

  if new.recipe_id is null then
    raise exception 'Un producto POS activo debe tener receta.';
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
    raise exception 'El area del producto POS debe coincidir con el area de la receta.';
  end if;

  new.production_ready := true;
  return new;
end;
$$;

create or replace function public.save_pos_catalog_product(
  p_product_id uuid,
  p_product jsonb,
  p_variants jsonb default '[]'::jsonb,
  p_modifiers jsonb default '[]'::jsonb
)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.pos_products;
  recipe public.standard_recipes;
  variant_row jsonb;
  modifier_row jsonb;
  variant_ids uuid[] := '{}'::uuid[];
  modifier_ids uuid[] := '{}'::uuid[];
  saved_variant_id uuid;
  saved_modifier_id uuid;
  v_product_type text := coalesce(nullif(trim(p_product ->> 'product_type'), ''), 'simple');
  v_active boolean := coalesce((p_product ->> 'active')::boolean, true);
  v_is_test boolean := coalesce((p_product ->> 'is_test_item')::boolean, false) or v_product_type = 'manual_test';
  v_recipe_id uuid := nullif(p_product ->> 'recipe_id', '')::uuid;
  v_area_id text := nullif(trim(p_product ->> 'production_area_id'), '');
begin
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para guardar productos POS.';
  end if;

  if nullif(trim(p_product ->> 'name'), '') is null then
    raise exception 'El nombre del producto POS es obligatorio.';
  end if;

  if v_area_id is null and v_active then
    raise exception 'Selecciona el area de preparacion del producto.';
  end if;

  if v_product_type not in ('pizza', 'simple', 'beverage', 'dessert', 'manual_test') then
    raise exception 'Tipo de producto invalido.';
  end if;

  if v_product_type <> 'pizza' and not v_is_test then
    if v_recipe_id is null then
      raise exception 'El producto necesita una receta conectada.';
    end if;
    select * into recipe
    from public.standard_recipes
    where id = v_recipe_id
      and active = true
      and recipe_type = 'final_product';
    if recipe.id is null then
      raise exception 'La receta conectada no es valida.';
    end if;
    if recipe.production_area_id is distinct from v_area_id then
      raise exception 'El area del producto debe coincidir con el area de la receta conectada.';
    end if;
  end if;

  if p_product_id is null then
    insert into public.pos_products (
      name, description, price, image_url, category_id, category_name,
      recipe_id, production_area_id, active, is_test_item, product_type,
      allow_kitchen_notes, prep_time_minutes, sort_order, created_by
    ) values (
      trim(p_product ->> 'name'),
      nullif(trim(p_product ->> 'description'), ''),
      coalesce((p_product ->> 'price')::numeric, 0),
      nullif(trim(p_product ->> 'image_url'), ''),
      nullif(trim(p_product ->> 'category_id'), ''),
      nullif(trim(p_product ->> 'category_name'), ''),
      case when v_product_type = 'pizza' or v_is_test then null else v_recipe_id end,
      v_area_id,
      v_active,
      v_is_test,
      v_product_type,
      coalesce((p_product ->> 'allow_kitchen_notes')::boolean, false),
      coalesce((p_product ->> 'prep_time_minutes')::integer, 15),
      coalesce((p_product ->> 'sort_order')::integer, 0),
      auth.uid()
    )
    returning * into saved;
  else
    update public.pos_products
    set
      name = trim(p_product ->> 'name'),
      description = nullif(trim(p_product ->> 'description'), ''),
      price = coalesce((p_product ->> 'price')::numeric, 0),
      image_url = nullif(trim(p_product ->> 'image_url'), ''),
      category_id = nullif(trim(p_product ->> 'category_id'), ''),
      category_name = nullif(trim(p_product ->> 'category_name'), ''),
      recipe_id = case when v_product_type = 'pizza' or v_is_test then null else v_recipe_id end,
      production_area_id = v_area_id,
      active = v_active,
      is_test_item = v_is_test,
      product_type = v_product_type,
      allow_kitchen_notes = coalesce((p_product ->> 'allow_kitchen_notes')::boolean, false),
      prep_time_minutes = coalesce((p_product ->> 'prep_time_minutes')::integer, 15),
      sort_order = coalesce((p_product ->> 'sort_order')::integer, 0)
    where id = p_product_id
    returning * into saved;

    if saved.id is null then
      raise exception 'El producto POS seleccionado no existe.';
    end if;
  end if;

  if v_product_type = 'pizza' then
    for variant_row in select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
    loop
      if nullif(trim(variant_row ->> 'size'), '') is null then
        continue;
      end if;

      saved_variant_id := null;

      if nullif(variant_row ->> 'id', '') is null then
        insert into public.pos_product_variants (
          product_id, name, size, price, recipe_id, prep_time_minutes, is_active, sort_order
        ) values (
          saved.id,
          coalesce(nullif(trim(variant_row ->> 'name'), ''), saved.name),
          trim(variant_row ->> 'size'),
          coalesce((variant_row ->> 'price')::numeric, 0),
          nullif(variant_row ->> 'recipe_id', '')::uuid,
          coalesce((variant_row ->> 'prep_time_minutes')::integer, 0),
          coalesce((variant_row ->> 'is_active')::boolean, false),
          coalesce((variant_row ->> 'sort_order')::integer, 0)
        )
        returning id into saved_variant_id;
      else
        update public.pos_product_variants
        set
          name = coalesce(nullif(trim(variant_row ->> 'name'), ''), saved.name),
          size = trim(variant_row ->> 'size'),
          price = coalesce((variant_row ->> 'price')::numeric, 0),
          recipe_id = nullif(variant_row ->> 'recipe_id', '')::uuid,
          prep_time_minutes = coalesce((variant_row ->> 'prep_time_minutes')::integer, 0),
          is_active = coalesce((variant_row ->> 'is_active')::boolean, false),
          sort_order = coalesce((variant_row ->> 'sort_order')::integer, 0)
        where id = (variant_row ->> 'id')::uuid
          and product_id = saved.id
        returning id into saved_variant_id;

        if saved_variant_id is null then
          insert into public.pos_product_variants (
            product_id, name, size, price, recipe_id, prep_time_minutes, is_active, sort_order
          ) values (
            saved.id,
            coalesce(nullif(trim(variant_row ->> 'name'), ''), saved.name),
            trim(variant_row ->> 'size'),
            coalesce((variant_row ->> 'price')::numeric, 0),
            nullif(variant_row ->> 'recipe_id', '')::uuid,
            coalesce((variant_row ->> 'prep_time_minutes')::integer, 0),
            coalesce((variant_row ->> 'is_active')::boolean, false),
            coalesce((variant_row ->> 'sort_order')::integer, 0)
          )
          returning id into saved_variant_id;
        end if;
      end if;

      if saved_variant_id is not null then
        variant_ids := array_append(variant_ids, saved_variant_id);
      end if;
    end loop;

    delete from public.pos_product_variants
    where product_id = saved.id
      and (cardinality(variant_ids) = 0 or id <> all(variant_ids));

    update public.pos_products
    set price = coalesce((
      select min(variant.price)
      from public.pos_product_variants variant
      where variant.product_id = saved.id
        and variant.is_active = true
    ), 0)
    where id = saved.id
    returning * into saved;
  else
    delete from public.pos_product_variants
    where product_id = saved.id;
  end if;

  for modifier_row in select value from jsonb_array_elements(coalesce(p_modifiers, '[]'::jsonb))
  loop
    if nullif(trim(modifier_row ->> 'name'), '') is null then
      continue;
    end if;

    saved_modifier_id := null;

    if nullif(modifier_row ->> 'id', '') is null then
      insert into public.pos_product_modifiers (
        product_id, name, modifier_type, price_delta, is_active, sort_order
      ) values (
        saved.id,
        trim(modifier_row ->> 'name'),
        coalesce(nullif(trim(modifier_row ->> 'modifier_type'), ''), 'remove'),
        coalesce((modifier_row ->> 'price_delta')::numeric, 0),
        coalesce((modifier_row ->> 'is_active')::boolean, true),
        coalesce((modifier_row ->> 'sort_order')::integer, 0)
      )
      returning id into saved_modifier_id;
    else
      update public.pos_product_modifiers
      set
        name = trim(modifier_row ->> 'name'),
        modifier_type = coalesce(nullif(trim(modifier_row ->> 'modifier_type'), ''), 'remove'),
        price_delta = coalesce((modifier_row ->> 'price_delta')::numeric, 0),
        is_active = coalesce((modifier_row ->> 'is_active')::boolean, true),
        sort_order = coalesce((modifier_row ->> 'sort_order')::integer, 0)
      where id = (modifier_row ->> 'id')::uuid
        and product_id = saved.id
      returning id into saved_modifier_id;

      if saved_modifier_id is null then
        insert into public.pos_product_modifiers (
          product_id, name, modifier_type, price_delta, is_active, sort_order
        ) values (
          saved.id,
          trim(modifier_row ->> 'name'),
          coalesce(nullif(trim(modifier_row ->> 'modifier_type'), ''), 'remove'),
          coalesce((modifier_row ->> 'price_delta')::numeric, 0),
          coalesce((modifier_row ->> 'is_active')::boolean, true),
          coalesce((modifier_row ->> 'sort_order')::integer, 0)
        )
        returning id into saved_modifier_id;
      end if;
    end if;

    if saved_modifier_id is not null then
      modifier_ids := array_append(modifier_ids, saved_modifier_id);
    end if;
  end loop;

  delete from public.pos_product_modifiers
  where product_id = saved.id
    and (cardinality(modifier_ids) = 0 or id <> all(modifier_ids));

  delete from public.pos_recipe_links
  where pos_product_id = saved.id::text;

  if saved.recipe_id is not null then
    insert into public.pos_recipe_links (pos_product_id, recipe_id, auto_consume)
    values (saved.id::text, saved.recipe_id, true)
    on conflict (pos_product_id) do update
      set recipe_id = excluded.recipe_id,
          auto_consume = true;
  end if;

  select * into saved
  from public.refresh_pos_product_catalog_state(saved.id);

  return saved;
end;
$$;

revoke all on function public.save_pos_catalog_product(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_pos_catalog_product(uuid, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.send_pos_order_to_production(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pos_order public.pos_orders;
  detail public.pos_order_items;
  product public.pos_products;
  recipe_row public.standard_recipes;
  variant_row public.pos_product_variants;
  required record;
  area_row record;
  ticket public.production_tickets;
  stock_before numeric;
  ticket_ids uuid[] := '{}'::uuid[];
  draft_count integer;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para enviar ordenes POS.';
  end if;

  select * into pos_order from public.pos_orders where id = p_order_id for update;
  if pos_order.id is null then raise exception 'La orden POS no existe.'; end if;
  if pos_order.status <> 'open' then raise exception 'Solo una orden abierta puede enviarse a produccion.'; end if;

  select count(*) into draft_count from public.pos_order_items
  where order_id = p_order_id and status = 'draft';
  if draft_count = 0 then raise exception 'No hay productos nuevos para enviar.'; end if;

  for detail in select * from public.pos_order_items where order_id = p_order_id and status = 'draft'
  loop
    select * into product from public.pos_products
      where id = detail.product_id and active = true and production_ready = true;

    if product.id is null then
      raise exception 'Producto % no esta listo para produccion.', detail.product_name;
    end if;

    if product.is_test_item then
      continue;
    end if;

    if detail.recipe_id is null or detail.production_area_id is null or not detail.production_ready then
      raise exception 'Producto % no esta listo para produccion.', detail.product_name;
    end if;

    if detail.product_variant_id is not null then
      select * into variant_row
      from public.pos_product_variants
      where id = detail.product_variant_id
        and product_id = detail.product_id
        and is_active = true;

      if variant_row.id is null then
        raise exception 'La variante seleccionada para % no esta activa.', detail.product_name;
      end if;

      select * into recipe_row from public.standard_recipes
        where id = variant_row.recipe_id and active = true and recipe_type = 'final_product';

      if recipe_row.id is null
        or variant_row.recipe_id is distinct from detail.recipe_id
        or variant_row.production_area_id is distinct from detail.production_area_id
        or recipe_row.production_area_id is distinct from detail.production_area_id then
        raise exception 'Producto % tiene variante, receta o area de produccion invalida.', detail.product_name;
      end if;
    else
      select * into recipe_row from public.standard_recipes
        where id = detail.recipe_id and active = true and recipe_type = 'final_product';

      if recipe_row.id is null
        or product.recipe_id is distinct from detail.recipe_id
        or product.production_area_id is distinct from detail.production_area_id
        or recipe_row.production_area_id is distinct from detail.production_area_id then
        raise exception 'Producto % tiene receta o area de produccion invalida.', detail.product_name;
      end if;
    end if;
  end loop;

  for required in
    select
      ingredient.inventory_item_id as item_id,
      max(ingredient.ingredient_name) as ingredient_name,
      max(ingredient.unit) as unit,
      order_item.production_area_id as area_id,
      max(area.name) as area_name,
      sum(ingredient.quantity * order_item.quantity) as quantity
    from public.pos_order_items order_item
    join public.standard_recipes recipe_source on recipe_source.id = order_item.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe_source.id
    join public.areas area on area.id = order_item.production_area_id
    where order_item.order_id = p_order_id
      and order_item.status = 'draft'
      and not order_item.is_test_item
    group by ingredient.inventory_item_id, order_item.production_area_id
  loop
    select quantity into stock_before from public.area_inventory
      where item_id = required.item_id and area_id = required.area_id for update;
    stock_before := coalesce(stock_before, 0);
    if stock_before < required.quantity then
      raise exception 'No hay suficiente % en %. Disponible %, requerido %.',
        required.ingredient_name, required.area_name, stock_before, required.quantity;
    end if;
  end loop;

  for area_row in
    select distinct production_area_id as area_id
    from public.pos_order_items
    where order_id = p_order_id and status = 'draft'
  loop
    insert into public.production_tickets (
      order_id, table_id, table_name, area_id, area_name, waiter_id, waiter_name, status, priority, notes
    )
    select pos_order.id::text, pos_order.table_id, coalesce(pos_order.table_name, 'Orden POS'),
      area.id, area.name, pos_order.waiter_id, pos_order.waiter_name, 'pending', 'normal', pos_order.notes
    from public.areas area
    where area.id = area_row.area_id and area.active = true and area.is_production_area = true
    returning * into ticket;
    if ticket.id is null then raise exception 'El area de produccion % no esta activa.', area_row.area_id; end if;
    ticket_ids := array_append(ticket_ids, ticket.id);

    insert into public.production_ticket_items (
      ticket_id, order_item_id, product_id, product_name, quantity, notes, modifiers, status
    )
    select ticket.id, item.id::text, item.product_id, item.product_name, item.quantity,
      item.notes, item.modifiers, 'pending'
    from public.pos_order_items item
    where item.order_id = p_order_id and item.status = 'draft'
      and item.production_area_id = area_row.area_id;

    update public.pos_order_items
    set status = 'sent_to_production', inventory_consumed = true, production_ticket_id = ticket.id
    where order_id = p_order_id and status = 'draft'
      and production_area_id = area_row.area_id;

    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      pos_order.id, 'ticket_created',
      'Ticket creado en KDS para ' || ticket.area_name || '.', auth.uid()
    );
  end loop;

  for required in
    select
      ingredient.inventory_item_id as item_id,
      max(ingredient.ingredient_name) as ingredient_name,
      max(ingredient.unit) as unit,
      order_item.production_area_id as area_id,
      sum(ingredient.quantity * order_item.quantity) as quantity
    from public.pos_order_items order_item
    join public.standard_recipes recipe_source on recipe_source.id = order_item.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe_source.id
    where order_item.order_id = p_order_id and order_item.production_ticket_id = any(ticket_ids)
    group by ingredient.inventory_item_id, order_item.production_area_id
  loop
    select quantity into stock_before from public.area_inventory
      where item_id = required.item_id and area_id = required.area_id for update;
    update public.area_inventory set quantity = stock_before - required.quantity
      where item_id = required.item_id and area_id = required.area_id;
    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    ) values (
      required.item_id, 'consumption', required.area_id, required.quantity, required.unit,
      stock_before, stock_before - required.quantity, 'pos_order', pos_order.id::text,
      'Consumo por comanda POS', auth.uid()
    );
  end loop;

  update public.pos_orders set sent_at = now()
  where id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    pos_order.id, 'sent_to_production',
    draft_count::text || ' producto(s) enviado(s) a produccion. Inventario descontado.', auth.uid()
  );

  return jsonb_build_object('order_id', pos_order.id, 'ticket_ids', to_jsonb(ticket_ids), 'items_sent', draft_count);
end;
$$;
