-- Finance accounting Phase 2A-1 — multibranch foundation
-- Apply after 202_finance_accounting_chart_of_accounts.sql
-- Number 203: avoids FELplex reserved 201 and follows 202 chart of accounts.
--
-- Adds branches (canonical org sites), cost centers, accounting periods,
-- and dimension rules on chart accounts. No journal entries in this phase.

-- ---------------------------------------------------------------------------
-- Permissions (granular capabilities — backend authority via RPC/RLS)
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_accounting_structure()
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
      and public.normalize_profile_role(p.role) in ('admin', 'contador')
  );
$$;

create or replace function public.can_manage_accounting_periods()
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
      and public.normalize_profile_role(p.role) in ('admin', 'contador')
  );
$$;

create or replace function public.can_close_accounting_period()
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
      and public.normalize_profile_role(p.role) in ('admin', 'contador')
  );
$$;

create or replace function public.can_reopen_accounting_period()
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
      and public.normalize_profile_role(p.role) in ('admin', 'contador', 'gerente_general')
  );
$$;

revoke all on function public.can_manage_accounting_structure() from public;
revoke all on function public.can_manage_accounting_periods() from public;
revoke all on function public.can_close_accounting_period() from public;
revoke all on function public.can_reopen_accounting_period() from public;
grant execute on function public.can_manage_accounting_structure() to authenticated;
grant execute on function public.can_manage_accounting_periods() to authenticated;
grant execute on function public.can_close_accounting_period() to authenticated;
grant execute on function public.can_reopen_accounting_period() to authenticated;

-- ---------------------------------------------------------------------------
-- Branches (canonical — shared across ERP modules)
-- ---------------------------------------------------------------------------

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  legal_name text,
  address text not null default '',
  timezone text not null default 'America/Guatemala',
  is_main boolean not null default false,
  is_active boolean not null default true,
  opened_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists branches_code_unique_idx on public.branches (code);
create unique index if not exists branches_one_main_active_idx
  on public.branches ((true))
  where is_main = true and is_active = true;
create index if not exists branches_active_idx on public.branches (is_active, code);

drop trigger if exists branches_updated_at on public.branches;
create trigger branches_updated_at
  before update on public.branches
  for each row execute function public.finance_set_updated_at();

alter table public.branches enable row level security;

revoke all on table public.branches from public;
revoke all on table public.branches from anon;
revoke all on table public.branches from authenticated;
grant select, insert, update on table public.branches to authenticated;
grant all on table public.branches to service_role;

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select to authenticated
  using (public.can_view_finance());

drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches
  for insert to authenticated
  with check (public.can_manage_accounting_structure());

drop policy if exists branches_update on public.branches;
create policy branches_update on public.branches
  for update to authenticated
  using (public.can_manage_accounting_structure())
  with check (public.can_manage_accounting_structure());

-- ---------------------------------------------------------------------------
-- Cost centers
-- ---------------------------------------------------------------------------

create table if not exists public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  parent_id uuid references public.finance_cost_centers(id) on delete restrict,
  level smallint not null check (level >= 1 and level <= 32),
  branch_id uuid references public.branches(id) on delete restrict,
  maps_to_area_id text references public.areas(id) on delete set null,
  account_kind text not null default 'detail'
    check (account_kind in ('header', 'detail')),
  is_active boolean not null default true,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint finance_cost_centers_header_no_branch_maps
    check (account_kind <> 'header' or maps_to_area_id is null)
);

create unique index if not exists finance_cost_centers_code_unique_idx
  on public.finance_cost_centers (code);
create index if not exists finance_cost_centers_parent_idx
  on public.finance_cost_centers (parent_id);
create index if not exists finance_cost_centers_branch_idx
  on public.finance_cost_centers (branch_id, is_active);
create index if not exists finance_cost_centers_area_idx
  on public.finance_cost_centers (maps_to_area_id);

drop trigger if exists finance_cost_centers_updated_at on public.finance_cost_centers;
create trigger finance_cost_centers_updated_at
  before update on public.finance_cost_centers
  for each row execute function public.finance_set_updated_at();

alter table public.finance_cost_centers enable row level security;

revoke all on table public.finance_cost_centers from public;
revoke all on table public.finance_cost_centers from anon;
revoke all on table public.finance_cost_centers from authenticated;
grant select, insert, update on table public.finance_cost_centers to authenticated;
grant all on table public.finance_cost_centers to service_role;

drop policy if exists finance_cost_centers_select on public.finance_cost_centers;
create policy finance_cost_centers_select on public.finance_cost_centers
  for select to authenticated
  using (public.can_view_finance());

drop policy if exists finance_cost_centers_insert on public.finance_cost_centers;
create policy finance_cost_centers_insert on public.finance_cost_centers
  for insert to authenticated
  with check (public.can_manage_accounting_structure());

drop policy if exists finance_cost_centers_update on public.finance_cost_centers;
create policy finance_cost_centers_update on public.finance_cost_centers
  for update to authenticated
  using (public.can_manage_accounting_structure())
  with check (public.can_manage_accounting_structure());

