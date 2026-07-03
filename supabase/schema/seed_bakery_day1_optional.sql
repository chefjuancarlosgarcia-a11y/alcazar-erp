-- Optional seed: Bakery Production Center — Day 1 operational test data
-- Run manually in Supabase SQL Editor AFTER 156_bakery_production_center.sql
-- Safe to re-run: uses tag [BAKERY_SEED_DAY1] and skips existing rows.
-- Does NOT delete production data outside this seed tag.

-- ---------------------------------------------------------------------------
-- 0. Assign supervisor_panaderia to Junior (adjust pattern if needed)
-- ---------------------------------------------------------------------------
update public.profiles
set
  role = 'supervisor_panaderia',
  area_id = coalesce(nullif(trim(area_id), ''), 'panaderia'),
  area_name = coalesce(nullif(trim(area_name), ''), 'Panadería'),
  updated_at = now()
where status = 'active'
  and (
    lower(coalesce(full_name, '')) like '%junior%'
    or lower(coalesce(username, '')) like '%junior%'
  );

-- ---------------------------------------------------------------------------
-- 1. Inventory products (panadería / pastelería)
-- ---------------------------------------------------------------------------
with product_defs as (
  select *
  from (
    values
      ('Cheesecake', 'Pastelería', 'Unidad'),
      ('Tiramisu', 'Pastelería', 'Unidad'),
      ('Roles de canela', 'Panadería', 'Unidad'),
      ('Galletas choco chip', 'Panadería', 'Unidad'),
      ('Pan campesino', 'Panadería', 'Unidad')
  ) as t(name, category, base_unit)
),
inserted_items as (
  insert into public.inventory_items (
    name, category, purchase_unit, base_unit, conversion_factor,
    cost_per_base_unit, active, notes
  )
  select
    d.name,
    d.category,
    d.base_unit,
    d.base_unit,
    1,
    0,
    true,
    '[BAKERY_SEED_DAY1] Producto demo panadería/pastelería'
  from product_defs d
  where not exists (
    select 1
    from public.inventory_items ii
    where lower(trim(ii.name)) = lower(trim(d.name))
      and ii.active = true
  )
  returning id, name
),
all_items as (
  select ii.id, ii.name
  from public.inventory_items ii
  where lower(trim(ii.name)) in (
    select lower(trim(name)) from product_defs
  )
  and ii.active = true
)
insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
select ai.id, 'panaderia', 0, 0
from all_items ai
on conflict (item_id, area_id) do nothing;

-- Optional recipes linked to products (helps diary preload)
insert into public.standard_recipes (
  name, recipe_type, production_area_id, yield_quantity, yield_unit,
  estimated_cost, active, notes
)
select v.name, 'final_product', v.area, v.yield_qty, v.unit, 0, true, '[BAKERY_SEED_DAY1] Receta demo'
from (
  values
    ('Cheesecake', 'reposteria', 8::numeric, 'Unidad'),
    ('Tiramisu', 'reposteria', 10::numeric, 'Unidad'),
    ('Roles de canela', 'panaderia', 24::numeric, 'Unidad'),
    ('Galletas choco chip', 'panaderia', 40::numeric, 'Unidad'),
    ('Pan campesino', 'panaderia', 12::numeric, 'Unidad')
) as v(name, area, yield_qty, unit)
where not exists (
  select 1 from public.standard_recipes sr
  where lower(trim(sr.name)) = lower(trim(v.name))
    and sr.production_area_id = v.area
    and sr.active = true
);

-- Link recipe output items where possible
update public.standard_recipes sr
set output_inventory_item_id = ii.id
from public.inventory_items ii
where sr.notes like '[BAKERY_SEED_DAY1]%'
  and sr.output_inventory_item_id is null
  and lower(trim(sr.name)) = lower(trim(ii.name))
  and ii.active = true;

