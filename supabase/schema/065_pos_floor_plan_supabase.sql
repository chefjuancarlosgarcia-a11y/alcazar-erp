-- Restaurant floor plan persistence (zones, tables, editor settings).
-- Apply after 064_pos_split_payments.sql.

create table if not exists public.pos_floor_zones (
  id text primary key,
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  width integer not null default 900 check (width >= 400),
  height integer not null default 520 check (height >= 300),
  created_by uuid references public.profiles(id) default auth.uid(),
  updated_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_floor_tables (
  id text primary key,
  zone_id text not null references public.pos_floor_zones(id) on delete cascade,
  name text not null,
  capacity integer not null default 4 check (capacity >= 1),
  shape text not null default 'square'
    check (shape in ('square', 'round', 'rectangular')),
  x numeric(8,3) not null default 50 check (x >= 0 and x <= 100),
  y numeric(8,3) not null default 50 check (y >= 0 and y <= 100),
  manual_status text not null default 'disponible'
    check (manual_status in ('disponible', 'ocupada', 'reservada', 'limpieza', 'inactiva')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) default auth.uid(),
  updated_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_floor_settings (
  id text primary key default 'default',
  snap_to_grid boolean not null default true,
  grid_size integer not null default 24 check (grid_size >= 8 and grid_size <= 96),
  zoom numeric(6,3) not null default 1 check (zoom >= 0.5 and zoom <= 2),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_floor_tables_zone_idx
  on public.pos_floor_tables (zone_id, sort_order, name);
create index if not exists pos_floor_zones_sort_idx
  on public.pos_floor_zones (sort_order, name);

alter table public.pos_floor_zones enable row level security;
alter table public.pos_floor_tables enable row level security;
alter table public.pos_floor_settings enable row level security;

grant select on public.pos_floor_zones, public.pos_floor_tables, public.pos_floor_settings to authenticated;
grant all on public.pos_floor_zones, public.pos_floor_tables, public.pos_floor_settings to service_role;

create or replace function public.can_read_pos_floor_plan()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_operate_pos_orders()
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and status = 'active'
        and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente', 'gerente_operaciones', 'supervisor', 'cajero', 'caja', 'mesero', 'servicio')
    );
$$;

create or replace function public.can_manage_pos_floor_plan()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente', 'gerente_operaciones', 'supervisor')
  );
$$;

drop policy if exists "pos_floor_zones_read" on public.pos_floor_zones;
create policy "pos_floor_zones_read"
  on public.pos_floor_zones for select to authenticated
  using (public.can_read_pos_floor_plan());

drop policy if exists "pos_floor_zones_manage" on public.pos_floor_zones;
create policy "pos_floor_zones_manage"
  on public.pos_floor_zones for all to authenticated
  using (public.can_manage_pos_floor_plan())
  with check (public.can_manage_pos_floor_plan());

drop policy if exists "pos_floor_tables_read" on public.pos_floor_tables;
create policy "pos_floor_tables_read"
  on public.pos_floor_tables for select to authenticated
  using (public.can_read_pos_floor_plan());

drop policy if exists "pos_floor_tables_manage" on public.pos_floor_tables;
create policy "pos_floor_tables_manage"
  on public.pos_floor_tables for all to authenticated
  using (public.can_manage_pos_floor_plan())
  with check (public.can_manage_pos_floor_plan());

drop policy if exists "pos_floor_settings_read" on public.pos_floor_settings;
create policy "pos_floor_settings_read"
  on public.pos_floor_settings for select to authenticated
  using (public.can_read_pos_floor_plan());

drop policy if exists "pos_floor_settings_manage" on public.pos_floor_settings;
create policy "pos_floor_settings_manage"
  on public.pos_floor_settings for all to authenticated
  using (public.can_manage_pos_floor_plan())
  with check (public.can_manage_pos_floor_plan());

create or replace function public.pos_floor_has_open_orders(
  p_table_id text default null,
  p_area_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.status not in ('paid', 'cancelled')
      and (
        (p_table_id is not null and o.table_id = p_table_id)
        or (p_area_id is not null and o.area_id = p_area_id)
      )
  );
$$;

create or replace function public.get_pos_floor_layout()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.can_read_pos_floor_plan() then
    raise exception 'No tienes permiso para consultar el plano del restaurante.';
  end if;

  select jsonb_build_object(
    'areas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', z.id,
          'name', z.name,
          'nombre', z.name,
          'description', coalesce(z.description, ''),
          'sortOrder', z.sort_order,
          'active', z.active,
          'width', z.width,
          'height', z.height,
          'mesasTotales', (
            select count(*)
            from public.pos_floor_tables t
            where t.zone_id = z.id and t.active = true
          )
        )
        order by z.sort_order, z.name
      )
      from public.pos_floor_zones z
      where z.active = true
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'areaId', t.zone_id,
          'zone_id', t.zone_id,
          'name', t.name,
          'numero', regexp_replace(t.name, '^[Mm]', ''),
          'capacity', t.capacity,
          'capacidad', t.capacity,
          'shape', t.shape,
          'x', t.x,
          'y', t.y,
          'status', t.manual_status,
          'estado', t.manual_status,
          'manual_status', t.manual_status,
          'sortOrder', t.sort_order,
          'active', t.active
        )
        order by t.zone_id, t.sort_order, t.name
      )
      from public.pos_floor_tables t
      join public.pos_floor_zones z on z.id = t.zone_id
      where t.active = true and z.active = true
    ), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_build_object(
        'snapToGrid', s.snap_to_grid,
        'gridSize', s.grid_size,
        'zoom', s.zoom
      )
      from public.pos_floor_settings s
      where s.id = 'default'
    ), jsonb_build_object('snapToGrid', true, 'gridSize', 24, 'zoom', 1))
  ) into result;

  return result;
