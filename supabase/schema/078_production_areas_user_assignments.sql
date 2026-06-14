-- Production areas view + user area assignments + KDS role alignment.
-- Uses existing public.areas (is_production_area) as the source of truth.

create or replace view public.production_areas as
select
  id,
  name,
  id as slug,
  coalesce(description, '') as description,
  active as is_active,
  sort_order,
  created_at,
  updated_at
from public.areas
where is_production_area = true;

grant select on public.production_areas to authenticated;

create table if not exists public.user_production_areas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  production_area_id text not null references public.areas(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (profile_id, production_area_id)
);

create index if not exists user_production_areas_profile_idx
  on public.user_production_areas (profile_id, is_active);

create index if not exists user_production_areas_area_idx
  on public.user_production_areas (production_area_id, is_active);

alter table public.user_production_areas enable row level security;

drop policy if exists "user_production_areas_read" on public.user_production_areas;
create policy "user_production_areas_read"
  on public.user_production_areas for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_profile_manager()
  );

drop policy if exists "user_production_areas_manage" on public.user_production_areas;
create policy "user_production_areas_manage"
  on public.user_production_areas for all to authenticated
  using (public.is_profile_manager())
  with check (public.is_profile_manager());

grant select, insert, update, delete on public.user_production_areas to authenticated;

-- Sync profile primary area into assignments when profile.area_id is a production area.
insert into public.user_production_areas (profile_id, production_area_id, is_active)
select p.id, p.area_id, true
from public.profiles p
join public.areas a on a.id = p.area_id and a.is_production_area = true and a.active = true
where p.status = 'active'
  and p.area_id is not null
on conflict (profile_id, production_area_id) do update
  set is_active = true;

create or replace function public.sync_user_production_area_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and coalesce(new.area_id, '') = coalesce(old.area_id, '') then
    return new;
  end if;

  if new.area_id is not null and exists (
    select 1 from public.areas a
    where a.id = new.area_id and a.is_production_area = true and a.active = true
  ) then
    insert into public.user_production_areas (profile_id, production_area_id, is_active)
    values (new.id, new.area_id, true)
    on conflict (profile_id, production_area_id) do update
      set is_active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_user_production_area_from_profile on public.profiles;
create trigger sync_user_production_area_from_profile
  after insert or update of area_id on public.profiles
  for each row execute procedure public.sync_user_production_area_from_profile();

-- Align KDS ticket operators with normalized operational roles.
create or replace function public.can_operate_production_tickets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'supervisor', 'mesero', 'caja', 'cajero', 'servicio',
        'cocina', 'pizzeria', 'barista', 'bartender', 'repostero', 'panadero', 'cafeteria',
        'encargado_area', 'gerente_operaciones'
      )
  );
$$;

grant execute on function public.can_operate_production_tickets() to authenticated;
