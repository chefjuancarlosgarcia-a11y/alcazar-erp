-- Internal production batches and area inventory transformation.
-- Apply after 037_checklist_incidents.sql.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in (
    'purchase', 'transfer', 'consumption', 'adjustment', 'reversal', 'waste',
    'production_input', 'production_output'
  ));

alter table public.standard_recipes
  add column if not exists output_inventory_item_id uuid references public.inventory_items(id);

create or replace function public.set_standard_recipe_output_inventory_item(
  p_recipe_id uuid,
  p_output_inventory_item_id uuid
)
returns public.standard_recipes
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  output_item public.inventory_items;
begin
  select * into recipe
  from public.standard_recipes
  where id = p_recipe_id;

  if recipe.id is null then
    raise exception 'La receta no existe.';
  end if;
  if not public.can_manage_recipe_area(recipe.production_area_id) then
    raise exception 'No tienes permiso para configurar esta receta.';
  end if;

  if p_output_inventory_item_id is not null then
    select * into output_item
    from public.inventory_items
    where id = p_output_inventory_item_id and active = true;
    if output_item.id is null then
      raise exception 'El producto terminado no existe o esta inactivo.';
    end if;
  end if;

  update public.standard_recipes
  set output_inventory_item_id = p_output_inventory_item_id
  where id = recipe.id
  returning * into recipe;

  return recipe;
end;
$$;

create or replace function public.create_internal_production_output_item(p_recipe_id uuid)
returns public.inventory_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe public.standard_recipes;
  output_item public.inventory_items;
  base_unit_value text;
begin
  select * into recipe
  from public.standard_recipes
  where id = p_recipe_id and active = true;

  if recipe.id is null then
    raise exception 'La receta no existe o esta inactiva.';
  end if;
  if not public.can_create_internal_production(recipe.production_area_id) then
    raise exception 'No tienes permiso para crear producto terminado en esta area.';
  end if;
  if recipe.output_inventory_item_id is not null then
    select * into output_item from public.inventory_items where id = recipe.output_inventory_item_id;
    return output_item;
  end if;

  base_unit_value := coalesce(nullif(trim(recipe.yield_unit), ''), 'Unidad');

  select * into output_item
  from public.inventory_items
  where lower(trim(name)) = lower(trim(recipe.name))
    and active = true
  limit 1;

  if output_item.id is null then
    insert into public.inventory_items (
      name, sku, category, purchase_unit, base_unit, conversion_factor,
      purchase_price, cost_per_base_unit, supplier, active, notes
    )
    values (
      trim(recipe.name), null, 'Preparaciones', base_unit_value, base_unit_value, 1,
      null, coalesce(recipe.estimated_cost / nullif(recipe.yield_quantity, 0), 0),
      null, true, 'Creado desde produccion interna'
    )
    returning * into output_item;
  end if;

  insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
  values (output_item.id, recipe.production_area_id, 0, 0)
  on conflict (item_id, area_id) do nothing;

  update public.standard_recipes
  set output_inventory_item_id = output_item.id
  where id = recipe.id;

  return output_item;
end;
$$;

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text unique,
  production_area_id text references public.areas(id),
  production_area_name text,
  recipe_id uuid references public.standard_recipes(id),
  output_inventory_item_id uuid references public.inventory_items(id),
  output_name text not null,
  output_quantity numeric not null check (output_quantity > 0),
  output_unit text not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  produced_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  notes text,
  total_cost numeric not null default 0 check (total_cost >= 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  expected_quantity numeric,
  waste_quantity numeric not null default 0 check (waste_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.production_batch_inputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id),
  item_name text,
  quantity numeric not null check (quantity >= 0),
  unit text,
  area_stock_before numeric,
  area_stock_after numeric,
  cost_unit numeric not null default 0 check (cost_unit >= 0),
  total_cost numeric not null default 0 check (total_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.production_batch_outputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id),
  item_name text,
  quantity numeric not null check (quantity >= 0),
  unit text,
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  total_cost numeric not null default 0 check (total_cost >= 0),
  area_stock_before numeric,
  area_stock_after numeric,
  created_at timestamptz not null default now()
);

create index if not exists production_batches_status_idx
  on public.production_batches (status, created_at desc);

create index if not exists production_batches_area_idx
  on public.production_batches (production_area_id, created_at desc);

create index if not exists production_batch_inputs_batch_idx
  on public.production_batch_inputs (batch_id);

create index if not exists production_batch_outputs_batch_idx
  on public.production_batch_outputs (batch_id);

alter table public.production_batches enable row level security;
alter table public.production_batch_inputs enable row level security;
alter table public.production_batch_outputs enable row level security;

