-- Sanitize operational table statuses before persisting manual_status.
-- Apply after 065_pos_floor_plan_supabase.sql.

create or replace function public.sanitize_pos_floor_manual_status(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(trim(p_status), '') in ('disponible', 'ocupada', 'reservada', 'limpieza', 'inactiva')
      then trim(p_status)
    when coalesce(trim(p_status), '') in ('pagada', 'pago_en_proceso', 'esperando_cuenta')
      then 'disponible'
    when coalesce(trim(p_status), '') in ('en_servicio', 'nuevos_sin_enviar', 'en_produccion', 'lista_para_servir', 'problema')
      then 'ocupada'
    else 'disponible'
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
  safe_status text := public.sanitize_pos_floor_manual_status(p_manual_status);
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
    safe_status,
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

revoke all on function public.sanitize_pos_floor_manual_status(text) from public;
grant execute on function public.sanitize_pos_floor_manual_status(text) to authenticated;