end;
$$;

create or replace function public.upsert_pos_floor_zone(
  p_id text,
  p_name text,
  p_description text default '',
  p_sort_order integer default 0,
  p_active boolean default true,
  p_width integer default 900,
  p_height integer default 520
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone_row public.pos_floor_zones;
begin
  if not public.can_manage_pos_floor_plan() then
    raise exception 'No tienes permiso para editar el plano del restaurante.';
  end if;

  if coalesce(trim(p_id), '') = '' then
    raise exception 'El id de la zona es obligatorio.';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'El nombre de la zona es obligatorio.';
  end if;

  insert into public.pos_floor_zones (
    id, name, description, sort_order, active, width, height, created_by, updated_by
  ) values (
    trim(p_id),
    trim(p_name),
    coalesce(trim(p_description), ''),
    coalesce(p_sort_order, 0),
    coalesce(p_active, true),
    greatest(400, coalesce(p_width, 900)),
    greatest(300, coalesce(p_height, 520)),
    auth.uid(),
    auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    active = excluded.active,
    width = excluded.width,
    height = excluded.height,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into zone_row;

  return jsonb_build_object(
    'id', zone_row.id,
    'name', zone_row.name,
    'description', zone_row.description,
    'sortOrder', zone_row.sort_order,
    'active', zone_row.active,
    'width', zone_row.width,
    'height', zone_row.height
  );
end;
$$;

create or replace function public.upsert_pos_floor_table(
  p_id text,
  p_zone_id text,
  p_name text,
  p_capacity integer default 4,
  p_shape text default 'square',
  p_x numeric default 50,
  p_y numeric default 50,
  p_manual_status text default 'disponible',
  p_sort_order integer default 0,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.pos_floor_tables;
begin
  if not public.can_manage_pos_floor_plan() then
    raise exception 'No tienes permiso para editar el plano del restaurante.';
  end if;

  if coalesce(trim(p_id), '') = '' or coalesce(trim(p_zone_id), '') = '' then
    raise exception 'El id de mesa y la zona son obligatorios.';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'El nombre de la mesa es obligatorio.';
  end if;

  if not exists (select 1 from public.pos_floor_zones where id = trim(p_zone_id)) then
    raise exception 'La zona fisica no existe.';
  end if;

  insert into public.pos_floor_tables (
    id, zone_id, name, capacity, shape, x, y, manual_status, sort_order, active, created_by, updated_by
  ) values (
    trim(p_id),
    trim(p_zone_id),
    trim(p_name),
    greatest(1, coalesce(p_capacity, 4)),
    coalesce(nullif(trim(p_shape), ''), 'square'),
    least(100, greatest(0, coalesce(p_x, 50))),
    least(100, greatest(0, coalesce(p_y, 50))),
    coalesce(nullif(trim(p_manual_status), ''), 'disponible'),
    coalesce(p_sort_order, 0),
    coalesce(p_active, true),
    auth.uid(),
    auth.uid()
  )
  on conflict (id) do update set
    zone_id = excluded.zone_id,
    name = excluded.name,
    capacity = excluded.capacity,
    shape = excluded.shape,
    x = excluded.x,
    y = excluded.y,
    manual_status = excluded.manual_status,
    sort_order = excluded.sort_order,
    active = excluded.active,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into table_row;

  return jsonb_build_object(
    'id', table_row.id,
    'areaId', table_row.zone_id,
    'name', table_row.name,
    'capacity', table_row.capacity,
    'shape', table_row.shape,
    'x', table_row.x,
    'y', table_row.y,
    'status', table_row.manual_status,
    'sortOrder', table_row.sort_order,
    'active', table_row.active
  );
end;
$$;

create or replace function public.delete_pos_floor_zone(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_pos_floor_plan() then
    raise exception 'No tienes permiso para editar el plano del restaurante.';
  end if;

  if coalesce(trim(p_id), '') = '' then
    raise exception 'La zona es obligatoria.';
  end if;

  if public.pos_floor_has_open_orders(null, trim(p_id)) then
    raise exception 'No puedes eliminar esta zona porque tiene ordenes abiertas.';
  end if;

  update public.pos_floor_tables
  set active = false, updated_by = auth.uid(), updated_at = now()
  where zone_id = trim(p_id) and active = true;

  update public.pos_floor_zones
  set active = false, updated_by = auth.uid(), updated_at = now()
  where id = trim(p_id);

  if not found then
    raise exception 'Zona no encontrada.';
  end if;

  return jsonb_build_object('id', trim(p_id), 'deleted', true);
end;
$$;

create or replace function public.delete_pos_floor_table(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_pos_floor_plan() then
    raise exception 'No tienes permiso para editar el plano del restaurante.';
  end if;

  if coalesce(trim(p_id), '') = '' then
    raise exception 'La mesa es obligatoria.';
  end if;

  if public.pos_floor_has_open_orders(trim(p_id), null) then
    raise exception 'No puedes eliminar esta mesa porque tiene una orden abierta.';
  end if;

  update public.pos_floor_tables
  set active = false, updated_by = auth.uid(), updated_at = now()
  where id = trim(p_id) and active = true;

  if not found then
    raise exception 'Mesa no encontrada.';
  end if;

  return jsonb_build_object('id', trim(p_id), 'deleted', true);
end;
$$;

create or replace function public.save_pos_floor_layout(p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone_row jsonb;
  table_row jsonb;
  settings_row jsonb;
  zone_ids text[] := '{}';
  table_ids text[] := '{}';
begin
  if not public.can_manage_pos_floor_plan() then
    raise exception 'No tienes permiso para editar el plano del restaurante.';
  end if;

  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception 'Layout invalido.';
  end if;

  for zone_row in
    select value
    from jsonb_array_elements(coalesce(p_layout -> 'areas', '[]'::jsonb))
  loop
    perform public.upsert_pos_floor_zone(
      zone_row ->> 'id',
      coalesce(zone_row ->> 'name', zone_row ->> 'nombre'),
      coalesce(zone_row ->> 'description', ''),
      coalesce((zone_row ->> 'sortOrder')::integer, (zone_row ->> 'sort_order')::integer, 0),
      coalesce((zone_row ->> 'active')::boolean, true),
      coalesce((zone_row ->> 'width')::integer, 900),
      coalesce((zone_row ->> 'height')::integer, 520)
    );
    zone_ids := array_append(zone_ids, zone_row ->> 'id');
  end loop;

  for table_row in
    select value
    from jsonb_array_elements(coalesce(p_layout -> 'tables', '[]'::jsonb))
  loop
    perform public.upsert_pos_floor_table(
      table_row ->> 'id',
      coalesce(table_row ->> 'areaId', table_row ->> 'zone_id'),
      table_row ->> 'name',
      coalesce((table_row ->> 'capacity')::integer, (table_row ->> 'capacidad')::integer, 4),
      coalesce(table_row ->> 'shape', 'square'),
      coalesce((table_row ->> 'x')::numeric, 50),
      coalesce((table_row ->> 'y')::numeric, 50),
      coalesce(table_row ->> 'manual_status', table_row ->> 'status', 'disponible'),
      coalesce((table_row ->> 'sortOrder')::integer, (table_row ->> 'sort_order')::integer, 0),
      coalesce((table_row ->> 'active')::boolean, true)
    );
    table_ids := array_append(table_ids, table_row ->> 'id');
  end loop;

  settings_row := coalesce(p_layout -> 'settings', '{}'::jsonb);
  insert into public.pos_floor_settings (id, snap_to_grid, grid_size, zoom, updated_by)
  values (
    'default',
    coalesce((settings_row ->> 'snapToGrid')::boolean, true),
    greatest(8, coalesce((settings_row ->> 'gridSize')::integer, 24)),
    least(2, greatest(0.5, coalesce((settings_row ->> 'zoom')::numeric, 1))),
    auth.uid()
  )
  on conflict (id) do update set
    snap_to_grid = excluded.snap_to_grid,
    grid_size = excluded.grid_size,
    zoom = excluded.zoom,
    updated_by = auth.uid(),
    updated_at = now();

  update public.pos_floor_zones
  set active = false, updated_by = auth.uid(), updated_at = now()
  where active = true
    and (cardinality(zone_ids) = 0 or id <> all(zone_ids));

  update public.pos_floor_tables
  set active = false, updated_by = auth.uid(), updated_at = now()
  where active = true
    and (cardinality(table_ids) = 0 or id <> all(table_ids));

  return public.get_pos_floor_layout();
end;
$$;

create or replace function public.migrate_local_floor_layout(p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_pos_floor_plan() then
    raise exception 'No tienes permiso para migrar el plano del restaurante.';
  end if;

  return public.save_pos_floor_layout(p_layout);
end;
$$;

revoke all on function
  public.can_read_pos_floor_plan(),
  public.can_manage_pos_floor_plan(),
  public.pos_floor_has_open_orders(text, text),
  public.get_pos_floor_layout(),
  public.upsert_pos_floor_zone(text, text, text, integer, boolean, integer, integer),
  public.upsert_pos_floor_table(text, text, text, integer, text, numeric, numeric, text, integer, boolean),
  public.delete_pos_floor_zone(text),
  public.delete_pos_floor_table(text),
  public.save_pos_floor_layout(jsonb),
  public.migrate_local_floor_layout(jsonb)
from public;

grant execute on function
  public.can_read_pos_floor_plan(),
  public.can_manage_pos_floor_plan(),
  public.get_pos_floor_layout()
to authenticated;

grant execute on function
  public.upsert_pos_floor_zone(text, text, text, integer, boolean, integer, integer),
  public.upsert_pos_floor_table(text, text, text, integer, text, numeric, numeric, text, integer, boolean),
  public.delete_pos_floor_zone(text),
  public.delete_pos_floor_table(text),
  public.save_pos_floor_layout(jsonb),
  public.migrate_local_floor_layout(jsonb)
to authenticated;