grant select, insert, update on public.production_batches to authenticated;
grant select, insert, update, delete on public.production_batch_inputs to authenticated;
grant select, insert, update, delete on public.production_batch_outputs to authenticated;
grant all on public.production_batches, public.production_batch_inputs, public.production_batch_outputs to service_role;

drop trigger if exists set_production_batches_updated_at on public.production_batches;
create trigger set_production_batches_updated_at
  before update on public.production_batches
  for each row execute procedure public.set_inventory_updated_at();

create or replace function public.can_create_internal_production(p_area_id text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        public.normalize_profile_role(profile.role) in (
          'admin', 'gerente_general', 'gerente', 'supervisor',
          'cocina', 'pizzeria', 'panadero', 'repostero'
        )
        or profile.role in (
          'admin', 'gerente_general', 'gerente', 'supervisor',
          'cocina', 'pizzeria', 'panadero', 'repostero'
        )
      )
      and (
        nullif(trim(coalesce(p_area_id, '')), '') is null
        or public.normalize_profile_role(profile.role) in ('admin', 'gerente_general', 'gerente')
        or nullif(trim(coalesce(profile.area_id, '')), '') = nullif(trim(coalesce(p_area_id, '')), '')
        or nullif(trim(coalesce(profile.area_name, '')), '') = nullif(trim(coalesce(p_area_id, '')), '')
      )
  );
$$;

create or replace function public.can_manage_internal_production()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in ('admin', 'gerente_general', 'gerente', 'supervisor')
  );
$$;

drop policy if exists "production_batches_authorized_read" on public.production_batches;
create policy "production_batches_authorized_read"
  on public.production_batches for select to authenticated
  using (public.can_create_internal_production(production_area_id));

drop policy if exists "production_batches_authorized_insert" on public.production_batches;
create policy "production_batches_authorized_insert"
  on public.production_batches for insert to authenticated
  with check (public.can_create_internal_production(production_area_id));

drop policy if exists "production_batches_authorized_update" on public.production_batches;
create policy "production_batches_authorized_update"
  on public.production_batches for update to authenticated
  using (public.can_create_internal_production(production_area_id))
  with check (public.can_create_internal_production(production_area_id));

drop policy if exists "production_batch_inputs_authorized_read" on public.production_batch_inputs;
create policy "production_batch_inputs_authorized_read"
  on public.production_batch_inputs for select to authenticated
  using (
    exists (
      select 1 from public.production_batches batch
      where batch.id = production_batch_inputs.batch_id
        and public.can_create_internal_production(batch.production_area_id)
    )
  );

drop policy if exists "production_batch_inputs_authorized_write" on public.production_batch_inputs;
create policy "production_batch_inputs_authorized_write"
  on public.production_batch_inputs for all to authenticated
  using (
    exists (
      select 1 from public.production_batches batch
      where batch.id = production_batch_inputs.batch_id
        and batch.status in ('draft', 'in_progress')
        and public.can_create_internal_production(batch.production_area_id)
    )
  )
  with check (
    exists (
      select 1 from public.production_batches batch
      where batch.id = production_batch_inputs.batch_id
        and batch.status in ('draft', 'in_progress')
        and public.can_create_internal_production(batch.production_area_id)
    )
  );

drop policy if exists "production_batch_outputs_authorized_read" on public.production_batch_outputs;
create policy "production_batch_outputs_authorized_read"
  on public.production_batch_outputs for select to authenticated
  using (
    exists (
      select 1 from public.production_batches batch
      where batch.id = production_batch_outputs.batch_id
        and public.can_create_internal_production(batch.production_area_id)
    )
  );

drop policy if exists "production_batch_outputs_authorized_write" on public.production_batch_outputs;
create policy "production_batch_outputs_authorized_write"
  on public.production_batch_outputs for all to authenticated
  using (
    exists (
      select 1 from public.production_batches batch
      where batch.id = production_batch_outputs.batch_id
        and batch.status in ('draft', 'in_progress')
        and public.can_create_internal_production(batch.production_area_id)
    )
  )
  with check (
    exists (
      select 1 from public.production_batches batch
      where batch.id = production_batch_outputs.batch_id
        and batch.status in ('draft', 'in_progress')
        and public.can_create_internal_production(batch.production_area_id)
    )
  );

create or replace function public.next_production_batch_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_prefix text := 'PROD-' || to_char(now(), 'YYYYMMDD') || '-';
  next_number integer;
begin
  select coalesce(max((right(batch_number, 4))::integer), 0) + 1
  into next_number
  from public.production_batches
  where batch_number like day_prefix || '%';

  return day_prefix || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.create_internal_production_batch(
  p_batch jsonb,
  p_inputs jsonb,
  p_outputs jsonb
)
returns public.production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.production_batches;
  area_record public.areas;
  recipe_record public.standard_recipes;
  output_item public.inventory_items;
  row_data jsonb;
  input_item public.inventory_items;
  output_qty numeric := coalesce((p_batch ->> 'output_quantity')::numeric, 0);
  expected_qty numeric := nullif(p_batch ->> 'expected_quantity', '')::numeric;