-- ---------------------------------------------------------------------------
-- Accounting periods (calendar months)
-- ---------------------------------------------------------------------------

create table if not exists public.finance_accounting_periods (
  id uuid primary key default gen_random_uuid(),
  period_year integer not null check (period_year >= 2000 and period_year <= 2100),
  period_month integer not null check (period_month >= 1 and period_month <= 12),
  start_date date not null,
  end_date date not null,
  status text not null default 'open'
    check (status in ('open', 'soft_closed', 'closed')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null,
  reopen_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint finance_accounting_periods_year_month_unique unique (period_year, period_month),
  constraint finance_accounting_periods_dates_check check (start_date <= end_date)
);

create index if not exists finance_accounting_periods_status_idx
  on public.finance_accounting_periods (status, period_year desc, period_month desc);

drop trigger if exists finance_accounting_periods_updated_at on public.finance_accounting_periods;
create trigger finance_accounting_periods_updated_at
  before update on public.finance_accounting_periods
  for each row execute function public.finance_set_updated_at();

alter table public.finance_accounting_periods enable row level security;

revoke all on table public.finance_accounting_periods from public;
revoke all on table public.finance_accounting_periods from anon;
revoke all on table public.finance_accounting_periods from authenticated;
grant select, insert, update on table public.finance_accounting_periods to authenticated;
grant all on table public.finance_accounting_periods to service_role;

drop policy if exists finance_accounting_periods_select on public.finance_accounting_periods;
create policy finance_accounting_periods_select on public.finance_accounting_periods
  for select to authenticated
  using (public.can_view_finance());

drop policy if exists finance_accounting_periods_insert on public.finance_accounting_periods;
create policy finance_accounting_periods_insert on public.finance_accounting_periods
  for insert to authenticated
  with check (public.can_manage_accounting_periods());

drop policy if exists finance_accounting_periods_update on public.finance_accounting_periods;
create policy finance_accounting_periods_update on public.finance_accounting_periods
  for update to authenticated
  using (
    public.can_manage_accounting_periods()
    or public.can_close_accounting_period()
    or public.can_reopen_accounting_period()
  )
  with check (
    public.can_manage_accounting_periods()
    or public.can_close_accounting_period()
    or public.can_reopen_accounting_period()
  );

-- ---------------------------------------------------------------------------
-- Chart account dimension rules (additive)
-- ---------------------------------------------------------------------------

alter table public.finance_chart_accounts
  add column if not exists branch_dimension_rule text,
  add column if not exists cost_center_dimension_rule text;

update public.finance_chart_accounts
set
  branch_dimension_rule = coalesce(branch_dimension_rule, case financial_type
    when 'income' then 'required'
    when 'cost' then 'required'
    when 'expense' then 'required'
    when 'equity' then 'prohibited'
    else 'optional'
  end),
  cost_center_dimension_rule = coalesce(cost_center_dimension_rule, case financial_type
    when 'equity' then 'prohibited'
    else 'optional'
  end)
where branch_dimension_rule is null or cost_center_dimension_rule is null;

alter table public.finance_chart_accounts
  alter column branch_dimension_rule set default 'optional',
  alter column branch_dimension_rule set not null,
  alter column cost_center_dimension_rule set default 'optional',
  alter column cost_center_dimension_rule set not null;

alter table public.finance_chart_accounts
  drop constraint if exists finance_chart_accounts_branch_dimension_rule_check;
alter table public.finance_chart_accounts
  add constraint finance_chart_accounts_branch_dimension_rule_check
    check (branch_dimension_rule in ('required', 'optional', 'prohibited'));

alter table public.finance_chart_accounts
  drop constraint if exists finance_chart_accounts_cost_center_dimension_rule_check;
alter table public.finance_chart_accounts
  add constraint finance_chart_accounts_cost_center_dimension_rule_check
    check (cost_center_dimension_rule in ('required', 'optional', 'prohibited'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.branch_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(trim(coalesce(p_code, ''))), '');
$$;

create or replace function public.finance_cost_center_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(trim(coalesce(p_code, ''))), '');
$$;

create or replace function public.finance_cost_center_assert_branch_hierarchy(
  p_parent_id uuid,
  p_branch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent_branch uuid;
begin
  if p_parent_id is null then
    return;
  end if;

  select branch_id into v_parent_branch
  from public.finance_cost_centers
  where id = p_parent_id;

  if not found then
    raise exception 'El centro de costo padre no existe.';
  end if;

  if v_parent_branch is null then
    return;
  end if;

  if p_branch_id is null or p_branch_id <> v_parent_branch then
    raise exception 'El centro de costo debe pertenecer a la misma sucursal que su padre corporativo.';
  end if;
end;
$$;

create or replace function public.finance_chart_account_default_branch_dimension_rule(p_financial_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_financial_type, ''))
    when 'income' then 'required'
    when 'cost' then 'required'
    when 'expense' then 'required'
    when 'equity' then 'prohibited'
    else 'optional'
  end;
$$;

create or replace function public.finance_chart_account_default_cost_center_dimension_rule(p_financial_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_financial_type, ''))
    when 'equity' then 'prohibited'
    else 'optional'
  end;
