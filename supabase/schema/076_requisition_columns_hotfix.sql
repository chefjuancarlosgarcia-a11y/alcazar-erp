-- Hotfix: 075 replaced create_requisition but some databases skipped 025/035.
-- Run this if you already applied 075 and see:
--   column "requested_by_profile_id" of relation "requisitions" does not exist

alter table public.requisitions
  add column if not exists requested_by_profile_id uuid references public.profiles(id),
  add column if not exists requested_by_name text,
  add column if not exists requested_by_role text;

alter table public.requisition_items
  add column if not exists requested_unit text,
  add column if not exists conversion_factor numeric,
  add column if not exists converted_requested_quantity numeric,
  add column if not exists converted_approved_quantity numeric,
  add column if not exists availability_status text,
  add column if not exists stock_available_at_request numeric,
  add column if not exists stock_minimum_at_request numeric,
  add column if not exists conversion_warning boolean not null default false;

update public.requisitions r
set requested_by_profile_id = coalesce(r.requested_by_profile_id, r.requested_by),
    requested_by_name = coalesce(r.requested_by_name, p.full_name, p.username),
    requested_by_role = coalesce(r.requested_by_role, p.role)
from public.profiles p
where p.id = r.requested_by
  and (r.requested_by_profile_id is null or r.requested_by_name is null or r.requested_by_role is null);

update public.requisition_items
set requested_unit = coalesce(requested_unit, unit),
    conversion_factor = coalesce(conversion_factor, 1),
    converted_requested_quantity = coalesce(converted_requested_quantity, requested_quantity),
    availability_status = coalesce(availability_status, 'Disponible')
where requested_unit is null
   or conversion_factor is null
   or converted_requested_quantity is null
   or availability_status is null;

alter table public.requisition_items
  alter column availability_status set default 'Disponible';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requisition_items_availability_status_check'
      and conrelid = 'public.requisition_items'::regclass
  ) then
    alter table public.requisition_items
      add constraint requisition_items_availability_status_check
      check (availability_status in ('Disponible', 'Parcial', 'Sin stock'));
  end if;
exception
  when others then null;
end $$;

create table if not exists public.inventory_unit_conversions (
  from_unit text not null,
  to_unit text not null,
  factor numeric not null check (factor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (from_unit, to_unit),
  check (nullif(trim(from_unit), '') is not null),
  check (nullif(trim(to_unit), '') is not null),
  check (lower(trim(from_unit)) <> lower(trim(to_unit)))
);

alter table public.inventory_unit_conversions enable row level security;

grant select on public.inventory_unit_conversions to authenticated;
grant all on public.inventory_unit_conversions to service_role;

drop policy if exists "inventory_unit_conversions_authenticated_read" on public.inventory_unit_conversions;
create policy "inventory_unit_conversions_authenticated_read"
  on public.inventory_unit_conversions for select to authenticated
  using (true);

insert into public.inventory_unit_conversions (from_unit, to_unit, factor)
values
  ('libra', 'onza', 16),
  ('onza', 'libra', 0.0625),
  ('kilogramo', 'gramo', 1000),
  ('gramo', 'kilogramo', 0.001),
  ('kg', 'gramo', 1000),
  ('gramo', 'kg', 0.001)
on conflict (from_unit, to_unit) do update
set factor = excluded.factor,
    updated_at = now();

create or replace function public.normalize_inventory_unit(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select replace(
      translate(
        lower(trim(coalesce(p_unit, ''))),
        'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜ',
        'aeiouAEIOUaeiouAEIOU'
      ),
      ' ',
      '_'
    ) as unit_key
  )
  select case
    when unit_key in ('unidad', 'unidades', 'u') then 'unidad'
    when unit_key in ('libra', 'libras', 'lb', 'lbs') then 'libra'
    when unit_key in ('onza', 'onzas', 'oz') then 'onza'
    when unit_key in ('kilogramo', 'kilogramos', 'kg') then 'kilogramo'
    when unit_key in ('gramo', 'gramos', 'g') then 'gramo'
    else unit_key
  end
  from normalized;
$$;

create or replace function public.resolve_inventory_unit_factor(p_from_unit text, p_to_unit text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.normalize_inventory_unit(p_from_unit) = public.normalize_inventory_unit(p_to_unit) then 1
    else coalesce((
      select c.factor
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_from_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_to_unit)
      limit 1
    ), (
      select 1 / c.factor
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_to_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_from_unit)
        and c.factor > 0
      limit 1
    ), 1)
  end;
$$;

create or replace function public.has_inventory_unit_conversion(p_from_unit text, p_to_unit text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_inventory_unit(p_from_unit) = public.normalize_inventory_unit(p_to_unit)
    or exists (
      select 1
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_from_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_to_unit)
    )
    or exists (
      select 1
      from public.inventory_unit_conversions c
      where public.normalize_inventory_unit(c.from_unit) = public.normalize_inventory_unit(p_to_unit)
        and public.normalize_inventory_unit(c.to_unit) = public.normalize_inventory_unit(p_from_unit)
    );
$$;

revoke all on function
  public.normalize_inventory_unit(text),
  public.resolve_inventory_unit_factor(text, text),
  public.has_inventory_unit_conversion(text, text)
from public;

grant execute on function
  public.normalize_inventory_unit(text),
  public.resolve_inventory_unit_factor(text, text),
  public.has_inventory_unit_conversion(text, text)
to authenticated;
