-- Inventory Migration Mode — skip automatic POS/recipe inventory consumption during ERP rollout
-- Apply after 130_finance_phase2_integrations.sql

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_migration_mode_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('activated', 'deactivated')),
  previous_enabled boolean not null,
  new_enabled boolean not null,
  notes text,
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now()
);

create index if not exists inventory_migration_mode_audit_changed_at_idx
  on public.inventory_migration_mode_audit (changed_at desc);

alter table public.inventory_migration_mode_audit enable row level security;

drop policy if exists inventory_migration_mode_audit_select on public.inventory_migration_mode_audit;
create policy inventory_migration_mode_audit_select on public.inventory_migration_mode_audit
  for select to authenticated
  using (public.normalize_profile_role(public.current_profile_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_inventory_migration_mode_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select nullif(value ->> 'enabled', '')::boolean
      from public.app_settings
      where key = 'inventory_migration_mode'
    ),
    false
  );
$$;

create or replace function public.inventory_migration_mode_default()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', false,
    'activated_by', null,
    'activated_at', null,
    'deactivated_by', null,
    'deactivated_at', null,
    'notes', null
  );
$$;

create or replace function public.get_inventory_migration_mode()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
  v_activated_name text;
  v_deactivated_name text;
begin
  select value into v_value
  from public.app_settings
  where key = 'inventory_migration_mode';

  v_value := coalesce(v_value, public.inventory_migration_mode_default());

  select coalesce(p.full_name, p.username, 'Administrador')
  into v_activated_name
  from public.profiles p
  where p.id = nullif(v_value ->> 'activated_by', '')::uuid;

  select coalesce(p.full_name, p.username, 'Administrador')
  into v_deactivated_name
  from public.profiles p
  where p.id = nullif(v_value ->> 'deactivated_by', '')::uuid;

  return v_value
    || jsonb_build_object(
      'activated_by_name', v_activated_name,
      'deactivated_by_name', v_deactivated_name
    );
end;
$$;

create or replace function public.set_inventory_migration_mode(
  p_enabled boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current jsonb := public.get_inventory_migration_mode();
  v_was_enabled boolean := coalesce((v_current ->> 'enabled')::boolean, false);
  v_next jsonb;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  if public.normalize_profile_role(public.current_profile_role()) <> 'admin' then
    raise exception 'No tiene permisos para modificar el Modo Migración. Solo un Administrador del sistema puede realizar esta acción.';
  end if;

  if v_was_enabled = coalesce(p_enabled, false) then
    return public.get_inventory_migration_mode();
  end if;

  if coalesce(p_enabled, false) then
    v_next := jsonb_build_object(
      'enabled', true,
      'activated_by', auth.uid(),
      'activated_at', now(),
      'deactivated_by', null,
      'deactivated_at', null,
      'notes', v_notes
    );
  else
    v_next := jsonb_build_object(
      'enabled', false,
      'activated_by', v_current -> 'activated_by',
      'activated_at', v_current -> 'activated_at',
      'deactivated_by', auth.uid(),
      'deactivated_at', now(),
      'notes', v_notes
    );
  end if;

  insert into public.app_settings (key, value, updated_by)
  values ('inventory_migration_mode', v_next, auth.uid())
  on conflict (key) do update
  set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

  insert into public.inventory_migration_mode_audit (
    action, previous_enabled, new_enabled, notes, changed_by
  )
  values (
    case when coalesce(p_enabled, false) then 'activated' else 'deactivated' end,
    v_was_enabled,
    coalesce(p_enabled, false),
    v_notes,
    auth.uid()
  );

  return public.get_inventory_migration_mode();
end;
$$;

create or replace function public.protect_inventory_migration_mode_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key <> 'inventory_migration_mode' then
    return new;
  end if;

  -- SQL Editor / migraciones: auth.uid() es null; permitir bootstrap inicial.
  if auth.uid() is null then
    return new;
  end if;

  if public.normalize_profile_role(public.current_profile_role()) <> 'admin' then
    raise exception 'No tiene permisos para modificar el Modo Migración. Solo un Administrador del sistema puede realizar esta acción.';
  end if;
  return new;
end;
$$;

insert into public.app_settings (key, value)
values ('inventory_migration_mode', public.inventory_migration_mode_default())
on conflict (key) do nothing;

drop trigger if exists protect_inventory_migration_mode_setting_trg on public.app_settings;
create trigger protect_inventory_migration_mode_setting_trg
  before insert or update on public.app_settings
  for each row execute function public.protect_inventory_migration_mode_setting();

-- ---------------------------------------------------------------------------
-- POS production send — skip stock validation & consumption when migration mode
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
  v_migration_mode boolean := public.is_inventory_migration_mode_active();
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

  if not v_migration_mode then
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
  end if;

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
    set status = 'sent_to_production',
        inventory_consumed = case when v_migration_mode then false else true end,
        production_ticket_id = ticket.id
    where order_id = p_order_id and status = 'draft'
      and production_area_id = area_row.area_id;

    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      pos_order.id, 'ticket_created',
      'Ticket creado en KDS para ' || ticket.area_name || '.', auth.uid()
    );
  end loop;

  if not v_migration_mode then
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
  else
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      pos_order.id,
      'migration_mode_skip',
      'Consumo de inventario omitido — Modo Migración activo.',
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
      || case when v_migration_mode then ' Inventario no descontado (Modo Migración).' else ' Inventario descontado.' end,
    auth.uid()
  );

  return jsonb_build_object(
    'order_id', pos_order.id,
    'ticket_ids', to_jsonb(ticket_ids),
    'items_sent', draft_count,
    'migration_mode_active', v_migration_mode,
    'inventory_consumed', not v_migration_mode
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
begin
  if public.is_inventory_migration_mode_active() then
    return jsonb_build_object(
      'consumed', false,
      'skipped', true,
      'reason', 'inventory_migration_mode',
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.is_inventory_migration_mode_active() from public;
revoke all on function public.get_inventory_migration_mode() from public;
revoke all on function public.set_inventory_migration_mode(boolean, text) from public;

grant execute on function public.is_inventory_migration_mode_active() to authenticated;
grant execute on function public.get_inventory_migration_mode() to authenticated;
grant execute on function public.set_inventory_migration_mode(boolean, text) to authenticated;

grant select on public.inventory_migration_mode_audit to authenticated;