$$;

create or replace function public.finance_chart_account_validate_dimension_rule(p_rule text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rule text := lower(trim(coalesce(p_rule, '')));
begin
  if v_rule not in ('required', 'optional', 'prohibited') then
    raise exception 'Regla dimensional inválida: %.', coalesce(p_rule, '');
  end if;
  return v_rule;
end;
$$;

create or replace function public.finance_cost_center_parent_level(p_parent_id uuid)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level smallint;
begin
  if p_parent_id is null then return 0; end if;
  select level into v_level from public.finance_cost_centers where id = p_parent_id;
  if not found then raise exception 'El centro de costo padre no existe.'; end if;
  return v_level;
end;
$$;

create or replace function public.finance_cost_center_assert_no_cycle(p_id uuid, p_parent_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current uuid := p_parent_id;
begin
  if p_parent_id is null then return; end if;
  if p_id is not null and p_parent_id = p_id then
    raise exception 'Un centro de costo no puede ser su propio padre.';
  end if;
  while v_current is not null loop
    if p_id is not null and v_current = p_id then
      raise exception 'La jerarquía de centros de costo genera un ciclo inválido.';
    end if;
    select parent_id into v_current from public.finance_cost_centers where id = v_current;
  end loop;
end;
$$;

create or replace function public.finance_accounting_period_bounds(
  p_year integer,
  p_month integer,
  out p_start date,
  out p_end date
)
returns record
language sql
immutable
set search_path = ''
as $$
  select
    make_date(p_year, p_month, 1),
    (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
$$;

create or replace function public.branch_row_to_json(p_row public.branches)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'code', p_row.code,
    'name', p_row.name,
    'legal_name', p_row.legal_name,
    'address', p_row.address,
    'timezone', p_row.timezone,
    'is_main', p_row.is_main,
    'is_active', p_row.is_active,
    'opened_at', p_row.opened_at,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by
  );
$$;

create or replace function public.finance_cost_center_row_to_json(p_row public.finance_cost_centers)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'code', p_row.code,
    'name', p_row.name,
    'parent_id', p_row.parent_id,
    'parent_code', (select parent.code from public.finance_cost_centers parent where parent.id = p_row.parent_id),
    'level', p_row.level,
    'branch_id', p_row.branch_id,
    'branch_code', (select b.code from public.branches b where b.id = p_row.branch_id),
    'maps_to_area_id', p_row.maps_to_area_id,
    'account_kind', p_row.account_kind,
    'is_active', p_row.is_active,
    'description', p_row.description,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by,
    'has_children', exists (
      select 1 from public.finance_cost_centers child where child.parent_id = p_row.id
    )
  );
$$;

create or replace function public.finance_accounting_period_row_to_json(p_row public.finance_accounting_periods)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'period_year', p_row.period_year,
    'period_month', p_row.period_month,
    'start_date', p_row.start_date,
    'end_date', p_row.end_date,
    'status', p_row.status,
    'closed_at', p_row.closed_at,
    'closed_by', p_row.closed_by,
    'reopened_at', p_row.reopened_at,
    'reopened_by', p_row.reopened_by,
    'reopen_reason', p_row.reopen_reason,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by
  );
$$;