-- ---------------------------------------------------------------------------
-- 2. Production plans for TOMORROW (America/Guatemala)
-- ---------------------------------------------------------------------------
with tomorrow as (
  select ((now() at time zone 'America/Guatemala')::date + 1) as d
),
junior as (
  select id
  from public.profiles
  where status = 'active'
    and public.normalize_profile_role(role) = 'supervisor_panaderia'
  order by case when lower(coalesce(full_name, username, '')) like '%junior%' then 0 else 1 end
  limit 1
),
manager as (
  select id
  from public.profiles
  where status = 'active'
    and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente')
  order by case public.normalize_profile_role(role)
    when 'admin' then 0 when 'gerente_general' then 1 else 2 end
  limit 1
),
plan_defs as (
  select *
  from (
    values
      ('Cheesecake', 8::numeric, 'Unidad', 'high', 'cafeteria'),
      ('Tiramisu', 10::numeric, 'Unidad', 'normal', 'cafeteria'),
      ('Roles de canela', 24::numeric, 'Unidad', 'normal', 'panaderia'),
      ('Galletas choco chip', 40::numeric, 'Unidad', 'low', 'cafeteria'),
      ('Pan campesino', 12::numeric, 'Unidad', 'urgent', 'panaderia')
  ) as t(product_name, planned_quantity, unit, priority, destination_area_id)
)
insert into public.bakery_production_plan_items (
  inventory_item_id,
  product_name,
  planned_quantity,
  unit,
  required_date,
  destination_area_id,
  priority,
  notes,
  requested_by,
  assigned_to,
  status
)
select
  ii.id,
  pd.product_name,
  pd.planned_quantity,
  pd.unit,
  t.d,
  pd.destination_area_id,
  pd.priority,
  '[BAKERY_SEED_DAY1] Plan operativo día 1',
  m.id,
  j.id,
  'planned'
from plan_defs pd
cross join tomorrow t
left join public.inventory_items ii
  on lower(trim(ii.name)) = lower(trim(pd.product_name))
  and ii.active = true
cross join manager m
left join junior j on true
where not exists (
  select 1
  from public.bakery_production_plan_items p
  where p.notes like '[BAKERY_SEED_DAY1]%'
    and p.required_date = t.d
    and lower(trim(p.product_name)) = lower(trim(pd.product_name))
);

-- ---------------------------------------------------------------------------
-- 3. Sample dough batch (pan campesino)
-- ---------------------------------------------------------------------------
insert into public.bakery_dough_batches (
  batch_code,
  dough_type,
  quantity_units,
  unit_weight,
  total_weight,
  mixed_at,
  cold_room_started_at,
  status,
  responsible_user_id,
  notes
)
select
  public.next_bakery_dough_batch_code('CAMPESINO'),
  'CAMPESINO',
  12,
  450,
  5400,
  now() - interval '6 hours',
  now() - interval '4 hours',
  'cold_room',
  j.id,
  '[BAKERY_SEED_DAY1] Masa demo cuarto frío'
from (
  select id
  from public.profiles
  where status = 'active'
    and public.normalize_profile_role(role) = 'supervisor_panaderia'
  order by case when lower(coalesce(full_name, username, '')) like '%junior%' then 0 else 1 end
  limit 1
) j
where not exists (
  select 1 from public.bakery_dough_batches d
  where d.notes like '[BAKERY_SEED_DAY1]%'
);

-- ---------------------------------------------------------------------------
-- 4. Sample waste record (placeholder photo — replace in UI test with real photo)
-- ---------------------------------------------------------------------------
insert into public.bakery_waste_records (
  product_name,
  quantity,
  unit,
  waste_reason,
  notes,
  photo_url,
  reported_by
)
select
  'Galletas choco chip',
  3,
  'Unidad',
  'burned',
  '[BAKERY_SEED_DAY1] Merma demo — reemplazar foto en prueba operativa real',
  'https://lwpfrdnsiwtmyonwcduh.supabase.co/storage/v1/object/public/bakery-evidence/seed/placeholder-waste.jpg',
  j.id
from (
  select id
  from public.profiles
  where status = 'active'
    and public.normalize_profile_role(role) = 'supervisor_panaderia'
  limit 1
) j
where not exists (
  select 1 from public.bakery_waste_records w
  where w.notes like '[BAKERY_SEED_DAY1]%'
);

-- ---------------------------------------------------------------------------
-- 5. Verification summary
-- ---------------------------------------------------------------------------
select 'profiles_supervisor_panaderia' as section, id, full_name, username, role, area_id
from public.profiles
where public.normalize_profile_role(role) = 'supervisor_panaderia'
  and status = 'active';

select 'seed_products' as section, id, name, category
from public.inventory_items
where notes like '[BAKERY_SEED_DAY1]%'
order by name;

select 'seed_plans_tomorrow' as section, id, product_name, planned_quantity, unit, required_date, priority, status
from public.bakery_production_plan_items
where notes like '[BAKERY_SEED_DAY1]%'
order by product_name;

select 'seed_dough' as section, id, batch_code, dough_type, status, cold_room_started_at
from public.bakery_dough_batches
where notes like '[BAKERY_SEED_DAY1]%';

select 'seed_waste' as section, id, product_name, quantity, waste_reason
from public.bakery_waste_records
where notes like '[BAKERY_SEED_DAY1]%';

-- Dashboard: probar autenticado en app (/bakery) o con JWT simulado en test_bakery_mvp_validation.sql
