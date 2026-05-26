-- Official POS orders and transactional production dispatch.
-- Apply after 009_production_tickets.sql.

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  table_id text,
  table_name text,
  area_id text,
  area_name text,
  waiter_id uuid references public.profiles(id),
  waiter_name text,
  status text not null default 'open'
    check (status in ('open', 'sent', 'awaiting_bill', 'sent_to_cashier', 'paid', 'cancelled')),
  subtotal numeric not null default 0 check (subtotal >= 0),
  total numeric not null default 0 check (total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  paid_at timestamptz
);

create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  product_id uuid not null references public.pos_products(id),
  product_name text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  total_price numeric not null default 0 check (total_price >= 0),
  recipe_id uuid references public.standard_recipes(id),
  production_area_id text references public.areas(id),
  production_ready boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'sent_to_production', 'in_production', 'ready', 'served', 'cancelled', 'error')),
  inventory_consumed boolean not null default false,
  production_ticket_id uuid references public.production_tickets(id),
  notes text,
  modifiers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pos_order_items
  drop constraint if exists pos_order_items_status_check;
alter table public.pos_order_items
  add constraint pos_order_items_status_check
  check (status in ('draft', 'sent_to_production', 'in_production', 'ready', 'served', 'cancelled', 'error'));

create table if not exists public.pos_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  event_type text not null,
  description text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists pos_orders_table_status_created_idx
  on public.pos_orders (table_id, status, created_at desc);
create index if not exists pos_order_items_order_status_idx
  on public.pos_order_items (order_id, status);
create index if not exists pos_order_events_order_created_idx
  on public.pos_order_events (order_id, created_at desc);

alter table public.pos_orders enable row level security;
alter table public.pos_order_items enable row level security;
alter table public.pos_order_events enable row level security;

grant select, insert, update on public.pos_orders to authenticated;
grant select, insert, update, delete on public.pos_order_items to authenticated;
grant select on public.pos_order_events to authenticated;
grant all on public.pos_orders, public.pos_order_items, public.pos_order_events to service_role;

create or replace function public.can_operate_pos_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('admin', 'gerente_general', 'cajero', 'mesero', 'supervisor')
  );
$$;

revoke all on function public.can_operate_pos_orders() from public;
grant execute on function public.can_operate_pos_orders() to authenticated;

drop policy if exists "pos_orders_authenticated_read" on public.pos_orders;
create policy "pos_orders_authenticated_read"
  on public.pos_orders for select to authenticated using (true);
drop policy if exists "pos_order_items_authenticated_read" on public.pos_order_items;
create policy "pos_order_items_authenticated_read"
  on public.pos_order_items for select to authenticated using (true);
drop policy if exists "pos_order_events_authenticated_read" on public.pos_order_events;
create policy "pos_order_events_authenticated_read"
  on public.pos_order_events for select to authenticated using (true);

drop policy if exists "pos_orders_operators_insert" on public.pos_orders;
create policy "pos_orders_operators_insert"
  on public.pos_orders for insert to authenticated
  with check (public.can_operate_pos_orders() and waiter_id = auth.uid());
drop policy if exists "pos_orders_operators_update" on public.pos_orders;
create policy "pos_orders_operators_update"
  on public.pos_orders for update to authenticated
  using (public.can_operate_pos_orders())
  with check (public.can_operate_pos_orders());

drop policy if exists "pos_order_items_operators_insert" on public.pos_order_items;
create policy "pos_order_items_operators_insert"
  on public.pos_order_items for insert to authenticated
  with check (public.can_operate_pos_orders());
drop policy if exists "pos_order_items_operators_update" on public.pos_order_items;
create policy "pos_order_items_operators_update"
  on public.pos_order_items for update to authenticated
  using (public.can_operate_pos_orders())
  with check (public.can_operate_pos_orders());
