-- Supplier directory stored in Supabase.
-- Apply after 026_hr_profile_management_permissions.sql.

create extension if not exists pgcrypto;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  legal_name text,
  tax_id text,
  supplier_type text,
  contact_name text,
  phone text,
  phone_2 text,
  phone_3 text,
  whatsapp text,
  email text,
  website text,
  address text,
  delivery_days text[] not null default '{}',
  payment_methods jsonb not null default '{}'::jsonb,
  bank_account text,
  bank text,
  lead_time text,
  rating integer not null default 3 check (rating between 1 and 5),
  purchase_history jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists suppliers_name_unique
  on public.suppliers (lower(name));

alter table public.suppliers enable row level security;

grant select, insert, update on public.suppliers to authenticated;
grant all on public.suppliers to service_role;

create or replace function public.can_manage_suppliers()
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
      and public.normalize_profile_role(role) in (
        'admin',
        'gerente_general',
        'gerente',
        'encargado_almacen',
        'recursos_humanos'
      )
  );
$$;

revoke all on function public.can_manage_suppliers() from public;
grant execute on function public.can_manage_suppliers() to authenticated;

drop policy if exists "suppliers_authorized_select" on public.suppliers;
create policy "suppliers_authorized_select"
  on public.suppliers
  for select
  to authenticated
  using (public.can_manage_suppliers());

drop policy if exists "suppliers_authorized_insert" on public.suppliers;
create policy "suppliers_authorized_insert"
  on public.suppliers
  for insert
  to authenticated
  with check (
    public.can_manage_suppliers()
    and status = 'active'
  );

drop policy if exists "suppliers_authorized_update" on public.suppliers;
create policy "suppliers_authorized_update"
  on public.suppliers
  for update
  to authenticated
  using (public.can_manage_suppliers())
  with check (public.can_manage_suppliers());

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at
  before update on public.suppliers
  for each row execute procedure public.set_inventory_updated_at();
