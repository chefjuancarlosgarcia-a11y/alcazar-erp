-- Read-only Stage preflight: barista requisitions (e.g. Osman / Cafetería).
-- Do not mutate data. Replace <OSMAN_PROFILE_ID> after the profile query.

-- 1) Profile (status, not active)
select
  id,
  full_name,
  username,
  role,
  area_id,
  area_name,
  status
from public.profiles
where full_name ilike '%Osman%'
   or username ilike '%osman%';

-- 2) Operational area assignments
select
  upa.profile_id,
  upa.production_area_id,
  upa.is_active,
  a.name,
  a.active,
  a.can_request_inventory,
  a.is_production_area
from public.user_production_areas upa
join public.areas a
  on a.id = upa.production_area_id
where upa.profile_id = '<OSMAN_PROFILE_ID>';

-- 3) Cafetería area
select
  id,
  name,
  type,
  active,
  can_request_inventory,
  is_production_area,
  responsible_user_id
from public.areas
where id = 'cafeteria'
   or name ilike '%cafeter%';

-- 4) Warehouse area (no is_warehouse column)
select
  id,
  name,
  type,
  active,
  can_request_inventory,
  is_production_area
from public.areas
where active = true
  and (
    id = 'almacen'
    or lower(trim(name)) in ('almacen', 'almacén')
  );

-- 5) RPC helper used by the app
select public.get_warehouse_area_id();