create or replace function public.finance_chart_account_row_to_json(p_row public.finance_chart_accounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'code', p_row.code,
    'name', p_row.name,
    'parent_id', p_row.parent_id,
    'parent_code', (select parent.code from public.finance_chart_accounts parent where parent.id = p_row.parent_id),
    'level', p_row.level,
    'financial_type', p_row.financial_type,
    'natural_balance', p_row.natural_balance,
    'account_kind', p_row.account_kind,
    'accepts_entries', p_row.accepts_entries,
    'is_active', p_row.is_active,
    'description', p_row.description,
    'branch_dimension_rule', p_row.branch_dimension_rule,
    'cost_center_dimension_rule', p_row.cost_center_dimension_rule,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by,
    'has_children', exists (
      select 1 from public.finance_chart_accounts child where child.parent_id = p_row.id
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Branch RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_branches(
  p_search text default null,
  p_is_active boolean default null,
  p_include_inactive boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver sucursales.';
  end if;
  return coalesce((
    select jsonb_agg(public.branch_row_to_json(b) order by b.is_main desc, b.code)
    from public.branches b
    where (p_include_inactive or b.is_active)
      and (p_is_active is null or b.is_active = p_is_active)
      and (
        p_search is null or trim(p_search) = ''
        or b.code ilike '%' || trim(p_search) || '%'
        or b.name ilike '%' || trim(p_search) || '%'
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_branch(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.branch_normalize_code(p_data ->> 'code');
  v_name text := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  v_row public.branches;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar sucursales.';
  end if;
  if v_code is null then raise exception 'El código de sucursal es obligatorio.'; end if;
  if v_name is null then raise exception 'El nombre de sucursal es obligatorio.'; end if;
  if exists (select 1 from public.branches where code = v_code) then
    raise exception 'El código % ya existe en sucursales.', v_code;
  end if;

  insert into public.branches (
    code, name, legal_name, address, timezone, is_main, is_active, opened_at, created_by, updated_by
  )
  values (
    v_code,
    v_name,
    nullif(trim(p_data ->> 'legal_name'), ''),
    coalesce(nullif(trim(p_data ->> 'address'), ''), ''),
    coalesce(nullif(trim(p_data ->> 'timezone'), ''), 'America/Guatemala'),
    false,
    coalesce((p_data ->> 'is_active')::boolean, true),
    nullif(p_data ->> 'opened_at', '')::date,
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  return public.branch_row_to_json(v_row);
end;
$$;

create or replace function public.update_branch(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.branches;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar sucursales.';
  end if;

  select * into v_row from public.branches where id = p_id for update;
  if not found then raise exception 'Sucursal no encontrada.'; end if;

  if p_data ? 'is_main' then
    raise exception 'Use set_branch_main para cambiar la sucursal principal.';
  end if;

  if v_row.is_main and coalesce((p_data ->> 'is_active')::boolean, v_row.is_active) = false then
    raise exception 'No se puede desactivar la sucursal principal.';
  end if;

  update public.branches
  set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    legal_name = case when p_data ? 'legal_name' then nullif(trim(p_data ->> 'legal_name'), '') else legal_name end,
    address = coalesce(nullif(trim(p_data ->> 'address'), ''), address),
    timezone = coalesce(nullif(trim(p_data ->> 'timezone'), ''), timezone),
    is_active = coalesce((p_data ->> 'is_active')::boolean, is_active),
    opened_at = case when p_data ? 'opened_at' then nullif(p_data ->> 'opened_at', '')::date else opened_at end,
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.branch_row_to_json(v_row);
end;
$$;

create or replace function public.set_branch_active(p_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.branches;
  v_active_main_count int;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar sucursales.';
  end if;

  select * into v_row from public.branches where id = p_id for update;
  if not found then raise exception 'Sucursal no encontrada.'; end if;

  if v_row.is_main and coalesce(p_is_active, true) = false then
    raise exception 'No se puede desactivar la sucursal principal.';
  end if;

  update public.branches
  set is_active = coalesce(p_is_active, true), updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  select count(*) into v_active_main_count
  from public.branches where is_main = true and is_active = true;

  if v_active_main_count <> 1 then
    raise exception 'Debe existir exactamente una sucursal principal activa.';
  end if;

  return public.branch_row_to_json(v_row);
end;
$$;

create or replace function public.set_branch_main(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.branches;
  v_active_main_count int;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar sucursales.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.branches.main'));

  select * into v_row from public.branches where id = p_id for update;
  if not found then raise exception 'Sucursal no encontrada.'; end if;
  if not v_row.is_active then
    raise exception 'La sucursal principal debe estar activa.';
  end if;

  update public.branches
  set is_main = false, updated_by = auth.uid()
  where is_main = true and id <> p_id;

  update public.branches
  set is_main = true, updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  select count(*) into v_active_main_count
  from public.branches
  where is_main = true and is_active = true;

  if v_active_main_count <> 1 then
    raise exception 'Debe existir exactamente una sucursal principal activa.';
  end if;

  return public.branch_row_to_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cost center RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_finance_cost_centers(
  p_search text default null,
  p_branch_id uuid default null,
  p_is_active boolean default null,
  p_include_inactive boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver centros de costo.';
  end if;
  return coalesce((
    select jsonb_agg(public.finance_cost_center_row_to_json(c) order by c.code)
    from public.finance_cost_centers c
    where (p_include_inactive or c.is_active)
      and (p_is_active is null or c.is_active = p_is_active)
      and (p_branch_id is null or c.branch_id = p_branch_id)
      and (
        p_search is null or trim(p_search) = ''
        or c.code ilike '%' || trim(p_search) || '%'
        or c.name ilike '%' || trim(p_search) || '%'
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_finance_cost_center(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.finance_cost_center_normalize_code(p_data ->> 'code');
  v_name text := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  v_parent_id uuid := nullif(p_data ->> 'parent_id', '')::uuid;
  v_branch_id uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_maps_to_area_id text := nullif(trim(p_data ->> 'maps_to_area_id'), '');
  v_account_kind text := lower(trim(coalesce(p_data ->> 'account_kind', 'detail')));
  v_row public.finance_cost_centers;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar centros de costo.';
  end if;
  if v_code is null then raise exception 'El código es obligatorio.'; end if;
  if v_name is null then raise exception 'El nombre es obligatorio.'; end if;
  if v_account_kind not in ('header', 'detail') then
    raise exception 'Tipo de centro de costo inválido.';
  end if;
  if exists (select 1 from public.finance_cost_centers where code = v_code) then
    raise exception 'El código % ya existe en centros de costo.', v_code;
  end if;

  perform public.finance_cost_center_assert_no_cycle(null, v_parent_id);
  perform public.finance_cost_center_assert_branch_hierarchy(v_parent_id, v_branch_id);

  insert into public.finance_cost_centers (
    code, name, parent_id, level, branch_id, maps_to_area_id, account_kind, description, created_by, updated_by
  )
  values (
    v_code,
    v_name,
    v_parent_id,
    public.finance_cost_center_parent_level(v_parent_id) + 1,
    v_branch_id,
    case when v_account_kind = 'header' then null else v_maps_to_area_id end,
    v_account_kind,
    coalesce(nullif(trim(p_data ->> 'description'), ''), ''),
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  return public.finance_cost_center_row_to_json(v_row);
end;
$$;

create or replace function public.update_finance_cost_center(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_cost_centers;
  v_parent_id uuid;
  v_branch_id uuid;
  v_account_kind text;
  v_has_children boolean;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar centros de costo.';
  end if;

  select * into v_row from public.finance_cost_centers where id = p_id for update;
  if not found then raise exception 'Centro de costo no encontrado.'; end if;

  select exists(select 1 from public.finance_cost_centers where parent_id = p_id) into v_has_children;

  v_parent_id := v_row.parent_id;
  if p_data ? 'parent_id' then
    v_parent_id := nullif(p_data ->> 'parent_id', '')::uuid;
  end if;
  perform public.finance_cost_center_assert_no_cycle(p_id, v_parent_id);

  v_branch_id := v_row.branch_id;
  if p_data ? 'branch_id' then
    v_branch_id := nullif(p_data ->> 'branch_id', '')::uuid;
  end if;
  perform public.finance_cost_center_assert_branch_hierarchy(v_parent_id, v_branch_id);

  v_account_kind := coalesce(lower(trim(p_data ->> 'account_kind')), v_row.account_kind);
  if v_has_children and v_account_kind <> 'header' then
    raise exception 'Los centros de costo con subcentros deben permanecer como acumuladores (header).';
  end if;

  update public.finance_cost_centers
  set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    parent_id = v_parent_id,
    level = public.finance_cost_center_parent_level(v_parent_id) + 1,
    branch_id = v_branch_id,
    maps_to_area_id = case
      when v_account_kind = 'header' then null
      when p_data ? 'maps_to_area_id' then nullif(trim(p_data ->> 'maps_to_area_id'), '')
      else maps_to_area_id
    end,
    account_kind = v_account_kind,
    description = coalesce(nullif(trim(p_data ->> 'description'), ''), description),
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_cost_center_row_to_json(v_row);
end;
$$;

create or replace function public.set_finance_cost_center_active(p_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_cost_centers;
begin
  if not public.can_manage_accounting_structure() then
    raise exception 'No tienes permiso para administrar centros de costo.';
  end if;

  update public.finance_cost_centers
  set is_active = coalesce(p_is_active, true), updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  if not found then raise exception 'Centro de costo no encontrado.'; end if;
  return public.finance_cost_center_row_to_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounting period RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_finance_accounting_periods(
  p_year integer default null,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver periodos contables.';
  end if;
  return coalesce((
    select jsonb_agg(public.finance_accounting_period_row_to_json(p) order by p.period_year desc, p.period_month desc)
    from public.finance_accounting_periods p
    where (p_year is null or p.period_year = p_year)
      and (p_status is null or p.status = p_status)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_finance_accounting_period(
  p_year integer,
  p_month integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bounds record;
  v_row public.finance_accounting_periods;
begin
  if not public.can_manage_accounting_periods() then
    raise exception 'No tienes permiso para administrar periodos contables.';
  end if;
  if p_month < 1 or p_month > 12 then raise exception 'Mes inválido.'; end if;

  select * into v_bounds from public.finance_accounting_period_bounds(p_year, p_month);

  insert into public.finance_accounting_periods (
    period_year, period_month, start_date, end_date, status, created_by, updated_by
  )
  values (
    p_year, p_month, v_bounds.p_start, v_bounds.p_end, 'open', auth.uid(), auth.uid()
  )
  returning * into v_row;

  return public.finance_accounting_period_row_to_json(v_row);
exception
  when unique_violation then
    raise exception 'Ya existe un periodo contable para %/%', p_month, p_year;
end;
$$;

create or replace function public.set_finance_accounting_period_status(
  p_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_accounting_periods;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status = 'closed' then
    if not public.can_close_accounting_period() then
      raise exception 'No tienes permiso para cerrar periodos contables.';
    end if;
  elsif v_status = 'soft_closed' then
    if not (public.can_manage_accounting_periods() or public.can_close_accounting_period()) then
      raise exception 'No tienes permiso para administrar periodos contables.';
    end if;
  elsif v_status = 'open' then
    if not public.can_manage_accounting_periods() then
      raise exception 'Use reopen_finance_accounting_period para reabrir un periodo cerrado.';
    end if;
  else
    raise exception 'Estado de periodo inválido.';
  end if;

  if v_status not in ('open', 'soft_closed', 'closed') then
    raise exception 'Estado de periodo inválido.';
  end if;

  select * into v_row from public.finance_accounting_periods where id = p_id for update;
  if not found then raise exception 'Periodo contable no encontrado.'; end if;

  if v_row.status = 'closed' and v_status <> 'closed' then
    raise exception 'Use reopen_finance_accounting_period para reabrir un periodo cerrado.';
  end if;
  if v_row.status = 'open' and v_status = 'open' then
    raise exception 'El periodo ya está abierto.';
  end if;

  update public.finance_accounting_periods
  set
    status = v_status,
    closed_at = case when v_status in ('soft_closed', 'closed') then now() else closed_at end,
    closed_by = case when v_status in ('soft_closed', 'closed') then auth.uid() else closed_by end,
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_accounting_period_row_to_json(v_row);
end;
$$;

create or replace function public.reopen_finance_accounting_period(
  p_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_accounting_periods;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.can_reopen_accounting_period() then
    raise exception 'No tienes permiso para reabrir periodos contables.';
  end if;
  if v_reason is null then
    raise exception 'El motivo de reapertura es obligatorio.';
  end if;

  select * into v_row from public.finance_accounting_periods where id = p_id for update;
  if not found then raise exception 'Periodo contable no encontrado.'; end if;
  if v_row.status = 'open' then
    raise exception 'El periodo ya está abierto.';
  end if;

  update public.finance_accounting_periods
  set
    status = 'open',
    reopened_at = now(),
    reopened_by = auth.uid(),
    reopen_reason = v_reason,
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_accounting_period_row_to_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Chart account RPC patches (dimension rules on create/update/import)
-- ---------------------------------------------------------------------------

create or replace function public.create_finance_chart_account(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.finance_chart_account_normalize_code(p_data ->> 'code');
  v_name text := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  v_parent_id uuid := nullif(p_data ->> 'parent_id', '')::uuid;
  v_parent_code text := public.finance_chart_account_normalize_code(p_data ->> 'parent_code');
  v_financial_type text := lower(trim(coalesce(p_data ->> 'financial_type', '')));
  v_natural_balance text := lower(trim(coalesce(p_data ->> 'natural_balance', '')));
  v_account_kind text := lower(trim(coalesce(p_data ->> 'account_kind', '')));
  v_accepts_entries boolean := coalesce((p_data ->> 'accepts_entries')::boolean, false);
  v_description text := coalesce(nullif(trim(p_data ->> 'description'), ''), '');
  v_branch_rule text;
  v_cost_center_rule text;
  v_level smallint;
  v_row public.finance_chart_accounts;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para administrar el catálogo contable.';
  end if;
  if v_code is null then raise exception 'El código es obligatorio.'; end if;
  if v_name is null then raise exception 'El nombre es obligatorio.'; end if;
  if v_financial_type not in ('asset', 'liability', 'equity', 'income', 'cost', 'expense') then
    raise exception 'Tipo financiero inválido.';
  end if;
  if v_natural_balance not in ('debit', 'credit') then
    raise exception 'Naturaleza inválida.';
  end if;
  if v_account_kind not in ('header', 'detail') then
    raise exception 'Tipo de cuenta inválido.';
  end if;
  if v_account_kind = 'header' then
    v_accepts_entries := false;
  end if;

  if v_parent_id is null and v_parent_code is not null then
    select id into v_parent_id from public.finance_chart_accounts where code = v_parent_code;
    if not found then raise exception 'La cuenta padre % no existe.', v_parent_code; end if;
  end if;

  perform public.finance_chart_account_assert_no_cycle(null, v_parent_id);
  v_level := public.finance_chart_account_parent_level(v_parent_id) + 1;

  if exists (select 1 from public.finance_chart_accounts where code = v_code) then
    raise exception 'El código % ya existe en el catálogo contable.', v_code;
  end if;

  v_branch_rule := public.finance_chart_account_validate_dimension_rule(
    coalesce(
      nullif(trim(p_data ->> 'branch_dimension_rule'), ''),
      public.finance_chart_account_default_branch_dimension_rule(v_financial_type)
    )
  );
  v_cost_center_rule := public.finance_chart_account_validate_dimension_rule(
    coalesce(
      nullif(trim(p_data ->> 'cost_center_dimension_rule'), ''),
      public.finance_chart_account_default_cost_center_dimension_rule(v_financial_type)
    )
  );

  insert into public.finance_chart_accounts (
    code, name, parent_id, level, financial_type, natural_balance,
    account_kind, accepts_entries, description,
    branch_dimension_rule, cost_center_dimension_rule,
    created_by, updated_by
  )
  values (
    v_code, v_name, v_parent_id, v_level, v_financial_type, v_natural_balance,
    v_account_kind, v_accepts_entries, v_description,
    v_branch_rule, v_cost_center_rule,
    auth.uid(), auth.uid()
  )
  returning * into v_row;

  return public.finance_chart_account_row_to_json(v_row);
end;
$$;

create or replace function public.update_finance_chart_account(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_chart_accounts;
  v_parent_id uuid;
  v_parent_code text;
  v_account_kind text;
  v_accepts_entries boolean;
  v_has_children boolean;
  v_financial_type text;
  v_branch_rule text;
  v_cost_center_rule text;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para administrar el catálogo contable.';
  end if;

  select * into v_row from public.finance_chart_accounts where id = p_id for update;
  if not found then raise exception 'Cuenta contable no encontrada.'; end if;

  select exists(select 1 from public.finance_chart_accounts where parent_id = p_id)
  into v_has_children;

  v_parent_id := v_row.parent_id;
  if p_data ? 'parent_id' then
    v_parent_id := nullif(p_data ->> 'parent_id', '')::uuid;
  end if;
  v_parent_code := public.finance_chart_account_normalize_code(p_data ->> 'parent_code');
  if v_parent_id is null and v_parent_code is not null then
    select id into v_parent_id from public.finance_chart_accounts where code = v_parent_code;
    if not found then raise exception 'La cuenta padre % no existe.', v_parent_code; end if;
  end if;

  perform public.finance_chart_account_assert_no_cycle(p_id, v_parent_id);

  v_account_kind := coalesce(lower(trim(p_data ->> 'account_kind')), v_row.account_kind);
  v_accepts_entries := coalesce((p_data ->> 'accepts_entries')::boolean, v_row.accepts_entries);
  v_financial_type := coalesce(lower(trim(p_data ->> 'financial_type')), v_row.financial_type);

  if v_has_children then
    if v_account_kind <> 'header' then
      raise exception 'Las cuentas con subcuentas deben permanecer como acumuladoras (header).';
    end if;
    v_accepts_entries := false;
  elsif v_account_kind = 'header' then
    v_accepts_entries := false;
  end if;

  v_branch_rule := v_row.branch_dimension_rule;
  if p_data ? 'branch_dimension_rule' then
    v_branch_rule := public.finance_chart_account_validate_dimension_rule(p_data ->> 'branch_dimension_rule');
  end if;
  v_cost_center_rule := v_row.cost_center_dimension_rule;
  if p_data ? 'cost_center_dimension_rule' then
    v_cost_center_rule := public.finance_chart_account_validate_dimension_rule(p_data ->> 'cost_center_dimension_rule');
  end if;

  update public.finance_chart_accounts
  set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    parent_id = v_parent_id,
    level = public.finance_chart_account_parent_level(v_parent_id) + 1,
    financial_type = v_financial_type,
    natural_balance = coalesce(lower(trim(p_data ->> 'natural_balance')), natural_balance),
    account_kind = v_account_kind,
    accepts_entries = v_accepts_entries,
    description = coalesce(nullif(trim(p_data ->> 'description'), ''), description),
    branch_dimension_rule = v_branch_rule,
    cost_center_dimension_rule = v_cost_center_rule,
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_chart_account_row_to_json(v_row);
end;
$$;

create or replace function public.import_finance_chart_accounts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_row jsonb;
  v_code text;
  v_parent_code text;
  v_parent_id uuid;
  v_financial_type text;
  v_id_map jsonb := '{}'::jsonb;
  v_inserted int := 0;
  v_sorted jsonb;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para importar el catálogo contable.';
  end if;

  v_preview := public.preview_finance_chart_accounts_import(p_rows);
  if coalesce((v_preview ->> 'blocking_errors')::boolean, false) then
    raise exception 'La importación contiene errores bloqueantes. Corrige el archivo e inténtalo de nuevo.';
  end if;

  v_sorted := public.finance_chart_import_sort_rows(p_rows);

  for v_row in select value from jsonb_array_elements(v_sorted) loop
    v_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo');
    v_parent_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo_padre');
    v_financial_type := lower(trim(v_row ->> 'tipo_financiero'));
    v_parent_id := null;

    if v_parent_code is not null then
      select id into v_parent_id from public.finance_chart_accounts where code = v_parent_code;
      if v_parent_id is null then
        v_parent_id := nullif(v_id_map ->> v_parent_code, '')::uuid;
      end if;
      if v_parent_id is null then
        raise exception 'No se pudo resolver la cuenta padre % durante la importación.', v_parent_code;
      end if;
    end if;

    insert into public.finance_chart_accounts (
      code, name, parent_id, level, financial_type, natural_balance,
      account_kind, accepts_entries, description,
      branch_dimension_rule, cost_center_dimension_rule,
      created_by, updated_by
    )
    values (
      v_code,
      trim(v_row ->> 'nombre'),
      v_parent_id,
      public.finance_chart_account_parent_level(v_parent_id) + 1,
      v_financial_type,
      lower(trim(v_row ->> 'naturaleza')),
      lower(trim(v_row ->> 'tipo_cuenta')),
      case
        when lower(trim(v_row ->> 'tipo_cuenta')) = 'header' then false
        else lower(trim(coalesce(v_row ->> 'acepta_movimientos', ''))) in ('true', '1', 'si', 'sí', 'yes')
      end,
      coalesce(nullif(trim(v_row ->> 'descripcion'), ''), ''),
      public.finance_chart_account_default_branch_dimension_rule(v_financial_type),
      public.finance_chart_account_default_cost_center_dimension_rule(v_financial_type),
      auth.uid(),
      auth.uid()
    )
    returning id into v_parent_id;

    v_id_map := v_id_map || jsonb_build_object(v_code, v_parent_id::text);
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'imported', v_inserted,
    'preview', v_preview
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed main branch (idempotent)
-- ---------------------------------------------------------------------------

insert into public.branches (
  code, name, legal_name, address, timezone, is_main, is_active, opened_at
)
values (
  'PRINCIPAL',
  'Principal — La Floresta',
  null,
  '',
  'America/Guatemala',
  true,
  true,
  null
)
on conflict (code) do update
set
  name = excluded.name,
  timezone = excluded.timezone,
  is_main = true,
  is_active = true,
  updated_at = now();

update public.branches
set is_main = false, updated_at = now()
where code <> 'PRINCIPAL' and is_main = true and is_active = true;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.can_manage_accounting_structure() from public;
revoke all on function public.can_manage_accounting_periods() from public;
revoke all on function public.can_close_accounting_period() from public;
revoke all on function public.can_reopen_accounting_period() from public;
revoke all on function public.list_branches(text, boolean, boolean) from public;
revoke all on function public.create_branch(jsonb) from public;
revoke all on function public.update_branch(uuid, jsonb) from public;
revoke all on function public.set_branch_active(uuid, boolean) from public;
revoke all on function public.set_branch_main(uuid) from public;
revoke all on function public.list_finance_cost_centers(text, uuid, boolean, boolean) from public;
revoke all on function public.create_finance_cost_center(jsonb) from public;
revoke all on function public.update_finance_cost_center(uuid, jsonb) from public;
revoke all on function public.set_finance_cost_center_active(uuid, boolean) from public;
revoke all on function public.list_finance_accounting_periods(integer, text) from public;
revoke all on function public.create_finance_accounting_period(integer, integer) from public;
revoke all on function public.set_finance_accounting_period_status(uuid, text) from public;
revoke all on function public.reopen_finance_accounting_period(uuid, text) from public;
revoke all on function public.branch_normalize_code(text) from public;
revoke all on function public.finance_cost_center_normalize_code(text) from public;
revoke all on function public.finance_cost_center_parent_level(uuid) from public;
revoke all on function public.finance_cost_center_assert_no_cycle(uuid, uuid) from public;
revoke all on function public.finance_cost_center_assert_branch_hierarchy(uuid, uuid) from public;
revoke all on function public.finance_chart_account_default_branch_dimension_rule(text) from public;
revoke all on function public.finance_chart_account_default_cost_center_dimension_rule(text) from public;
revoke all on function public.finance_chart_account_validate_dimension_rule(text) from public;
revoke all on function public.create_finance_chart_account(jsonb) from public;
revoke all on function public.update_finance_chart_account(uuid, jsonb) from public;
revoke all on function public.import_finance_chart_accounts(jsonb) from public;
revoke all on function public.branch_row_to_json(public.branches) from public;
revoke all on function public.finance_cost_center_row_to_json(public.finance_cost_centers) from public;
revoke all on function public.finance_accounting_period_row_to_json(public.finance_accounting_periods) from public;

grant execute on function public.can_manage_accounting_structure() to authenticated;
grant execute on function public.can_manage_accounting_periods() to authenticated;
grant execute on function public.can_close_accounting_period() to authenticated;
grant execute on function public.can_reopen_accounting_period() to authenticated;
grant execute on function public.list_branches(text, boolean, boolean) to authenticated;
grant execute on function public.create_branch(jsonb) to authenticated;
grant execute on function public.update_branch(uuid, jsonb) to authenticated;
grant execute on function public.set_branch_active(uuid, boolean) to authenticated;
grant execute on function public.set_branch_main(uuid) to authenticated;
grant execute on function public.list_finance_cost_centers(text, uuid, boolean, boolean) to authenticated;
grant execute on function public.create_finance_cost_center(jsonb) to authenticated;
grant execute on function public.update_finance_cost_center(uuid, jsonb) to authenticated;
grant execute on function public.set_finance_cost_center_active(uuid, boolean) to authenticated;
grant execute on function public.list_finance_accounting_periods(integer, text) to authenticated;
grant execute on function public.create_finance_accounting_period(integer, integer) to authenticated;
grant execute on function public.set_finance_accounting_period_status(uuid, text) to authenticated;
grant execute on function public.reopen_finance_accounting_period(uuid, text) to authenticated;
