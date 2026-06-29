-- Diagnóstico: Claudia + Tomate Cherry
-- Ejecutar en Supabase SQL Editor.

-- 0) Tamaño del catálogo (PostgREST devuelve máx. 1000 filas por request sin paginar)
select count(*) as total_productos from public.inventory_items;

-- 1) Perfil de Claudia
select
  p.id,
  p.email,
  p.full_name,
  p.username,
  p.role,
  public.normalize_profile_role(p.role) as role_normalizado,
  p.status,
  p.area_id,
  (p.role in ('admin', 'gerente_general', 'encargado_almacen') and p.status = 'active') as pasa_is_inventory_manager_actual,
  (public.normalize_profile_role(p.role) in ('admin', 'gerente_general', 'encargado_almacen') and p.status = 'active') as pasa_manager_si_normaliza
from public.profiles p
where p.email ilike '%claudia%'
   or p.full_name ilike '%claudia%';

-- 2) Productos tipo tomate / cherry
select
  i.id,
  i.name,
  i.sku,
  i.category,
  i.active,
  i.created_at,
  i.updated_at,
  coalesce(sum(ai.quantity), 0) as stock_total
from public.inventory_items i
left join public.area_inventory ai on ai.item_id = i.id
where i.name ilike '%tomate%'
   or i.name ilike '%cherry%'
group by i.id
order by i.updated_at desc;

-- 3) Duplicados por nombre normalizado
select
  lower(trim(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) as nombre_normalizado,
  count(*) as cantidad,
  array_agg(name order by updated_at desc) as nombres,
  array_agg(id::text order by updated_at desc) as ids,
  array_agg(active::text order by updated_at desc) as activos
from public.inventory_items
where name ilike '%tomate%'
group by 1
having count(*) > 1;

-- 4) SKUs conflictivos en tomate
select sku, count(*) as cantidad, array_agg(name) as nombres
from public.inventory_items
where sku is not null
  and trim(sku) <> ''
  and (name ilike '%tomate%' or sku ilike '%tomate%')
group by sku
having count(*) > 1;

-- 5) Auditoría reciente de migración inventario (si aplica)
select *
from public.inventory_migration_mode_audit
order by changed_at desc
limit 10;
