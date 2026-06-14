-- Yield profiles, audit campaigns, dynamic usable costing, and recipe cost history.
-- Apply after 078_production_areas_user_assignments.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Inventory costing columns
-- ---------------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists weighted_average_cost numeric not null default 0 check (weighted_average_cost >= 0),
  add column if not exists usable_cost numeric not null default 0 check (usable_cost >= 0);

-- ---------------------------------------------------------------------------
-- Recipe dynamic costing columns
-- ---------------------------------------------------------------------------
alter table public.standard_recipes
  add column if not exists recipe_current_cost numeric not null default 0 check (recipe_current_cost >= 0),
  add column if not exists recipe_food_cost_percent numeric check (recipe_food_cost_percent >= 0),
  add column if not exists recipe_gross_margin numeric,
  add column if not exists target_food_cost_percent numeric check (target_food_cost_percent >= 0 and target_food_cost_percent <= 100),
  add column if not exists last_cost_update timestamptz;

create table if not exists public.recipe_cost_history (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.standard_recipes(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  cost numeric not null check (cost >= 0),
  food_cost_percent numeric,
  gross_margin numeric,
  notes text
);

create index if not exists recipe_cost_history_recipe_idx
  on public.recipe_cost_history (recipe_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Yield profiles per ingredient
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_yield_profiles (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null unique references public.inventory_items(id) on delete cascade,
  expected_yield_percent numeric not null default 100
    check (expected_yield_percent > 0 and expected_yield_percent <= 100),
  minimum_acceptable_yield_percent numeric not null default 90
    check (minimum_acceptable_yield_percent > 0 and minimum_acceptable_yield_percent <= 100),
  historical_average_yield_percent numeric check (
    historical_average_yield_percent > 0 and historical_average_yield_percent <= 100
  ),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_yield_profiles_item_idx
  on public.inventory_yield_profiles (inventory_item_id, active);

-- ---------------------------------------------------------------------------
-- Configurable waste reasons
-- ---------------------------------------------------------------------------
create table if not exists public.yield_waste_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.yield_waste_reasons (name, sort_order) values
  ('Normal de limpieza', 10),
  ('Producto vencido', 20),
  ('Producto dañado', 30),
  ('Mala manipulación', 40),
  ('Sobreproducción', 50),
  ('Quemado', 60),
  ('Error de preparación', 70),
  ('Proveedor', 80),
  ('Otro', 90)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Audit campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.yield_audit_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.yield_audit_campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.yield_audit_campaigns(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  required boolean not null default true,
  active boolean not null default true,
  unique (campaign_id, inventory_item_id)
);

create index if not exists yield_audit_campaign_items_campaign_idx
  on public.yield_audit_campaign_items (campaign_id, active);

-- ---------------------------------------------------------------------------
-- Individual yield audits (linked to tasks optionally)
-- ---------------------------------------------------------------------------
create table if not exists public.yield_audits (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.yield_audit_campaigns(id) on delete set null,
  inventory_item_id uuid not null references public.inventory_items(id),
  task_id text,
  production_area_id text references public.areas(id),
  employee_id uuid references public.profiles(id),
  supervisor_id uuid references public.profiles(id),
  audit_date date not null default current_date,
  initial_weight numeric not null check (initial_weight > 0),
  usable_weight numeric not null check (usable_weight >= 0),
  waste_weight numeric not null default 0 check (waste_weight >= 0),
  yield_percent numeric not null check (yield_percent > 0 and yield_percent <= 100),
  variance_percent numeric,
  waste_reason_id uuid references public.yield_waste_reasons(id),
  notes text,
  photo_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists yield_audits_item_idx on public.yield_audits (inventory_item_id, audit_date desc);
create index if not exists yield_audits_campaign_idx on public.yield_audits (campaign_id, audit_date desc);
create index if not exists yield_audits_employee_idx on public.yield_audits (employee_id, audit_date desc);
create index if not exists yield_audits_task_idx on public.yield_audits (task_id) where task_id is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.inventory_yield_profiles enable row level security;
alter table public.yield_waste_reasons enable row level security;
alter table public.yield_audit_campaigns enable row level security;
alter table public.yield_audit_campaign_items enable row level security;
alter table public.yield_audits enable row level security;
alter table public.recipe_cost_history enable row level security;

grant select, insert, update, delete on public.inventory_yield_profiles to authenticated;
grant select on public.yield_waste_reasons to authenticated;
grant select, insert, update, delete on public.yield_audit_campaigns to authenticated;
grant select, insert, update, delete on public.yield_audit_campaign_items to authenticated;
grant select, insert on public.yield_audits to authenticated;
grant select on public.recipe_cost_history to authenticated;

drop policy if exists "inventory_yield_profiles_read" on public.inventory_yield_profiles;
create policy "inventory_yield_profiles_read"
  on public.inventory_yield_profiles for select to authenticated using (true);

drop policy if exists "inventory_yield_profiles_manage" on public.inventory_yield_profiles;
create policy "inventory_yield_profiles_manage"
  on public.inventory_yield_profiles for all to authenticated
  using (public.is_inventory_manager() or public.is_profile_manager())
  with check (public.is_inventory_manager() or public.is_profile_manager());

drop policy if exists "yield_waste_reasons_read" on public.yield_waste_reasons;
create policy "yield_waste_reasons_read"
  on public.yield_waste_reasons for select to authenticated using (active = true);

drop policy if exists "yield_waste_reasons_manage" on public.yield_waste_reasons;
create policy "yield_waste_reasons_manage"
  on public.yield_waste_reasons for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "yield_audit_campaigns_read" on public.yield_audit_campaigns;
create policy "yield_audit_campaigns_read"
  on public.yield_audit_campaigns for select to authenticated using (true);

drop policy if exists "yield_audit_campaigns_manage" on public.yield_audit_campaigns;
create policy "yield_audit_campaigns_manage"
  on public.yield_audit_campaigns for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "yield_audit_campaign_items_read" on public.yield_audit_campaign_items;
create policy "yield_audit_campaign_items_read"
  on public.yield_audit_campaign_items for select to authenticated using (true);

drop policy if exists "yield_audit_campaign_items_manage" on public.yield_audit_campaign_items;
create policy "yield_audit_campaign_items_manage"
  on public.yield_audit_campaign_items for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

drop policy if exists "yield_audits_read" on public.yield_audits;
create policy "yield_audits_read"
  on public.yield_audits for select to authenticated using (true);

drop policy if exists "yield_audits_insert" on public.yield_audits;
create policy "yield_audits_insert"
  on public.yield_audits for insert to authenticated with check (true);

drop policy if exists "recipe_cost_history_read" on public.recipe_cost_history;
create policy "recipe_cost_history_read"
  on public.recipe_cost_history for select to authenticated
  using (public.is_profile_manager() or public.is_inventory_manager());

-- ---------------------------------------------------------------------------
-- Costing helpers
-- ---------------------------------------------------------------------------
create or replace function public.compute_inventory_weighted_average_cost(p_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with stock as (
    select coalesce(sum(ai.quantity), 0) as total_qty
    from public.area_inventory ai
    where ai.item_id = p_item_id
  ),
  purchase_weighted as (
    select
      case
        when sum(im.quantity) > 0 then sum(im.quantity * i.cost_per_base_unit) / sum(im.quantity)
        else null
      end as cpp
    from public.inventory_movements im
    join public.inventory_items i on i.id = im.item_id
    where im.item_id = p_item_id
      and im.movement_type = 'purchase'
      and im.quantity > 0
  )
  select coalesce(
    (select cpp from purchase_weighted where cpp is not null),
    (select i.cost_per_base_unit from public.inventory_items i where i.id = p_item_id),
    0
  )
  from public.inventory_items base
  where base.id = p_item_id;
$$;

create or replace function public.refresh_inventory_item_costing(p_item_id uuid)
returns public.inventory_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inventory_items;
  profile public.inventory_yield_profiles;
  cpp numeric;
  yield_pct numeric;
  cur numeric;
begin
  select * into item from public.inventory_items where id = p_item_id;
  if item.id is null then
    raise exception 'Ingrediente no encontrado.';
  end if;

  cpp := public.compute_inventory_weighted_average_cost(p_item_id);

  select * into profile
  from public.inventory_yield_profiles
  where inventory_item_id = p_item_id and active = true;

  yield_pct := coalesce(profile.expected_yield_percent, 100);
  if yield_pct <= 0 then
    yield_pct := 100;
  end if;

  cur := case when cpp > 0 then cpp / (yield_pct / 100.0) else 0 end;

  update public.inventory_items
  set
    weighted_average_cost = cpp,
    usable_cost = cur,
    updated_at = now()
  where id = p_item_id
  returning * into item;

  perform public.recalculate_recipes_for_inventory_item(p_item_id);
  return item;
end;
$$;

create or replace function public.recalculate_recipes_for_inventory_item(p_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipe_row record;
  ingredient_row record;
  total_cost numeric;
  unit_cost numeric;
  updated_count integer := 0;
  ingredient_cost numeric;
  usable numeric;
begin
  for recipe_row in
    select distinct sr.*
    from public.standard_recipes sr
    join public.recipe_ingredients ri on ri.recipe_id = sr.id
    where ri.inventory_item_id = p_item_id
      and sr.active = true
  loop
    total_cost := 0;
    for ingredient_row in
      select ri.*, ii.usable_cost, ii.cost_per_base_unit, ii.weighted_average_cost
      from public.recipe_ingredients ri
      join public.inventory_items ii on ii.id = ri.inventory_item_id
      where ri.recipe_id = recipe_row.id
    loop
      usable := coalesce(nullif(ingredient_row.usable_cost, 0), ingredient_row.cost_per_base_unit, 0);
      ingredient_cost := coalesce(ingredient_row.inventory_quantity, ingredient_row.quantity, 0) * usable;
      total_cost := total_cost + ingredient_cost;
    end loop;

    unit_cost := case
      when coalesce(recipe_row.yield_quantity, 0) > 0 then total_cost / recipe_row.yield_quantity
      else total_cost
    end;

    update public.standard_recipes
    set
      estimated_cost = total_cost,
      recipe_current_cost = total_cost,
      recipe_food_cost_percent = recipe_row.target_food_cost_percent,
      last_cost_update = now(),
      updated_at = now()
    where id = recipe_row.id;

    insert into public.recipe_cost_history (recipe_id, cost, food_cost_percent, gross_margin, notes)
    values (
      recipe_row.id,
      total_cost,
      recipe_row.target_food_cost_percent,
      null,
      'Recalculado por cambio de costo utilizable'
    );

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;

create or replace function public.refresh_historical_yield_average(p_item_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  avg_yield numeric;
begin
  select round(avg(ya.yield_percent)::numeric, 2) into avg_yield
  from public.yield_audits ya
  where ya.inventory_item_id = p_item_id;

  if avg_yield is null then
    return null;
  end if;

  update public.inventory_yield_profiles
  set
    historical_average_yield_percent = avg_yield,
    updated_at = now()
  where inventory_item_id = p_item_id;

  if not found then
    insert into public.inventory_yield_profiles (
      inventory_item_id,
      expected_yield_percent,
      minimum_acceptable_yield_percent,
      historical_average_yield_percent
    )
    select p_item_id, 100, 90, avg_yield
    from public.inventory_items
    where id = p_item_id;
  end if;

  perform public.refresh_inventory_item_costing(p_item_id);
  return avg_yield;
end;
$$;

create or replace function public.submit_yield_audit(
  p_campaign_id uuid,
  p_inventory_item_id uuid,
  p_task_id text,
  p_production_area_id text,
  p_employee_id uuid,
  p_supervisor_id uuid,
  p_audit_date date,
  p_initial_weight numeric,
  p_usable_weight numeric,
  p_waste_reason_id uuid,
  p_notes text,
  p_photo_urls text[]
)
returns public.yield_audits
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.inventory_yield_profiles;
  waste numeric;
  yield_pct numeric;
  variance numeric;
  saved public.yield_audits;
begin
  if p_initial_weight <= 0 then
    raise exception 'El peso inicial debe ser mayor que cero.';
  end if;
  if p_usable_weight < 0 or p_usable_weight > p_initial_weight then
    raise exception 'El peso utilizable debe estar entre 0 y el peso inicial.';
  end if;

  waste := greatest(p_initial_weight - p_usable_weight, 0);
  yield_pct := round((p_usable_weight / p_initial_weight) * 100.0, 2);

  select * into profile
  from public.inventory_yield_profiles
  where inventory_item_id = p_inventory_item_id and active = true;

  variance := case
    when profile.id is not null then round(yield_pct - profile.expected_yield_percent, 2)
    else null
  end;

  insert into public.yield_audits (
    campaign_id, inventory_item_id, task_id, production_area_id,
    employee_id, supervisor_id, audit_date,
    initial_weight, usable_weight, waste_weight,
    yield_percent, variance_percent, waste_reason_id, notes, photo_urls
  ) values (
    p_campaign_id, p_inventory_item_id, nullif(trim(p_task_id), ''), nullif(trim(p_production_area_id), ''),
    coalesce(p_employee_id, auth.uid()), p_supervisor_id, coalesce(p_audit_date, current_date),
    p_initial_weight, p_usable_weight, waste,
    yield_pct, variance, p_waste_reason_id, nullif(trim(p_notes), ''), coalesce(p_photo_urls, '{}')
  ) returning * into saved;

  perform public.refresh_historical_yield_average(p_inventory_item_id);
  return saved;
end;
$$;

create or replace function public.upsert_inventory_yield_profile(
  p_inventory_item_id uuid,
  p_expected_yield_percent numeric,
  p_minimum_acceptable_yield_percent numeric,
  p_notes text,
  p_active boolean default true
)
returns public.inventory_yield_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.inventory_yield_profiles;
begin
  if not public.is_inventory_manager() and not public.is_profile_manager() then
    raise exception 'No tienes permiso para administrar rendimientos.';
  end if;
  if p_expected_yield_percent <= 0 or p_expected_yield_percent > 100 then
    raise exception 'El rendimiento esperado debe estar entre 0 y 100.';
  end if;
  if p_minimum_acceptable_yield_percent <= 0 or p_minimum_acceptable_yield_percent > 100 then
    raise exception 'El rendimiento minimo debe estar entre 0 y 100.';
  end if;

  insert into public.inventory_yield_profiles (
    inventory_item_id,
    expected_yield_percent,
    minimum_acceptable_yield_percent,
    notes,
    active
  ) values (
    p_inventory_item_id,
    p_expected_yield_percent,
    p_minimum_acceptable_yield_percent,
    nullif(trim(p_notes), ''),
    coalesce(p_active, true)
  )
  on conflict (inventory_item_id) do update set
    expected_yield_percent = excluded.expected_yield_percent,
    minimum_acceptable_yield_percent = excluded.minimum_acceptable_yield_percent,
    notes = excluded.notes,
    active = excluded.active,
    updated_at = now()
  returning * into saved;

  perform public.refresh_inventory_item_costing(p_inventory_item_id);
  return saved;
end;
$$;

-- Trigger: refresh costing when purchase price / base cost changes
create or replace function public.trg_inventory_item_costing_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_inventory_item_costing(new.id);
  return new;
end;
$$;

drop trigger if exists inventory_item_costing_refresh on public.inventory_items;
create trigger inventory_item_costing_refresh
  after insert or update of cost_per_base_unit, purchase_price on public.inventory_items
  for each row execute function public.trg_inventory_item_costing_refresh();

-- Backfill costing for existing items
do $$
declare
  item_id uuid;
begin
  for item_id in select id from public.inventory_items where active = true
  loop
    perform public.refresh_inventory_item_costing(item_id);
  end loop;
end;
$$;

-- Update save_standard_recipe to use usable_cost
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
  usable numeric;
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

    usable := coalesce(nullif(inventory_item.usable_cost, 0), inventory_item.cost_per_base_unit, 0);
    total_cost := total_cost + (inventory_qty * usable);
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
      recipe_current_cost = total_cost,
      last_cost_update = now(),
      active = coalesce((p_recipe ->> 'active')::boolean, true),
      image_url = nullif(trim(p_recipe ->> 'image_url'), ''),
      preparation_steps = coalesce(p_recipe -> 'preparation_steps', '[]'::jsonb),
      notes = nullif(trim(p_recipe ->> 'notes'), '')
    where id = p_recipe_id returning * into saved;
    delete from public.recipe_ingredients where recipe_id = p_recipe_id;
  else
    insert into public.standard_recipes (
      name, recipe_type, pos_category_id, production_area_id, yield_quantity,
      yield_unit, estimated_cost, recipe_current_cost, last_cost_update,
      active, image_url, preparation_steps, notes, created_by
    ) values (
      trim(p_recipe ->> 'name'), recipe_kind, nullif(trim(p_recipe ->> 'pos_category_id'), ''),
      area_id, coalesce((p_recipe ->> 'yield_quantity')::numeric, 1),
      nullif(trim(p_recipe ->> 'yield_unit'), ''), total_cost, total_cost, now(),
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

  insert into public.recipe_cost_history (recipe_id, cost, notes)
  values (saved.id, total_cost, 'Guardado de receta');

  return saved;
end;
$$;

revoke all on function public.compute_inventory_weighted_average_cost(uuid) from public;
revoke all on function public.refresh_inventory_item_costing(uuid) from public;
revoke all on function public.recalculate_recipes_for_inventory_item(uuid) from public;
revoke all on function public.refresh_historical_yield_average(uuid) from public;
revoke all on function public.submit_yield_audit(uuid, uuid, text, text, uuid, uuid, date, numeric, numeric, uuid, text, text[]) from public;
revoke all on function public.upsert_inventory_yield_profile(uuid, numeric, numeric, text, boolean) from public;

grant execute on function public.compute_inventory_weighted_average_cost(uuid) to authenticated;
grant execute on function public.refresh_inventory_item_costing(uuid) to authenticated;
grant execute on function public.recalculate_recipes_for_inventory_item(uuid) to authenticated;
grant execute on function public.refresh_historical_yield_average(uuid) to authenticated;
grant execute on function public.submit_yield_audit(uuid, uuid, text, text, uuid, uuid, date, numeric, numeric, uuid, text, text[]) to authenticated;
grant execute on function public.upsert_inventory_yield_profile(uuid, numeric, numeric, text, boolean) to authenticated;
