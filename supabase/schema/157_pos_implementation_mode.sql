-- POS/KDS implementation mode — optional inventory deduction per product
-- Apply after 156_bakery_production_center.sql

-- ---------------------------------------------------------------------------
-- Product fields
-- ---------------------------------------------------------------------------

alter table public.pos_products
  add column if not exists inventory_tracking_enabled boolean not null default false,
  add column if not exists recipe_required_for_sale boolean not null default false,
  add column if not exists recipe_status text not null default 'missing';

alter table public.pos_products
  drop constraint if exists pos_products_recipe_status_check;

alter table public.pos_products
  add constraint pos_products_recipe_status_check
  check (recipe_status in ('missing', 'draft', 'active', 'paused'));

create index if not exists pos_products_implementation_idx
  on public.pos_products (active, recipe_status, inventory_tracking_enabled);

-- ---------------------------------------------------------------------------
-- Audit: skipped inventory deductions
-- ---------------------------------------------------------------------------

create table if not exists public.pos_inventory_deduction_skips (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.pos_orders(id) on delete set null,
  order_item_id uuid references public.pos_order_items(id) on delete set null,
  product_id uuid references public.pos_products(id) on delete set null,
  product_name text,
  reason text not null check (reason in (
    'inventory_disabled',
    'missing_recipe',
    'recipe_not_active',
    'recipe_incomplete',
    'tracking_disabled',
    'test_item',
    'migration_mode'
  )),
  created_at timestamptz not null default now()
);

create index if not exists pos_inventory_deduction_skips_created_at_idx
  on public.pos_inventory_deduction_skips (created_at desc);

create index if not exists pos_inventory_deduction_skips_order_idx
  on public.pos_inventory_deduction_skips (order_id);

alter table public.pos_inventory_deduction_skips enable row level security;

drop policy if exists pos_inventory_deduction_skips_select on public.pos_inventory_deduction_skips;
create policy pos_inventory_deduction_skips_select on public.pos_inventory_deduction_skips
  for select to authenticated
  using (public.is_profile_manager());

-- ---------------------------------------------------------------------------
-- Global setting: inventory_deduction_mode
-- ---------------------------------------------------------------------------

create or replace function public.inventory_deduction_mode_default()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', 'active_recipes_only',
    'updated_by', null,
    'updated_at', null,
    'notes', null
  );
$$;

create or replace function public.get_inventory_deduction_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(
      (select value ->> 'mode' from public.app_settings where key = 'inventory_deduction_mode'),
      ''
    ),
    case
      when public.is_inventory_migration_mode_active() then 'disabled'
      else 'active_recipes_only'
    end
  );
$$;

create or replace function public.get_inventory_deduction_mode_setting()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
  v_updated_name text;
begin
  select value into v_value
  from public.app_settings
  where key = 'inventory_deduction_mode';

  v_value := coalesce(v_value, public.inventory_deduction_mode_default());
  v_value := v_value || jsonb_build_object('mode', public.get_inventory_deduction_mode());

  select coalesce(p.full_name, p.username, 'Administrador')
  into v_updated_name
  from public.profiles p
  where p.id = nullif(v_value ->> 'updated_by', '')::uuid;

  return v_value || jsonb_build_object('updated_by_name', v_updated_name);
end;
$$;

