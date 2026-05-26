-- Operational areas shared by inventory, POS, KDS and user profiles.
-- Apply after 001_profiles.sql and 002_profile_management_policies.sql.

create table if not exists public.areas (
  id text primary key,
  name text not null,
  type text not null default 'operativa'
    check (type in ('principal', 'operativa', 'produccion', 'servicio', 'administrativa', 'limpieza')),
  description text,
  responsible_user_id uuid references public.profiles(id),
  can_request_inventory boolean not null default true,
  is_production_area boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.areas enable row level security;

grant select, insert, update on public.areas to authenticated;
grant all on public.areas to service_role;

drop policy if exists "areas_authenticated_read_active" on public.areas;
create policy "areas_authenticated_read_active"
  on public.areas
  for select
  to authenticated
  using (active = true);

drop policy if exists "areas_managers_read_all" on public.areas;
create policy "areas_managers_read_all"
  on public.areas
  for select
  to authenticated
  using (public.is_profile_manager());

drop policy if exists "areas_managers_create" on public.areas;
create policy "areas_managers_create"
  on public.areas
  for insert
  to authenticated
  with check (public.is_profile_manager());

drop policy if exists "areas_managers_update" on public.areas;
create policy "areas_managers_update"
  on public.areas
  for update
  to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

create or replace function public.set_area_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_area_updated_at on public.areas;
create trigger set_area_updated_at
  before update on public.areas
  for each row execute procedure public.set_area_updated_at();

insert into public.areas
  (id, name, type, can_request_inventory, is_production_area, active, sort_order)
values
  ('almacen', 'Almacén', 'principal', false, false, true, 10),
  ('cocina', 'Cocina', 'produccion', true, true, true, 20),
  ('pizzeria', 'Pizzería', 'produccion', true, true, true, 30),
  ('cafeteria', 'Cafetería', 'produccion', true, true, true, 40),
  ('barra', 'Barra', 'produccion', true, true, true, 50),
  ('mesas', 'Mesas', 'servicio', true, false, true, 60),
  ('caja', 'Caja', 'servicio', true, false, true, 70),
  ('limpieza', 'Limpieza', 'limpieza', true, false, true, 80),
  ('panaderia', 'Panadería', 'produccion', true, true, true, 90),
  ('reposteria', 'Repostería', 'produccion', true, true, true, 100),
  ('administracion', 'Administración', 'administrativa', true, false, true, 110)
on conflict (id) do nothing;
