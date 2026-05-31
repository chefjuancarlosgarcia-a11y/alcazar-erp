-- Executive reports phase 1: fixed costs and CEO access.
-- Apply after 021_recipe_steps_unit_conversions.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin', 'ceo', 'gerente_general', 'gerente', 'encargado_almacen', 'rrhh', 'supervisor',
    'cajero', 'mesero', 'cocinero', 'pizzero', 'barista', 'bartender',
    'repostero', 'panadero', 'colaborador'
  ));

create or replace function public.is_profile_manager()
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
      and role in ('admin', 'ceo', 'gerente_general')
      and status = 'active'
  );
$$;

create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in (
    'alquiler', 'energia_electrica', 'agua', 'internet', 'telefonia',
    'seguridad', 'software', 'mantenimiento', 'otros'
  )),
  monthly_amount numeric not null default 0 check (monthly_amount >= 0),
  start_date date,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fixed_costs enable row level security;

grant select, insert, update on public.fixed_costs to authenticated;
grant all on public.fixed_costs to service_role;

create or replace function public.set_fixed_cost_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_fixed_cost_updated_at on public.fixed_costs;
create trigger set_fixed_cost_updated_at
  before update on public.fixed_costs
  for each row execute procedure public.set_fixed_cost_updated_at();

drop policy if exists "fixed_costs_executive_read" on public.fixed_costs;
create policy "fixed_costs_executive_read"
  on public.fixed_costs for select to authenticated
  using (public.current_profile_role() in ('admin', 'ceo', 'gerente_general'));

drop policy if exists "fixed_costs_executive_write" on public.fixed_costs;
create policy "fixed_costs_executive_write"
  on public.fixed_costs for all to authenticated
  using (public.current_profile_role() in ('admin', 'ceo', 'gerente_general'))
  with check (public.current_profile_role() in ('admin', 'ceo', 'gerente_general'));
