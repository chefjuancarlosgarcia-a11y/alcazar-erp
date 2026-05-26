-- Inventory foundation: catalog, stock per operational area and kardex.
-- Apply after 003_areas.sql.

create extension if not exists pgcrypto;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text,
  purchase_unit text,
  base_unit text not null,
  conversion_factor numeric not null default 1 check (conversion_factor > 0),
  cost_per_base_unit numeric not null default 0 check (cost_per_base_unit >= 0),
  supplier text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.area_inventory (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  area_id text not null references public.areas(id),
  quantity numeric not null default 0 check (quantity >= 0),
  minimum_quantity numeric not null default 0 check (minimum_quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (item_id, area_id)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  movement_type text not null
    check (movement_type in ('purchase', 'transfer', 'consumption', 'adjustment', 'reversal', 'waste')),
  from_area_id text references public.areas(id),
  to_area_id text references public.areas(id),
  quantity numeric not null check (quantity >= 0),
  unit text not null,
  previous_quantity numeric,
  new_quantity numeric,
  source_type text,
  source_id text,
  notes text,
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.inventory_items enable row level security;
alter table public.area_inventory enable row level security;
alter table public.inventory_movements enable row level security;

grant select, insert, update on public.inventory_items to authenticated;
grant select, insert, update on public.area_inventory to authenticated;
grant select, insert on public.inventory_movements to authenticated;
grant all on public.inventory_items, public.area_inventory, public.inventory_movements to service_role;

drop policy if exists "inventory_items_read_active" on public.inventory_items;
create policy "inventory_items_read_active"
  on public.inventory_items for select to authenticated
  using (active = true);

drop policy if exists "inventory_items_managers_read_all" on public.inventory_items;
create policy "inventory_items_managers_read_all"
  on public.inventory_items for select to authenticated
  using (public.is_profile_manager());

drop policy if exists "inventory_items_managers_insert" on public.inventory_items;
create policy "inventory_items_managers_insert"
  on public.inventory_items for insert to authenticated
  with check (public.is_profile_manager());

drop policy if exists "inventory_items_managers_update" on public.inventory_items;
create policy "inventory_items_managers_update"
  on public.inventory_items for update to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

-- Internal testing phase: authenticated staff may inspect stock in all areas.
-- TODO: include encargado_almacen when that role is added to profiles.
drop policy if exists "area_inventory_authenticated_read" on public.area_inventory;
create policy "area_inventory_authenticated_read"
  on public.area_inventory for select to authenticated
  using (true);

drop policy if exists "area_inventory_managers_insert" on public.area_inventory;
create policy "area_inventory_managers_insert"
  on public.area_inventory for insert to authenticated
  with check (public.is_profile_manager());

drop policy if exists "area_inventory_managers_update" on public.area_inventory;
create policy "area_inventory_managers_update"
  on public.area_inventory for update to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "inventory_movements_authenticated_read" on public.inventory_movements;
create policy "inventory_movements_authenticated_read"
  on public.inventory_movements for select to authenticated
  using (true);

drop policy if exists "inventory_movements_managers_insert" on public.inventory_movements;
create policy "inventory_movements_managers_insert"
  on public.inventory_movements for insert to authenticated
  with check (public.is_profile_manager());

create or replace function public.set_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
  before update on public.inventory_items
  for each row execute procedure public.set_inventory_updated_at();

drop trigger if exists set_area_inventory_updated_at on public.area_inventory;
create trigger set_area_inventory_updated_at
  before update on public.area_inventory
  for each row execute procedure public.set_inventory_updated_at();

create or replace function public.adjust_area_inventory(
  p_item_id uuid,
  p_area_id text,
  p_quantity numeric,
  p_minimum_quantity numeric,
  p_unit text,
  p_notes text
)
returns public.area_inventory
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_value numeric;
  adjusted public.area_inventory;
begin
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para ajustar inventario.';
  end if;
  if p_quantity < 0 or p_minimum_quantity < 0 then
    raise exception 'Las cantidades no pueden ser negativas.';
  end if;

  insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
  values (p_item_id, p_area_id, 0, 0)
  on conflict (item_id, area_id) do nothing;

  select quantity into previous_value
  from public.area_inventory
  where item_id = p_item_id and area_id = p_area_id
  for update;

  if previous_value is distinct from p_quantity and nullif(trim(p_notes), '') is null then
    raise exception 'El motivo es obligatorio para ajustar existencias.';
  end if;

  update public.area_inventory
  set quantity = p_quantity, minimum_quantity = p_minimum_quantity
  where item_id = p_item_id and area_id = p_area_id
  returning * into adjusted;

  if previous_value is distinct from p_quantity then
    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, notes, performed_by
    )
    values (
      p_item_id, 'adjustment', p_area_id, abs(p_quantity - previous_value),
      p_unit, previous_value, p_quantity, 'manual_adjustment', p_notes, auth.uid()
    );
  end if;

  return adjusted;
end;
$$;

revoke all on function public.adjust_area_inventory(uuid, text, numeric, numeric, text, text) from public;
grant execute on function public.adjust_area_inventory(uuid, text, numeric, numeric, text, text) to authenticated;

create or replace function public.import_area_inventory_stock(
  p_item_id uuid,
  p_area_id text,
  p_quantity numeric,
  p_minimum_quantity numeric,
  p_unit text
)
returns public.area_inventory
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_value numeric;
  imported public.area_inventory;
begin
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para importar inventario.';
  end if;
  if p_quantity < 0 or p_minimum_quantity < 0 then
    raise exception 'Las cantidades no pueden ser negativas.';
  end if;

  insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
  values (p_item_id, p_area_id, 0, 0)
  on conflict (item_id, area_id) do nothing;

  select quantity into previous_value
  from public.area_inventory
  where item_id = p_item_id and area_id = p_area_id
  for update;

  update public.area_inventory
  set quantity = p_quantity, minimum_quantity = p_minimum_quantity
  where item_id = p_item_id and area_id = p_area_id
  returning * into imported;

  insert into public.inventory_movements (
    item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
    new_quantity, source_type, notes, performed_by
  )
  values (
    p_item_id, 'adjustment', p_area_id, abs(p_quantity - previous_value),
    p_unit, previous_value, p_quantity, 'file_import',
    'Importación Excel/CSV', auth.uid()
  );

  return imported;
end;
$$;

revoke all on function public.import_area_inventory_stock(uuid, text, numeric, numeric, text) from public;
grant execute on function public.import_area_inventory_stock(uuid, text, numeric, numeric, text) to authenticated;

create or replace function public.import_inventory_rows(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row_data jsonb;
  inventory_item public.inventory_items;
  previous_value numeric;
  was_existing boolean;
  created_count integer := 0;
  updated_count integer := 0;
  stock_count integer := 0;
  movement_count integer := 0;
begin
  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para importar inventario.';
  end if;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(trim(row_data ->> 'name'), '') is null or nullif(trim(row_data ->> 'base_unit'), '') is null then
      raise exception 'La importación contiene una fila sin nombre o unidad base.';
    end if;

    inventory_item := null;
    if nullif(trim(row_data ->> 'matched_item_id'), '') is not null then
      select * into inventory_item
      from public.inventory_items
      where id = (row_data ->> 'matched_item_id')::uuid;
    elsif nullif(trim(row_data ->> 'sku'), '') is not null then
      select * into inventory_item
      from public.inventory_items
      where sku = nullif(trim(row_data ->> 'sku'), '');
    end if;

    was_existing := inventory_item.id is not null;
    if was_existing then
      update public.inventory_items
      set
        name = trim(row_data ->> 'name'),
        sku = nullif(trim(row_data ->> 'sku'), ''),
        category = nullif(trim(row_data ->> 'category'), ''),
        purchase_unit = nullif(trim(row_data ->> 'purchase_unit'), ''),
        base_unit = trim(row_data ->> 'base_unit'),
        conversion_factor = (row_data ->> 'conversion_factor')::numeric,
        cost_per_base_unit = (row_data ->> 'cost_per_base_unit')::numeric,
        supplier = nullif(trim(row_data ->> 'supplier'), ''),
        notes = 'Importado desde Excel/CSV',
        active = true
      where id = inventory_item.id
      returning * into inventory_item;
      updated_count := updated_count + 1;
    else
      insert into public.inventory_items (
        name, sku, category, purchase_unit, base_unit, conversion_factor,
        cost_per_base_unit, supplier, notes, active
      )
      values (
        trim(row_data ->> 'name'),
        nullif(trim(row_data ->> 'sku'), ''),
        nullif(trim(row_data ->> 'category'), ''),
        nullif(trim(row_data ->> 'purchase_unit'), ''),
        trim(row_data ->> 'base_unit'),
        (row_data ->> 'conversion_factor')::numeric,
        (row_data ->> 'cost_per_base_unit')::numeric,
        nullif(trim(row_data ->> 'supplier'), ''),
        'Importado desde Excel/CSV',
        true
      )
      returning * into inventory_item;
      created_count := created_count + 1;
    end if;

    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
    select inventory_item.id, areas.id, 0, 0
    from public.areas
    where areas.active = true
    on conflict (item_id, area_id) do nothing;

    select quantity into previous_value
    from public.area_inventory
    where item_id = inventory_item.id
      and area_id = row_data ->> 'area_id'
    for update;

    update public.area_inventory
    set
      quantity = (row_data ->> 'quantity')::numeric,
      minimum_quantity = (row_data ->> 'minimum_quantity')::numeric
    where item_id = inventory_item.id
      and area_id = row_data ->> 'area_id';

    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, notes, performed_by
    )
    values (
      inventory_item.id, 'adjustment', row_data ->> 'area_id',
      abs((row_data ->> 'quantity')::numeric - previous_value),
      row_data ->> 'base_unit', previous_value, (row_data ->> 'quantity')::numeric,
      'file_import', 'Importación Excel/CSV', auth.uid()
    );

    stock_count := stock_count + 1;
    movement_count := movement_count + 1;
  end loop;

  return jsonb_build_object(
    'created', created_count,
    'updated', updated_count,
    'stocks', stock_count,
    'movements', movement_count
  );
end;
$$;

revoke all on function public.import_inventory_rows(jsonb) from public;
grant execute on function public.import_inventory_rows(jsonb) to authenticated;
