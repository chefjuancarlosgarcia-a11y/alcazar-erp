-- POS customers, delivery addresses, and sales channels.
-- Apply after 045_cash_sessions_and_movements.sql.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  notes text,
  source text not null default 'pos',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'Principal',
  address text not null,
  reference text,
  google_maps_url text,
  latitude numeric,
  longitude numeric,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pos_orders
  add column if not exists sales_channel text not null default 'dine_in'
  check (sales_channel in ('dine_in', 'takeout', 'delivery', 'online'));

alter table public.pos_orders
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_address_id uuid references public.customer_addresses(id) on delete set null,
  add column if not exists delivery_notes text,
  add column if not exists delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')),
  add column if not exists assigned_driver_id uuid references public.profiles(id) on delete set null,
  add column if not exists external_source text,
  add column if not exists external_order_id text;

create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_name_idx on public.customers (lower(full_name));
create index if not exists customer_addresses_customer_idx on public.customer_addresses (customer_id, is_default desc);
create index if not exists pos_orders_sales_channel_idx on public.pos_orders (sales_channel, created_at desc);
create index if not exists pos_orders_customer_idx on public.pos_orders (customer_id, created_at desc);
create index if not exists pos_orders_external_source_idx on public.pos_orders (external_source, external_order_id);

create or replace function public.can_operate_pos_orders()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'cajero', 'caja', 'mesero', 'servicio', 'supervisor')
      and status = 'active'
  );
$$;

revoke all on function public.can_operate_pos_orders() from public;
grant execute on function public.can_operate_pos_orders() to authenticated;

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;

grant select, insert, update on public.customers, public.customer_addresses to authenticated;
grant delete on public.customers, public.customer_addresses to authenticated;
grant all on public.customers, public.customer_addresses to service_role;

create or replace function public.can_access_pos_customers()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor', 'cajero', 'caja', 'mesero', 'servicio')
      and status = 'active'
  );
$$;

create or replace function public.can_manage_pos_customers()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor')
      and status = 'active'
  );
$$;

revoke all on function public.can_access_pos_customers(), public.can_manage_pos_customers() from public;
grant execute on function public.can_access_pos_customers(), public.can_manage_pos_customers() to authenticated;

drop policy if exists "customers_pos_read" on public.customers;
create policy "customers_pos_read" on public.customers
  for select to authenticated using (public.can_access_pos_customers());

drop policy if exists "customers_pos_insert" on public.customers;
create policy "customers_pos_insert" on public.customers
  for insert to authenticated with check (public.can_access_pos_customers());

drop policy if exists "customers_pos_update" on public.customers;
create policy "customers_pos_update" on public.customers
  for update to authenticated using (public.can_access_pos_customers()) with check (public.can_access_pos_customers());

drop policy if exists "customers_pos_delete" on public.customers;
create policy "customers_pos_delete" on public.customers
  for delete to authenticated using (public.can_manage_pos_customers());

drop policy if exists "customer_addresses_pos_read" on public.customer_addresses;
create policy "customer_addresses_pos_read" on public.customer_addresses
  for select to authenticated using (public.can_access_pos_customers());

drop policy if exists "customer_addresses_pos_insert" on public.customer_addresses;
create policy "customer_addresses_pos_insert" on public.customer_addresses
  for insert to authenticated with check (public.can_access_pos_customers());

drop policy if exists "customer_addresses_pos_update" on public.customer_addresses;
create policy "customer_addresses_pos_update" on public.customer_addresses
  for update to authenticated using (public.can_access_pos_customers()) with check (public.can_access_pos_customers());

drop policy if exists "customer_addresses_pos_delete" on public.customer_addresses;
create policy "customer_addresses_pos_delete" on public.customer_addresses
  for delete to authenticated using (public.can_manage_pos_customers());