begin
  if output_qty <= 0 then
    raise exception 'La cantidad producida debe ser mayor que cero.';
  end if;

  select * into area_record
  from public.areas
  where id = nullif(trim(p_batch ->> 'production_area_id'), '') and active = true;
  if area_record.id is null then
    raise exception 'Selecciona un area activa.';
  end if;

  if not public.can_create_internal_production(area_record.id) then
    raise exception 'No tienes permiso para crear produccion en esta area.';
  end if;

  if nullif(trim(p_batch ->> 'recipe_id'), '') is not null then
    select * into recipe_record
    from public.standard_recipes
    where id = (p_batch ->> 'recipe_id')::uuid and active = true;
    if recipe_record.id is null then
      raise exception 'La receta seleccionada no existe o esta inactiva.';
    end if;
    if recipe_record.output_inventory_item_id is null then
      raise exception 'La receta seleccionada no tiene producto terminado configurado.';
    end if;
  end if;

  select * into output_item
  from public.inventory_items
  where id = (p_batch ->> 'output_inventory_item_id')::uuid and active = true;
  if output_item.id is null then
    raise exception 'Selecciona un producto terminado activo.';
  end if;
  if recipe_record.id is not null and output_item.id <> recipe_record.output_inventory_item_id then
    raise exception 'El producto terminado no corresponde a la receta seleccionada.';
  end if;

  insert into public.production_batches (
    batch_number, production_area_id, production_area_name, recipe_id,
    output_inventory_item_id, output_name, output_quantity, output_unit, status,
    started_at, produced_by, notes, expected_quantity, waste_quantity
  )
  values (
    public.next_production_batch_number(), area_record.id, area_record.name, recipe_record.id,
    output_item.id, output_item.name, output_qty, output_item.base_unit, 'in_progress',
    now(), auth.uid(), nullif(trim(p_batch ->> 'notes'), ''), expected_qty,
    greatest(0, coalesce(expected_qty, output_qty) - output_qty)
  )
  returning * into created;

  for row_data in select value from jsonb_array_elements(coalesce(p_inputs, '[]'::jsonb))
  loop
    select * into input_item
    from public.inventory_items
    where id = (row_data ->> 'inventory_item_id')::uuid and active = true;
    if input_item.id is null then
      raise exception 'La produccion contiene un insumo inactivo o inexistente.';
    end if;
    insert into public.production_batch_inputs (
      batch_id, inventory_item_id, item_name, quantity, unit, cost_unit, total_cost
    )
    values (
      created.id, input_item.id, input_item.name,
      greatest(0, coalesce((row_data ->> 'quantity')::numeric, 0)),
      input_item.base_unit, input_item.cost_per_base_unit,
      greatest(0, coalesce((row_data ->> 'quantity')::numeric, 0)) * input_item.cost_per_base_unit
    );
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(p_outputs, '[]'::jsonb))
  loop
    insert into public.production_batch_outputs (
      batch_id, inventory_item_id, item_name, quantity, unit
    )
    values (
      created.id, output_item.id, output_item.name,
      greatest(0, coalesce((row_data ->> 'quantity')::numeric, output_qty)),
      output_item.base_unit
    );
  end loop;

  if not exists (select 1 from public.production_batch_outputs where batch_id = created.id) then
    insert into public.production_batch_outputs (
      batch_id, inventory_item_id, item_name, quantity, unit
    )
    values (created.id, output_item.id, output_item.name, output_qty, output_item.base_unit);
  end if;

  return created;
end;
$$;

create or replace function public.complete_internal_production_batch(p_batch_id uuid)
returns public.production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.production_batches;
  input_row public.production_batch_inputs;
  output_row public.production_batch_outputs;
  stock_before numeric;
  stock_after numeric;
  batch_total numeric := 0;
  output_total numeric := 0;
  unit_cost_value numeric := 0;
