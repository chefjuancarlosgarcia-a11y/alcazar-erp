-- Inventory product categories catalog.
-- Apply after 133_inventory_images_size_limit.sql.
--
-- Official source for the inventory item "category" field (inventory_items.category stores the display name).
-- Seed baseline from supplier types (frontend/src/modules/suppliers/suppliersHelpers.js PROVEEDOR_TIPOS)
-- and internal production ("Preparaciones" in 038_internal_production.sql).
-- Additional rows are created from distinct inventory_items.category values already in the database.

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_categories_active_idx
  on public.inventory_categories (is_active, sort_order, name);

alter table public.inventory_categories enable row level security;

grant select on public.inventory_categories to authenticated;
grant insert, update, delete on public.inventory_categories to authenticated;

drop policy if exists inventory_categories_read_active on public.inventory_categories;
create policy inventory_categories_read_active
  on public.inventory_categories for select to authenticated
  using (is_active = true);

drop policy if exists inventory_categories_read_all_managers on public.inventory_categories;
create policy inventory_categories_read_all_managers
  on public.inventory_categories for select to authenticated
  using (public.is_inventory_manager());

drop policy if exists inventory_categories_write_managers on public.inventory_categories;
create policy inventory_categories_write_managers
  on public.inventory_categories for all to authenticated
  using (public.is_inventory_manager())
  with check (public.is_inventory_manager());

create or replace function public.slugify_inventory_category_code(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '_' from regexp_replace(
    lower(translate(coalesce(trim(p_name), ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
    '[^a-z0-9]+',
    '_',
    'g'
  ));
$$;

insert into public.inventory_categories (code, name, sort_order, is_active)
values
  ('lacteos', 'Lácteos', 10, true),
  ('carnes', 'Carnes', 20, true),
  ('vegetales', 'Vegetales', 30, true),
  ('importados', 'Importados', 40, true),
  ('bebidas', 'Bebidas', 50, true),
  ('empaques', 'Empaques', 60, true),
  ('limpieza', 'Limpieza', 70, true),
  ('equipo', 'Equipo', 80, true),
  ('preparaciones', 'Preparaciones', 90, true)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.inventory_categories (code, name, sort_order, is_active)
select
  public.slugify_inventory_category_code(source.category),
  source.category,
  1000 + row_number() over (order by source.category),
  true
from (
  select distinct trim(category) as category
  from public.inventory_items
  where nullif(trim(category), '') is not null
) as source
where public.slugify_inventory_category_code(source.category) <> ''
  and not exists (
    select 1
    from public.inventory_categories existing
    where lower(existing.name) = lower(source.category)
       or existing.code = public.slugify_inventory_category_code(source.category)
  )
on conflict (code) do nothing;