create or replace function public.set_inventory_deduction_mode(
  p_mode text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := lower(trim(coalesce(p_mode, '')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  if public.normalize_profile_role(public.current_profile_role()) <> 'admin' then
    raise exception 'No tiene permisos para modificar el modo de descarga de inventario.';
  end if;

  if v_mode not in ('disabled', 'active_recipes_only', 'strict') then
    raise exception 'Modo de descarga invalido: %. Valores: disabled, active_recipes_only, strict.', v_mode;
  end if;

  insert into public.app_settings (key, value, updated_by)
  values (
    'inventory_deduction_mode',
    jsonb_build_object(
      'mode', v_mode,
      'updated_by', auth.uid(),
      'updated_at', now(),
      'notes', v_notes
    ),
    auth.uid()
  )
  on conflict (key) do update
  set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

  return public.get_inventory_deduction_mode_setting();
end;
$$;

insert into public.app_settings (key, value)
select
  'inventory_deduction_mode',
  jsonb_build_object(
    'mode',
    case
      when coalesce(
        (select nullif(value ->> 'enabled', '')::boolean from public.app_settings where key = 'inventory_migration_mode'),
        false
      ) then 'disabled'
      else 'active_recipes_only'
    end,
    'updated_by', null,
    'updated_at', null,
    'notes', 'Inicializado por migracion 157'
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Recipe status sync
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

create or replace function public.sync_pos_product_implementation_fields(p_product_id uuid)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.pos_products;
  v_status text;
begin
  v_status := public.compute_pos_product_recipe_status(p_product_id);

  update public.pos_products
  set recipe_status = v_status,
      updated_at = now()
  where id = p_product_id
  returning * into saved;

  return saved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory deduction evaluation
-- ---------------------------------------------------------------------------

create or replace function public.evaluate_pos_inventory_deduction(
  p_product public.pos_products,
  p_order_item public.pos_order_items
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text := public.get_inventory_deduction_mode();
  v_recipe public.standard_recipes;
  v_ingredient_count integer := 0;
begin
  if coalesce(p_order_item.is_test_item, false) then
    return jsonb_build_object('deduct', false, 'reason', 'test_item');
  end if;

  if public.is_inventory_migration_mode_active() and v_mode = 'active_recipes_only' then
    v_mode := 'disabled';
  end if;

  if v_mode = 'disabled' then
    return jsonb_build_object('deduct', false, 'reason', 'inventory_disabled');
  end if;

  if v_mode = 'strict' then
    if p_order_item.recipe_id is null then
      return jsonb_build_object('deduct', false, 'reason', 'missing_recipe');
    end if;
    return jsonb_build_object('deduct', true, 'reason', null);
  end if;

  if not coalesce(p_product.inventory_tracking_enabled, false) then
    return jsonb_build_object('deduct', false, 'reason', 'tracking_disabled');
  end if;

  if coalesce(p_product.recipe_status, 'missing') <> 'active' then
    return jsonb_build_object(
      'deduct', false,
      'reason', case coalesce(p_product.recipe_status, 'missing')
        when 'missing' then 'missing_recipe'
        else 'recipe_not_active'
      end
    );
  end if;

  if p_order_item.recipe_id is null then
    return jsonb_build_object('deduct', false, 'reason', 'missing_recipe');
  end if;

  select * into v_recipe
  from public.standard_recipes
  where id = p_order_item.recipe_id
    and active = true
    and recipe_type = 'final_product';

  if v_recipe.id is null then
    return jsonb_build_object('deduct', false, 'reason', 'recipe_not_active');
  end if;

  select count(*) into v_ingredient_count
  from public.recipe_ingredients
  where recipe_id = v_recipe.id;

  if v_ingredient_count = 0 then
    return jsonb_build_object('deduct', false, 'reason', 'recipe_incomplete');
  end if;

  return jsonb_build_object('deduct', true, 'reason', null);
end;
$$;

create or replace function public.log_pos_inventory_deduction_skip(
  p_order_id uuid,
  p_order_item_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    return;
  end if;

  insert into public.pos_inventory_deduction_skips (
    order_id, order_item_id, product_id, product_name, reason
  ) values (
    p_order_id,
    p_order_item_id,
    p_product_id,
    p_product_name,
    p_reason
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Product readiness — allow sales without recipe in implementation modes
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
  v_mode text := public.get_inventory_deduction_mode();
  v_implementation boolean := v_mode <> 'strict';
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

    if not has_valid_variant and v_implementation and not saved.recipe_required_for_sale then
      has_valid_variant := exists (
        select 1
        from public.pos_product_variants variant
        where variant.product_id = saved.id
          and variant.is_active = true
          and variant.price > 0
      );
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

create or replace function public.validate_pos_product_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  area public.areas;
  v_mode text := public.get_inventory_deduction_mode();
  v_implementation boolean := v_mode <> 'strict';
begin
  new.updated_at := now();
  new.production_ready := false;

  if not new.active then
    new.recipe_status := public.compute_pos_product_recipe_status(new.id);
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
    new.recipe_status := 'missing';
    return new;
  end if;

  if new.product_type = 'pizza' then
    new.recipe_id := null;
    if new.id is not null then
      new.recipe_status := coalesce(public.compute_pos_product_recipe_status(new.id), 'missing');
    else
      new.recipe_status := 'missing';
    end if;
    return new;
  end if;

  if v_implementation and not new.recipe_required_for_sale then
    new.production_ready := true;
    if new.id is not null then
      new.recipe_status := coalesce(public.compute_pos_product_recipe_status(new.id), 'missing');
    elsif new.recipe_id is null then
      new.recipe_status := 'missing';
    else
      select case
        when not recipe.active then 'paused'
        when not exists (select 1 from public.recipe_ingredients ri where ri.recipe_id = recipe.id) then 'draft'
        else 'active'
      end
      into new.recipe_status
      from public.standard_recipes recipe
      where recipe.id = new.recipe_id
        and recipe.recipe_type = 'final_product';
      new.recipe_status := coalesce(new.recipe_status, 'missing');
    end if;
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
  new.recipe_status := 'active';
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- send_pos_order_to_production — wrap inventory with deduction mode
-- ---------------------------------------------------------------------------

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
  v_mode text := public.get_inventory_deduction_mode();
  v_strict boolean := v_mode = 'strict';
  v_eval jsonb;
  v_skip_reason text;
  skipped_count integer := 0;
  deducted_count integer := 0;
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
    if v_strict then
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
    else
      select * into product from public.pos_products
        where id = detail.product_id and active = true;

      if product.id is null then
        raise exception 'Producto % no esta activo.', detail.product_name;
      end if;

      if detail.production_area_id is null then
        raise exception 'Producto % no tiene area KDS configurada.', detail.product_name;
      end if;

      if not exists (
        select 1 from public.areas
        where id = detail.production_area_id
          and active = true
          and is_production_area = true
      ) then
        raise exception 'El area KDS de % no esta activa.', detail.product_name;
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
    join public.pos_products product on product.id = order_item.product_id
    join public.standard_recipes recipe_source on recipe_source.id = order_item.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe_source.id
    join public.areas area on area.id = order_item.production_area_id
    where order_item.order_id = p_order_id
      and order_item.status = 'draft'
      and not order_item.is_test_item
      and order_item.recipe_id is not null
      and (public.evaluate_pos_inventory_deduction(product, order_item) ->> 'deduct')::boolean = true
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

    for detail in
      select item.*
      from public.pos_order_items item
      where item.order_id = p_order_id
        and item.status = 'draft'
        and item.production_area_id = area_row.area_id
    loop
      select * into product from public.pos_products where id = detail.product_id;
      v_eval := public.evaluate_pos_inventory_deduction(product, detail);
      v_skip_reason := nullif(v_eval ->> 'reason', '');

      update public.pos_order_items
      set status = 'sent_to_production',
          inventory_consumed = coalesce((v_eval ->> 'deduct')::boolean, false),
          production_ticket_id = ticket.id
      where id = detail.id;

      if coalesce((v_eval ->> 'deduct')::boolean, false) then
        deducted_count := deducted_count + 1;
      else
        skipped_count := skipped_count + 1;
        if v_skip_reason is not null and v_skip_reason <> 'test_item' then
          perform public.log_pos_inventory_deduction_skip(
            pos_order.id, detail.id, detail.product_id, detail.product_name, v_skip_reason
          );
        end if;
      end if;
    end loop;

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
    join public.pos_products product on product.id = order_item.product_id
    join public.standard_recipes recipe_source on recipe_source.id = order_item.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe_source.id
    where order_item.order_id = p_order_id
      and order_item.production_ticket_id = any(ticket_ids)
      and not order_item.is_test_item
      and order_item.recipe_id is not null
      and (public.evaluate_pos_inventory_deduction(product, order_item) ->> 'deduct')::boolean = true
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

  if skipped_count > 0 then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      pos_order.id,
      'inventory_deduction_skipped',
      skipped_count::text || ' linea(s) omitieron descarga de inventario (modo implementacion).',
      auth.uid()
    );
  end if;

  update public.pos_orders set sent_at = now()
  where id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    pos_order.id,
    'sent_to_production',
    draft_count::text || ' producto(s) enviado(s) a produccion.'
      || case
        when deducted_count > 0 and skipped_count > 0 then
          ' Inventario descontado en ' || deducted_count::text || ' linea(s); omitido en ' || skipped_count::text || '.'
        when deducted_count > 0 then ' Inventario descontado.'
        else ' Sin descarga de inventario (modo implementacion).'
      end,
    auth.uid()
  );

  return jsonb_build_object(
    'order_id', pos_order.id,
    'ticket_ids', to_jsonb(ticket_ids),
    'items_sent', draft_count,
    'inventory_deducted_count', deducted_count,
    'inventory_skipped_count', skipped_count,
    'deduction_mode', v_mode,
    'inventory_consumed', deducted_count > 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Legacy per-line consumption RPC
-- ---------------------------------------------------------------------------

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
  v_eval jsonb;
  v_order_item public.pos_order_items;
begin
  select * into v_order_item
  from public.pos_order_items
  where id::text = trim(p_order_item_id);

  select * into product
  from public.pos_products
  where id::text = trim(p_pos_product_id)
    and active = true;

  if product.id is null then
    raise exception 'Este producto POS no está activo.';
  end if;

  if v_order_item.id is not null then
    v_eval := public.evaluate_pos_inventory_deduction(product, v_order_item);
  elsif public.get_inventory_deduction_mode() = 'disabled'
    or public.is_inventory_migration_mode_active() then
    v_eval := jsonb_build_object('deduct', false, 'reason', 'inventory_disabled');
  elsif not coalesce(product.inventory_tracking_enabled, false) then
    v_eval := jsonb_build_object('deduct', false, 'reason', 'tracking_disabled');
  elsif coalesce(product.recipe_status, 'missing') <> 'active' then
    v_eval := jsonb_build_object('deduct', false, 'reason', 'missing_recipe');
  else
    v_eval := jsonb_build_object('deduct', true, 'reason', null);
  end if;

  if not coalesce((v_eval ->> 'deduct')::boolean, false) then
    return jsonb_build_object(
      'consumed', false,
      'skipped', true,
      'reason', coalesce(v_eval ->> 'reason', 'inventory_disabled'),
      'order_item_id', trim(p_order_item_id)
    );
  end if;

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

-- ---------------------------------------------------------------------------
-- Implementation dashboard RPC
-- ---------------------------------------------------------------------------

create or replace function public.get_pos_implementation_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_active_recipe integer := 0;
  v_tracking integer := 0;
  v_pending integer := 0;
  v_sold_no_recipe jsonb := '[]'::jsonb;
  v_sold_no_tracking jsonb := '[]'::jsonb;
begin
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para ver el panel de implementacion POS.';
  end if;

  select count(*) into v_total from public.pos_products where active = true;
  select count(*) into v_active_recipe from public.pos_products where active = true and recipe_status = 'active';
  select count(*) into v_tracking from public.pos_products where active = true and inventory_tracking_enabled = true;
  select count(*) into v_pending from public.pos_products where active = true and recipe_status in ('missing', 'draft');

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_sold_no_recipe
  from (
    select
      item.product_id,
      max(item.product_name) as product_name,
      sum(item.quantity) as units_sold,
      count(distinct item.order_id) as order_count
    from public.pos_order_items item
    join public.pos_orders ord on ord.id = item.order_id
    join public.pos_products product on product.id = item.product_id
    where ord.created_at >= now() - interval '30 days'
      and item.status not in ('draft', 'cancelled')
      and coalesce(product.recipe_status, 'missing') <> 'active'
    group by item.product_id
    order by units_sold desc
    limit 25
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_sold_no_tracking
  from (
    select
      item.product_id,
      max(item.product_name) as product_name,
      sum(item.quantity) as units_sold,
      count(distinct item.order_id) as order_count
    from public.pos_order_items item
    join public.pos_orders ord on ord.id = item.order_id
    join public.pos_products product on product.id = item.product_id
    where ord.created_at >= now() - interval '30 days'
      and item.status not in ('draft', 'cancelled')
      and coalesce(product.inventory_tracking_enabled, false) = false
    group by item.product_id
    order by units_sold desc
    limit 25
  ) t;

  return jsonb_build_object(
    'deduction_mode', public.get_inventory_deduction_mode(),
    'total_pos_products', v_total,
    'products_with_active_recipe', v_active_recipe,
    'products_with_inventory_tracking', v_tracking,
    'products_pending_recipe', v_pending,
    'implementation_percent', case when v_total = 0 then 0 else round((v_active_recipe::numeric / v_total) * 100, 1) end,
    'sold_last_30_days_without_active_recipe', v_sold_no_recipe,
    'sold_last_30_days_without_inventory_tracking', v_sold_no_tracking
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog save — optional recipe outside strict mode
-- ---------------------------------------------------------------------------

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
  v_mode text := public.get_inventory_deduction_mode();
  v_recipe_required boolean := coalesce((p_product ->> 'recipe_required_for_sale')::boolean, false);
  v_tracking boolean := coalesce((p_product ->> 'inventory_tracking_enabled')::boolean, false);
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
    if v_recipe_id is null and (v_mode = 'strict' or v_recipe_required) then
      raise exception 'El producto necesita una receta conectada.';
    end if;

    if v_recipe_id is not null then
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
  end if;

  if p_product_id is null then
    insert into public.pos_products (
      name, description, price, image_url, category_id, category_name,
      recipe_id, production_area_id, active, is_test_item, product_type,
      allow_kitchen_notes, prep_time_minutes, sort_order,
      inventory_tracking_enabled, recipe_required_for_sale, created_by
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
      v_tracking,
      v_recipe_required,
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
      sort_order = coalesce((p_product ->> 'sort_order')::integer, 0),
      inventory_tracking_enabled = v_tracking,
      recipe_required_for_sale = v_recipe_required
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

-- Backfill recipe_status for existing products
update public.pos_products p
set recipe_status = public.compute_pos_product_recipe_status(p.id)
where true;

-- Refresh production_ready under implementation mode
do $$
declare
  v_product record;
begin
  for v_product in select id from public.pos_products where active = true
  loop
    perform public.refresh_pos_product_catalog_state(v_product.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.get_inventory_deduction_mode() from public;
revoke all on function public.get_inventory_deduction_mode_setting() from public;
revoke all on function public.set_inventory_deduction_mode(text, text) from public;
revoke all on function public.get_pos_implementation_dashboard() from public;
revoke all on function public.compute_pos_product_recipe_status(uuid) from public;

grant execute on function public.get_inventory_deduction_mode() to authenticated;
grant execute on function public.get_inventory_deduction_mode_setting() to authenticated;
grant execute on function public.set_inventory_deduction_mode(text, text) to authenticated;
grant execute on function public.get_pos_implementation_dashboard() to authenticated;
grant execute on function public.compute_pos_product_recipe_status(uuid) to authenticated;

grant select on public.pos_inventory_deduction_skips to authenticated;
