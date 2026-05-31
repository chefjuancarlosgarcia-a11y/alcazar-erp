-- Notifications for purchase orders and support for the Gerente role.
-- Apply after 017_inventory_initial_stock_warehouse_only.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin', 'gerente_general', 'gerente', 'encargado_almacen', 'rrhh', 'supervisor',
    'cajero', 'mesero', 'cocinero', 'pizzero', 'barista', 'bartender',
    'repostero', 'panadero', 'colaborador'
  ));

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  target_role text,
  type text not null,
  title text not null,
  message text not null,
  entity_type text,
  entity_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_id is not null or target_role is not null)
);

create table if not exists public.purchase_orders (
  id text primary key,
  order_number text not null,
  status text not null check (status in (
    'borrador', 'pendiente_aprobacion', 'aprobada', 'rechazada',
    'enviada_proveedor', 'recibida_parcial', 'recibida_completa', 'cancelada'
  )),
  data jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_by_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);

create index if not exists notifications_role_unread_idx
  on public.notifications (target_role, is_read, created_at desc);

alter table public.notifications enable row level security;
alter table public.purchase_orders enable row level security;
grant select on public.notifications to authenticated;
grant select on public.purchase_orders to authenticated;
grant all on public.notifications to service_role;
grant all on public.purchase_orders to service_role;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and status = 'active';
$$;

revoke all on function public.current_profile_role() from public;
grant execute on function public.current_profile_role() to authenticated;

drop policy if exists "notifications_read_recipients" on public.notifications;
create policy "notifications_read_recipients"
  on public.notifications for select to authenticated
  using (
    user_id = auth.uid()
    or target_role = public.current_profile_role()
  );

drop policy if exists "purchase_orders_operational_read" on public.purchase_orders;
create policy "purchase_orders_operational_read"
  on public.purchase_orders for select to authenticated
  using (public.current_profile_role() in ('admin', 'gerente_general', 'gerente', 'encargado_almacen'));

create or replace function public.create_notification(
  p_user_id uuid,
  p_target_role text,
  p_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null
)
returns public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  inserted_notification public.notifications;
begin
  actor_role := public.current_profile_role();
  if actor_role is null then
    raise exception 'No tienes permiso para generar notificaciones.';
  end if;

  if p_user_id is null and nullif(trim(p_target_role), '') is null then
    raise exception 'La notificacion debe tener un destinatario.';
  end if;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id
  )
  values (
    p_user_id, nullif(trim(p_target_role), ''), p_type, p_title, p_message,
    nullif(trim(p_entity_type), ''), nullif(trim(p_entity_id), '')
  )
  returning * into inserted_notification;

  return inserted_notification;
end;
$$;

revoke all on function public.create_notification(uuid,text,text,text,text,text,text) from public;
grant execute on function public.create_notification(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
  set is_read = true
  where id = p_notification_id
    and (
      user_id = auth.uid()
      or target_role = public.current_profile_role()
    );
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.save_purchase_order(p_data jsonb)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_profile_role();
  order_id text := nullif(trim(p_data ->> 'id'), '');
  next_status text := nullif(trim(p_data ->> 'status'), '');
  current_order public.purchase_orders;
  saved_order public.purchase_orders;
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'encargado_almacen') then
    raise exception 'No tienes permiso para operar ordenes de compra.';
  end if;
  if order_id is null or nullif(trim(p_data ->> 'numeroOrden'), '') is null then
    raise exception 'La orden no contiene identificador o numero.';
  end if;

  select * into current_order from public.purchase_orders where id = order_id;

  if current_order.id is null then
    if actor_role in ('gerente', 'encargado_almacen') then
      next_status := 'pendiente_aprobacion';
      p_data := jsonb_set(p_data, '{status}', to_jsonb(next_status));
    end if;
    insert into public.purchase_orders (
      id, order_number, status, data, created_by, created_by_role
    )
    values (
      order_id, p_data ->> 'numeroOrden', next_status, p_data, auth.uid(), actor_role
    )
    returning * into saved_order;
    return saved_order;
  end if;

  if current_order.status <> next_status then
    if next_status in ('aprobada', 'rechazada') and actor_role not in ('admin', 'gerente_general') then
      raise exception 'Solo Admin o Gerente General pueden aprobar o rechazar ordenes.';
    elsif next_status = 'enviada_proveedor' and current_order.status <> 'aprobada' then
      raise exception 'Solo una orden aprobada puede enviarse al proveedor.';
    elsif next_status in ('recibida_parcial', 'recibida_completa')
      and (actor_role not in ('admin', 'gerente_general', 'encargado_almacen')
        or current_order.status not in ('aprobada', 'enviada_proveedor')) then
      raise exception 'La orden no esta lista para recepcion.';
    end if;
  end if;

  update public.purchase_orders
  set
    order_number = p_data ->> 'numeroOrden',
    status = next_status,
    data = p_data,
    updated_at = now()
  where id = order_id
  returning * into saved_order;

  return saved_order;
end;
$$;

revoke all on function public.save_purchase_order(jsonb) from public;
grant execute on function public.save_purchase_order(jsonb) to authenticated;

alter table public.notifications replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