begin
  select * into batch
  from public.production_batches
  where id = p_batch_id
  for update;

  if batch.id is null then
    raise exception 'La produccion no existe.';
  end if;
  if batch.status not in ('draft', 'in_progress') then
    raise exception 'Solo se puede completar una produccion abierta.';
  end if;
  if not public.can_create_internal_production(batch.production_area_id) then
    raise exception 'No tienes permiso para completar esta produccion.';
  end if;
  if batch.recipe_id is not null and not exists (
    select 1
    from public.standard_recipes recipe
    where recipe.id = batch.recipe_id
      and recipe.output_inventory_item_id = batch.output_inventory_item_id
  ) then
    raise exception 'La receta seleccionada no tiene producto terminado configurado.';
  end if;

  for input_row in select * from public.production_batch_inputs where batch_id = batch.id
  loop
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
    values (input_row.inventory_item_id, batch.production_area_id, 0, 0)
    on conflict (item_id, area_id) do nothing;

    select quantity into stock_before
    from public.area_inventory
    where item_id = input_row.inventory_item_id and area_id = batch.production_area_id
    for update;
    stock_before := coalesce(stock_before, 0);
    stock_after := stock_before - input_row.quantity;
    if stock_after < 0 then
      raise exception 'Stock insuficiente de %. Disponible: %, requerido: %.',
        input_row.item_name, stock_before, input_row.quantity;
    end if;

    update public.area_inventory
    set quantity = stock_after
    where item_id = input_row.inventory_item_id and area_id = batch.production_area_id;

    update public.production_batch_inputs
    set
      area_stock_before = stock_before,
      area_stock_after = stock_after,
      total_cost = input_row.quantity * input_row.cost_unit
    where id = input_row.id;

    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    )
    values (
      input_row.inventory_item_id, 'production_input', batch.production_area_id,
      input_row.quantity, input_row.unit, stock_before, stock_after,
      'internal_production', batch.id::text,
      'Insumo usado en produccion ' || batch.batch_number, auth.uid()
    );

    batch_total := batch_total + (input_row.quantity * input_row.cost_unit);
  end loop;

  select coalesce(sum(quantity), 0) into output_total
  from public.production_batch_outputs
  where batch_id = batch.id;

  if output_total <= 0 then
    raise exception 'La produccion debe tener una salida mayor que cero.';
  end if;

  unit_cost_value := batch_total / output_total;

  for output_row in select * from public.production_batch_outputs where batch_id = batch.id
  loop
    insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
    values (output_row.inventory_item_id, batch.production_area_id, 0, 0)
    on conflict (item_id, area_id) do nothing;

    select quantity into stock_before
    from public.area_inventory
    where item_id = output_row.inventory_item_id and area_id = batch.production_area_id
    for update;
    stock_before := coalesce(stock_before, 0);
    stock_after := stock_before + output_row.quantity;

    update public.area_inventory
    set quantity = stock_after
    where item_id = output_row.inventory_item_id and area_id = batch.production_area_id;

    update public.production_batch_outputs
    set
      unit_cost = unit_cost_value,
      total_cost = output_row.quantity * unit_cost_value,
      area_stock_before = stock_before,
      area_stock_after = stock_after
    where id = output_row.id;

    update public.inventory_items
    set cost_per_base_unit = unit_cost_value
    where id = output_row.inventory_item_id;

    insert into public.inventory_movements (
      item_id, movement_type, to_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    )
    values (
      output_row.inventory_item_id, 'production_output', batch.production_area_id,
      output_row.quantity, output_row.unit, stock_before, stock_after,
      'internal_production', batch.id::text,
      'Salida de produccion ' || batch.batch_number, auth.uid()
    );
  end loop;

  update public.production_batches
  set
    status = 'completed',
    completed_at = now(),
    approved_by = auth.uid(),
    total_cost = batch_total,
    unit_cost = unit_cost_value,
    updated_at = now()
  where id = batch.id
  returning * into batch;

  return batch;
end;
$$;

create or replace function public.cancel_internal_production_batch(p_batch_id uuid, p_notes text default null)
returns public.production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.production_batches;
begin
  select * into batch from public.production_batches where id = p_batch_id for update;
  if batch.id is null then raise exception 'La produccion no existe.'; end if;
  if batch.status = 'completed' then raise exception 'No se puede cancelar una produccion completada.'; end if;
  if not public.can_manage_internal_production() then raise exception 'No tienes permiso para cancelar producciones.'; end if;

  update public.production_batches
  set status = 'cancelled',
      notes = coalesce(nullif(trim(p_notes), ''), notes),
      updated_at = now()
  where id = p_batch_id
  returning * into batch;
  return batch;
end;
$$;

revoke all on function
  public.can_create_internal_production(text),
  public.can_manage_internal_production(),
  public.set_standard_recipe_output_inventory_item(uuid, uuid),
  public.create_internal_production_output_item(uuid),
  public.next_production_batch_number(),
  public.create_internal_production_batch(jsonb, jsonb, jsonb),
  public.complete_internal_production_batch(uuid),
  public.cancel_internal_production_batch(uuid, text)
from public;

grant execute on function
  public.can_create_internal_production(text),
  public.can_manage_internal_production(),
  public.set_standard_recipe_output_inventory_item(uuid, uuid),
  public.create_internal_production_output_item(uuid),
  public.next_production_batch_number(),
  public.create_internal_production_batch(jsonb, jsonb, jsonb),
  public.complete_internal_production_batch(uuid),
  public.cancel_internal_production_batch(uuid, text)
to authenticated;