drop policy if exists "pos_order_items_operators_delete" on public.pos_order_items;
create policy "pos_order_items_operators_delete"
  on public.pos_order_items for delete to authenticated
  using (public.can_operate_pos_orders() and status = 'draft');

create or replace function public.set_pos_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_pos_order_updated_at on public.pos_orders;
create trigger set_pos_order_updated_at
  before update on public.pos_orders
  for each row execute procedure public.set_pos_order_updated_at();
drop trigger if exists set_pos_order_item_updated_at on public.pos_order_items;
create trigger set_pos_order_item_updated_at
  before update on public.pos_order_items
  for each row execute procedure public.set_pos_order_updated_at();

create or replace function public.refresh_pos_order_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order_id uuid;
begin
  if tg_op = 'DELETE' then
    target_order_id := old.order_id;
  else
    target_order_id := new.order_id;
  end if;
  update public.pos_orders
  set subtotal = coalesce((
        select sum(total_price) from public.pos_order_items
        where order_id = target_order_id and status <> 'cancelled'
      ), 0),
      total = coalesce((
        select sum(total_price) from public.pos_order_items
        where order_id = target_order_id and status <> 'cancelled'
      ), 0)
  where id = target_order_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_pos_order_totals on public.pos_order_items;
create trigger refresh_pos_order_totals
  after insert or update or delete on public.pos_order_items
  for each row execute procedure public.refresh_pos_order_totals();

create or replace function public.audit_pos_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'pos_orders' then
    if tg_op = 'INSERT' then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (new.id, 'order_created', 'Orden creada para ' || coalesce(new.table_name, 'mesa'), auth.uid());
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (
        new.id, 'order_' || new.status,
        'Estado de la orden actualizado a ' || new.status || '.', auth.uid()
      );
    end if;
    return new;
  end if;

  if tg_table_name = 'pos_order_items' then
    if tg_op = 'INSERT' then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (new.order_id, 'item_added', new.product_name || ' agregado a la orden.', auth.uid());
      return new;
    elsif tg_op = 'UPDATE' then
      if new.quantity is distinct from old.quantity then
        insert into public.pos_order_events (order_id, event_type, description, created_by)
        values (
          new.order_id, 'item_updated',
          new.product_name || ': cantidad actualizada a ' || new.quantity::text || '.',
          auth.uid()
        );
      elsif new.notes is distinct from old.notes then
        insert into public.pos_order_events (order_id, event_type, description, created_by)
        values (new.order_id, 'item_updated', new.product_name || ': notas actualizadas.', auth.uid());
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (old.order_id, 'item_removed', old.product_name || ' eliminado de productos nuevos.', auth.uid());
      return old;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_pos_order_created on public.pos_orders;
create trigger audit_pos_order_created
  after insert or update on public.pos_orders
  for each row execute procedure public.audit_pos_order_change();
drop trigger if exists audit_pos_order_item_changed on public.pos_order_items;
create trigger audit_pos_order_item_changed
  after insert or update or delete on public.pos_order_items
  for each row execute procedure public.audit_pos_order_change();

create or replace function public.record_pos_order_event(
  p_order_id uuid,
  p_event_type text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para registrar eventos POS.';
  end if;
  if not exists (select 1 from public.pos_orders where id = p_order_id) then
    raise exception 'La orden POS no existe.';
  end if;
  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (p_order_id, trim(p_event_type), trim(p_description), auth.uid());
end;
$$;

create or replace function public.clear_pos_order_draft_items(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para limpiar esta orden.';
  end if;
  if exists (
    select 1 from public.pos_order_items
    where order_id = p_order_id and status <> 'draft' and status <> 'cancelled'
  ) then
    raise exception 'Esta orden ya tiene productos enviados. Para cancelar debes solicitar autorizacion.';
  end if;
  delete from public.pos_order_items where order_id = p_order_id and status = 'draft';
  get diagnostics removed_count = row_count;
  if removed_count > 0 then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (p_order_id, 'draft_cleared', 'Se limpiaron los productos nuevos de la orden.', auth.uid());
  end if;
  return removed_count;
end;
$$;

create or replace function public.cancel_pos_order_draft_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled public.pos_order_items;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para cancelar productos.';
  end if;
  update public.pos_order_items
  set status = 'cancelled'
  where id = p_item_id and status = 'draft'
  returning * into cancelled;
  if cancelled.id is null then
    raise exception 'Solo pueden cancelarse directamente productos nuevos.';
  end if;
  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (cancelled.order_id, 'item_cancelled', cancelled.product_name || ' cancelado.', auth.uid());
end;
$$;

create or replace function public.sync_pos_item_from_ticket_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_item public.pos_order_items;
  next_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  next_status := case new.status
    when 'in_production' then 'in_production'
    when 'ready' then 'ready'
    when 'served' then 'served'
    when 'cancelled' then 'cancelled'
    when 'problem' then 'error'
    else null
  end;
  if next_status is null then
    return new;
  end if;
  update public.pos_order_items
  set status = next_status
  where id::text = new.order_item_id and production_ticket_id = new.ticket_id
  returning * into order_item;
  if order_item.id is not null then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      order_item.order_id,
      'production_' || next_status,
      order_item.product_name || ': estado de produccion actualizado a ' || next_status || '.',
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sync_pos_item_from_ticket_item on public.production_ticket_items;
create trigger sync_pos_item_from_ticket_item
  after update of status on public.production_ticket_items
  for each row execute procedure public.sync_pos_item_from_ticket_item();

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
  required record;
  area_row record;
  ticket public.production_tickets;
  stock_before numeric;
  ticket_ids uuid[] := '{}'::uuid[];
  draft_count integer;
begin
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para enviar órdenes POS.';
  end if;

  select * into pos_order from public.pos_orders where id = p_order_id for update;
  if pos_order.id is null then raise exception 'La orden POS no existe.'; end if;
  if pos_order.status <> 'open' then raise exception 'Solo una orden abierta puede enviarse a producción.'; end if;

  select count(*) into draft_count from public.pos_order_items
  where order_id = p_order_id and status = 'draft';
  if draft_count = 0 then raise exception 'No hay productos nuevos para enviar.'; end if;

  for detail in select * from public.pos_order_items where order_id = p_order_id and status = 'draft'
  loop
    if detail.product_id is null or detail.recipe_id is null or detail.production_area_id is null or not detail.production_ready then
      raise exception 'Producto % no está listo para producción.', detail.product_name;
    end if;
    select * into product from public.pos_products
      where id = detail.product_id and active = true and production_ready = true;
    select * into recipe_row from public.standard_recipes
      where id = detail.recipe_id and active = true and recipe_type = 'final_product';
    if product.id is null or recipe_row.id is null
      or product.recipe_id is distinct from detail.recipe_id
      or product.production_area_id is distinct from detail.production_area_id
      or recipe_row.production_area_id is distinct from detail.production_area_id then
      raise exception 'Producto % tiene receta o área de producción inválida.', detail.product_name;
    end if;
  end loop;

  -- Lock and validate aggregated ingredient demand before changing any stock.
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
    where order_item.order_id = p_order_id and order_item.status = 'draft'
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
    if ticket.id is null then raise exception 'El área de producción % no está activa.', area_row.area_id; end if;
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

revoke all on function public.record_pos_order_event(uuid, text, text) from public;
revoke all on function public.clear_pos_order_draft_items(uuid) from public;
revoke all on function public.cancel_pos_order_draft_item(uuid) from public;
revoke all on function public.send_pos_order_to_production(uuid) from public;
grant execute on function public.record_pos_order_event(uuid, text, text) to authenticated;
grant execute on function public.clear_pos_order_draft_items(uuid) to authenticated;
grant execute on function public.cancel_pos_order_draft_item(uuid) to authenticated;
grant execute on function public.send_pos_order_to_production(uuid) to authenticated;
