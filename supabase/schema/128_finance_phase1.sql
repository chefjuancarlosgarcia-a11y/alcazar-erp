-- Finance module Phase 1 — operational financial control
-- Apply after 127_recruitment_list_purge_hotfix.sql

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_view_finance()
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
      and public.normalize_profile_role(p.role) in ('admin', 'gerente_general', 'contador')
  );
$$;

create or replace function public.can_manage_finance()
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

create or replace function public.can_reconcile_finance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_finance() or public.can_view_finance();
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text not null default '',
  account_number text not null default '',
  currency text not null default 'GTQ',
  opening_balance numeric not null default 0,
  current_balance numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.finance_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transaction_date date not null default (now() at time zone 'America/Guatemala')::date,
  type text not null check (type in ('deposit', 'withdrawal', 'transfer', 'fee', 'adjustment')),
  description text not null default '',
  reference text,
  amount numeric not null check (amount > 0),
  direction text not null check (direction in ('in', 'out')),
  source_module text check (source_module is null or source_module in ('caja', 'pos', 'compras', 'manual', 'catering', 'finance')),
  source_id uuid,
  reconciliation_status text not null default 'pending'
    check (reconciliation_status in ('pending', 'reconciled', 'ignored')),
  reconciled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_bank_transactions_account_date_idx
  on public.finance_bank_transactions (bank_account_id, transaction_date desc);

create table if not exists public.finance_payables (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text not null,
  invoice_number text,
  issue_date date not null default (now() at time zone 'America/Guatemala')::date,
  due_date date not null default (now() at time zone 'America/Guatemala')::date,
  description text not null default '',
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  balance numeric generated always as (greatest(total_amount - paid_amount, 0)) stored,
  status text not null default 'pending'
    check (status in ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
  source_module text check (source_module is null or source_module in ('purchases', 'manual')),
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

create index if not exists finance_payables_status_due_idx
  on public.finance_payables (status, due_date);

create table if not exists public.finance_payable_payments (
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references public.finance_payables(id) on delete restrict,
  bank_account_id uuid references public.finance_bank_accounts(id) on delete set null,
  payment_date date not null default (now() at time zone 'America/Guatemala')::date,
  amount numeric not null check (amount > 0),
  method text not null default 'bank_transfer'
    check (method in ('cash', 'bank_transfer', 'check', 'card', 'other')),
  reference text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_receivables (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text,
  customer_email text,
  document_number text,
  issue_date date not null default (now() at time zone 'America/Guatemala')::date,
  due_date date,
  description text not null default '',
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),
  collected_amount numeric not null default 0 check (collected_amount >= 0),
  balance numeric generated always as (greatest(total_amount - collected_amount, 0)) stored,
  status text not null default 'pending'
    check (status in ('pending', 'partial', 'collected', 'overdue', 'cancelled')),
  source_module text check (source_module is null or source_module in ('catering', 'pos_credit', 'manual')),
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

create index if not exists finance_receivables_status_due_idx
  on public.finance_receivables (status, due_date);

create table if not exists public.finance_receivable_collections (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.finance_receivables(id) on delete restrict,
  bank_account_id uuid references public.finance_bank_accounts(id) on delete set null,
  collection_date date not null default (now() at time zone 'America/Guatemala')::date,
  amount numeric not null check (amount > 0),
  method text not null default 'bank_transfer'
    check (method in ('cash', 'bank_transfer', 'card', 'other')),
  reference text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  period_month int not null check (period_month between 1 and 12),
  period_year int not null check (period_year between 2000 and 2100),
  statement_start_balance numeric not null default 0,
  statement_end_balance numeric not null default 0,
  system_end_balance numeric not null default 0,
  difference numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'closed')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  unique (bank_account_id, period_month, period_year)
);

create table if not exists public.finance_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.finance_reconciliations(id) on delete cascade,
  bank_transaction_id uuid not null references public.finance_bank_transactions(id) on delete restrict,
  is_checked boolean not null default false,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reconciliation_id, bank_transaction_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.finance_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists finance_bank_accounts_updated_at on public.finance_bank_accounts;
create trigger finance_bank_accounts_updated_at
  before update on public.finance_bank_accounts
  for each row execute function public.finance_set_updated_at();

drop trigger if exists finance_bank_transactions_updated_at on public.finance_bank_transactions;
create trigger finance_bank_transactions_updated_at
  before update on public.finance_bank_transactions
  for each row execute function public.finance_set_updated_at();

drop trigger if exists finance_payables_updated_at on public.finance_payables;
create trigger finance_payables_updated_at
  before update on public.finance_payables
  for each row execute function public.finance_set_updated_at();

drop trigger if exists finance_receivables_updated_at on public.finance_receivables;
create trigger finance_receivables_updated_at
  before update on public.finance_receivables
  for each row execute function public.finance_set_updated_at();

drop trigger if exists finance_reconciliations_updated_at on public.finance_reconciliations;
create trigger finance_reconciliations_updated_at
  before update on public.finance_reconciliations
  for each row execute function public.finance_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.finance_bank_accounts enable row level security;
alter table public.finance_bank_transactions enable row level security;
alter table public.finance_payables enable row level security;
alter table public.finance_payable_payments enable row level security;
alter table public.finance_receivables enable row level security;
alter table public.finance_receivable_collections enable row level security;
alter table public.finance_reconciliations enable row level security;
alter table public.finance_reconciliation_items enable row level security;

drop policy if exists finance_bank_accounts_select on public.finance_bank_accounts;
create policy finance_bank_accounts_select on public.finance_bank_accounts
  for select using (public.can_view_finance());

drop policy if exists finance_bank_accounts_write on public.finance_bank_accounts;
create policy finance_bank_accounts_write on public.finance_bank_accounts
  for all using (public.can_manage_finance()) with check (public.can_manage_finance());

drop policy if exists finance_bank_transactions_select on public.finance_bank_transactions;
create policy finance_bank_transactions_select on public.finance_bank_transactions
  for select using (public.can_view_finance());

drop policy if exists finance_bank_transactions_write on public.finance_bank_transactions;
create policy finance_bank_transactions_write on public.finance_bank_transactions
  for all using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists finance_payables_select on public.finance_payables;
create policy finance_payables_select on public.finance_payables
  for select using (public.can_view_finance());

drop policy if exists finance_payables_write on public.finance_payables;
create policy finance_payables_write on public.finance_payables
  for all using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists finance_payable_payments_select on public.finance_payable_payments;
create policy finance_payable_payments_select on public.finance_payable_payments
  for select using (public.can_view_finance());

drop policy if exists finance_payable_payments_write on public.finance_payable_payments;
create policy finance_payable_payments_write on public.finance_payable_payments
  for all using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists finance_receivables_select on public.finance_receivables;
create policy finance_receivables_select on public.finance_receivables
  for select using (public.can_view_finance());

drop policy if exists finance_receivables_write on public.finance_receivables;
create policy finance_receivables_write on public.finance_receivables
  for all using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists finance_receivable_collections_select on public.finance_receivable_collections;
create policy finance_receivable_collections_select on public.finance_receivable_collections
  for select using (public.can_view_finance());

drop policy if exists finance_receivable_collections_write on public.finance_receivable_collections;
create policy finance_receivable_collections_write on public.finance_receivable_collections
  for all using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists finance_reconciliations_select on public.finance_reconciliations;
create policy finance_reconciliations_select on public.finance_reconciliations
  for select using (public.can_view_finance());

drop policy if exists finance_reconciliations_write on public.finance_reconciliations;
create policy finance_reconciliations_write on public.finance_reconciliations
  for all using (public.can_reconcile_finance()) with check (public.can_reconcile_finance());

drop policy if exists finance_reconciliation_items_select on public.finance_reconciliation_items;
create policy finance_reconciliation_items_select on public.finance_reconciliation_items
  for select using (public.can_view_finance());

drop policy if exists finance_reconciliation_items_write on public.finance_reconciliation_items;
create policy finance_reconciliation_items_write on public.finance_reconciliation_items
  for all using (public.can_reconcile_finance()) with check (public.can_reconcile_finance());

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function public.finance_refresh_payable_status(p_payable_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_payables;
  v_status text;
begin
  select * into v_row from public.finance_payables where id = p_payable_id;
  if not found then return; end if;

  if v_row.status = 'cancelled' then return; end if;

  if v_row.balance <= 0 then
    v_status := 'paid';
  elsif v_row.paid_amount > 0 then
    v_status := 'partial';
  elsif v_row.due_date < (now() at time zone 'America/Guatemala')::date then
    v_status := 'overdue';
  else
    v_status := 'pending';
  end if;

  update public.finance_payables set status = v_status where id = p_payable_id;
end;
$$;

create or replace function public.finance_refresh_receivable_status(p_receivable_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_receivables;
  v_status text;
begin
  select * into v_row from public.finance_receivables where id = p_receivable_id;
  if not found then return; end if;

  if v_row.status = 'cancelled' then return; end if;

  if v_row.balance <= 0 then
    v_status := 'collected';
  elsif v_row.collected_amount > 0 then
    v_status := 'partial';
  elsif v_row.due_date is not null and v_row.due_date < (now() at time zone 'America/Guatemala')::date then
    v_status := 'overdue';
  else
    v_status := 'pending';
  end if;

  update public.finance_receivables set status = v_status where id = p_receivable_id;
end;
$$;

create or replace function public.finance_apply_bank_transaction(
  p_bank_account_id uuid,
  p_amount numeric,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;

  if p_direction = 'in' then
    update public.finance_bank_accounts
    set current_balance = current_balance + p_amount, updated_by = auth.uid()
    where id = p_bank_account_id;
  elsif p_direction = 'out' then
    update public.finance_bank_accounts
    set current_balance = current_balance - p_amount, updated_by = auth.uid()
    where id = p_bank_account_id;
  else
    raise exception 'Dirección inválida.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_finance_dashboard(
  p_start_date date default null,
  p_end_date date default null,
  p_bank_account_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_start_date, date_trunc('month', (now() at time zone 'America/Guatemala'))::date);
  v_end date := coalesce(p_end_date, (now() at time zone 'America/Guatemala')::date);
  v_available numeric := 0;
  v_receivable numeric := 0;
  v_payable numeric := 0;
  v_inflows numeric := 0;
  v_outflows numeric := 0;
  v_collections numeric := 0;
  v_payments numeric := 0;
  v_overdue_payables_count int := 0;
  v_overdue_payables_amount numeric := 0;
  v_overdue_receivables_count int := 0;
  v_overdue_receivables_amount numeric := 0;
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver finanzas.';
  end if;

  select coalesce(sum(current_balance), 0) into v_available
  from public.finance_bank_accounts
  where is_active
    and (p_bank_account_id is null or id = p_bank_account_id);

  select coalesce(sum(balance), 0) into v_receivable
  from public.finance_receivables
  where status in ('pending', 'partial', 'overdue');

  select coalesce(sum(balance), 0) into v_payable
  from public.finance_payables
  where status in ('pending', 'partial', 'overdue');

  select coalesce(sum(amount), 0) into v_inflows
  from public.finance_bank_transactions
  where direction = 'in'
    and transaction_date between v_start and v_end
    and (p_bank_account_id is null or bank_account_id = p_bank_account_id);

  select coalesce(sum(amount), 0) into v_outflows
  from public.finance_bank_transactions
  where direction = 'out'
    and transaction_date between v_start and v_end
    and (p_bank_account_id is null or bank_account_id = p_bank_account_id);

  select coalesce(sum(amount), 0) into v_collections
  from public.finance_receivable_collections
  where collection_date between v_start and v_end;

  select coalesce(sum(amount), 0) into v_payments
  from public.finance_payable_payments
  where payment_date between v_start and v_end;

  select count(*), coalesce(sum(balance), 0)
  into v_overdue_payables_count, v_overdue_payables_amount
  from public.finance_payables
  where status = 'overdue';

  select count(*), coalesce(sum(balance), 0)
  into v_overdue_receivables_count, v_overdue_receivables_amount
  from public.finance_receivables
  where status = 'overdue';

  return jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'available_cash', v_available,
    'receivable_balance', v_receivable,
    'payable_balance', v_payable,
    'net_flow', v_inflows - v_outflows,
    'period_collections', v_collections + v_inflows,
    'period_payments', v_payments + v_outflows,
    'overdue_payables_count', v_overdue_payables_count,
    'overdue_payables_amount', v_overdue_payables_amount,
    'overdue_receivables_count', v_overdue_receivables_count,
    'overdue_receivables_amount', v_overdue_receivables_amount
  );
end;
$$;

create or replace function public.list_finance_bank_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver finanzas.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.name)
    from public.finance_bank_accounts a
    where a.is_active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_finance_bank_transactions(
  p_bank_account_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_start_date, (now() at time zone 'America/Guatemala')::date - 30);
  v_end date := coalesce(p_end_date, (now() at time zone 'America/Guatemala')::date);
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver finanzas.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.transaction_date desc, t.created_at desc)
    from public.finance_bank_transactions t
    where t.bank_account_id = p_bank_account_id
      and t.transaction_date between v_start and v_end
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_finance_bank_account(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_bank_accounts;
  v_opening numeric := coalesce((p_data ->> 'opening_balance')::numeric, 0);
begin
  if not public.can_manage_finance() then
    raise exception 'No tienes permiso para configurar cuentas bancarias.';
  end if;

  insert into public.finance_bank_accounts (
    name, bank_name, account_number, currency, opening_balance, current_balance, created_by
  )
  values (
    trim(p_data ->> 'name'),
    coalesce(trim(p_data ->> 'bank_name'), ''),
    coalesce(trim(p_data ->> 'account_number'), ''),
    coalesce(nullif(trim(p_data ->> 'currency'), ''), 'GTQ'),
    v_opening,
    v_opening,
    auth.uid()
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.create_finance_bank_transaction(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_bank_transactions;
  v_amount numeric := (p_data ->> 'amount')::numeric;
  v_direction text := coalesce(p_data ->> 'direction', 'in');
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para registrar movimientos.';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;

  insert into public.finance_bank_transactions (
    bank_account_id, transaction_date, type, description, reference, amount, direction,
    source_module, source_id, created_by
  )
  values (
    (p_data ->> 'bank_account_id')::uuid,
    coalesce((p_data ->> 'transaction_date')::date, (now() at time zone 'America/Guatemala')::date),
    coalesce(p_data ->> 'type', 'adjustment'),
    coalesce(trim(p_data ->> 'description'), ''),
    nullif(trim(p_data ->> 'reference'), ''),
    v_amount,
    v_direction,
    coalesce(p_data ->> 'source_module', 'manual'),
    nullif(p_data ->> 'source_id', '')::uuid,
    auth.uid()
  )
  returning * into v_row;

  perform public.finance_apply_bank_transaction(v_row.bank_account_id, v_amount, v_direction);

  return to_jsonb(v_row);
end;
$$;

create or replace function public.list_finance_payables(
  p_status text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver finanzas.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.due_date, p.supplier_name)
    from public.finance_payables p
    where (p_status is null or p.status = p_status)
      and (p_start_date is null or p.issue_date >= p_start_date)
      and (p_end_date is null or p.issue_date <= p_end_date)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_finance_payable(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_payables;
  v_subtotal numeric := coalesce((p_data ->> 'subtotal')::numeric, 0);
  v_tax numeric := coalesce((p_data ->> 'tax_amount')::numeric, 0);
  v_total numeric := coalesce((p_data ->> 'total_amount')::numeric, v_subtotal + v_tax);
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para crear cuentas por pagar.';
  end if;

  if v_total <= 0 then raise exception 'El total debe ser mayor a cero.'; end if;

  insert into public.finance_payables (
    supplier_id, supplier_name, invoice_number, issue_date, due_date, description,
    subtotal, tax_amount, total_amount, source_module, source_id, created_by
  )
  values (
    nullif(p_data ->> 'supplier_id', '')::uuid,
    trim(p_data ->> 'supplier_name'),
    nullif(trim(p_data ->> 'invoice_number'), ''),
    coalesce((p_data ->> 'issue_date')::date, (now() at time zone 'America/Guatemala')::date),
    coalesce((p_data ->> 'due_date')::date, (now() at time zone 'America/Guatemala')::date),
    coalesce(trim(p_data ->> 'description'), ''),
    v_subtotal, v_tax, v_total,
    coalesce(p_data ->> 'source_module', 'manual'),
    nullif(p_data ->> 'source_id', '')::uuid,
    auth.uid()
  )
  returning * into v_row;

  perform public.finance_refresh_payable_status(v_row.id);
  select * into v_row from public.finance_payables where id = v_row.id;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.record_finance_payable_payment(
  p_payable_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payable public.finance_payables;
  v_payment public.finance_payable_payments;
  v_amount numeric := (p_data ->> 'amount')::numeric;
  v_bank_id uuid := nullif(p_data ->> 'bank_account_id', '')::uuid;
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para registrar pagos.';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;

  select * into v_payable from public.finance_payables where id = p_payable_id for update;
  if not found then raise exception 'Cuenta por pagar no encontrada.'; end if;
  if v_payable.status = 'cancelled' then raise exception 'La cuenta por pagar está cancelada.'; end if;

  insert into public.finance_payable_payments (
    payable_id, bank_account_id, payment_date, amount, method, reference, notes, created_by
  )
  values (
    p_payable_id,
    v_bank_id,
    coalesce((p_data ->> 'payment_date')::date, (now() at time zone 'America/Guatemala')::date),
    v_amount,
    coalesce(p_data ->> 'method', 'bank_transfer'),
    nullif(trim(p_data ->> 'reference'), ''),
    nullif(trim(p_data ->> 'notes'), ''),
    auth.uid()
  )
  returning * into v_payment;

  update public.finance_payables
  set paid_amount = paid_amount + v_amount
  where id = p_payable_id;

  if v_bank_id is not null then
    perform public.create_finance_bank_transaction(jsonb_build_object(
      'bank_account_id', v_bank_id,
      'transaction_date', v_payment.payment_date,
      'type', 'withdrawal',
      'description', 'Pago a ' || v_payable.supplier_name,
      'reference', v_payment.reference,
      'amount', v_amount,
      'direction', 'out',
      'source_module', 'finance',
      'source_id', v_payment.id
    ));
  end if;

  perform public.finance_refresh_payable_status(p_payable_id);
  select * into v_payable from public.finance_payables where id = p_payable_id;

  return jsonb_build_object('payment', to_jsonb(v_payment), 'payable', to_jsonb(v_payable));
end;
$$;

create or replace function public.list_finance_receivables(
  p_status text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver finanzas.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.due_date nulls last, r.customer_name)
    from public.finance_receivables r
    where (p_status is null or r.status = p_status)
      and (p_start_date is null or r.issue_date >= p_start_date)
      and (p_end_date is null or r.issue_date <= p_end_date)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_finance_receivable(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_receivables;
  v_subtotal numeric := coalesce((p_data ->> 'subtotal')::numeric, 0);
  v_tax numeric := coalesce((p_data ->> 'tax_amount')::numeric, 0);
  v_total numeric := coalesce((p_data ->> 'total_amount')::numeric, v_subtotal + v_tax);
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para crear cuentas por cobrar.';
  end if;

  if v_total <= 0 then raise exception 'El total debe ser mayor a cero.'; end if;

  insert into public.finance_receivables (
    customer_name, customer_phone, customer_email, document_number,
    issue_date, due_date, description, subtotal, tax_amount, total_amount,
    source_module, source_id, created_by
  )
  values (
    trim(p_data ->> 'customer_name'),
    nullif(trim(p_data ->> 'customer_phone'), ''),
    nullif(trim(p_data ->> 'customer_email'), ''),
    nullif(trim(p_data ->> 'document_number'), ''),
    coalesce((p_data ->> 'issue_date')::date, (now() at time zone 'America/Guatemala')::date),
    nullif(p_data ->> 'due_date', '')::date,
    coalesce(trim(p_data ->> 'description'), ''),
    v_subtotal, v_tax, v_total,
    coalesce(p_data ->> 'source_module', 'manual'),
    nullif(p_data ->> 'source_id', '')::uuid,
    auth.uid()
  )
  returning * into v_row;

  perform public.finance_refresh_receivable_status(v_row.id);
  select * into v_row from public.finance_receivables where id = v_row.id;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.record_finance_receivable_collection(
  p_receivable_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receivable public.finance_receivables;
  v_collection public.finance_receivable_collections;
  v_amount numeric := (p_data ->> 'amount')::numeric;
  v_bank_id uuid := nullif(p_data ->> 'bank_account_id', '')::uuid;
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para registrar cobros.';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;

  select * into v_receivable from public.finance_receivables where id = p_receivable_id for update;
  if not found then raise exception 'Cuenta por cobrar no encontrada.'; end if;
  if v_receivable.status = 'cancelled' then raise exception 'La cuenta por cobrar está cancelada.'; end if;

  insert into public.finance_receivable_collections (
    receivable_id, bank_account_id, collection_date, amount, method, reference, notes, created_by
  )
  values (
    p_receivable_id,
    v_bank_id,
    coalesce((p_data ->> 'collection_date')::date, (now() at time zone 'America/Guatemala')::date),
    v_amount,
    coalesce(p_data ->> 'method', 'bank_transfer'),
    nullif(trim(p_data ->> 'reference'), ''),
    nullif(trim(p_data ->> 'notes'), ''),
    auth.uid()
  )
  returning * into v_collection;

  update public.finance_receivables
  set collected_amount = collected_amount + v_amount
  where id = p_receivable_id;

  if v_bank_id is not null then
    perform public.create_finance_bank_transaction(jsonb_build_object(
      'bank_account_id', v_bank_id,
      'transaction_date', v_collection.collection_date,
      'type', 'deposit',
      'description', 'Cobro de ' || v_receivable.customer_name,
      'reference', v_collection.reference,
      'amount', v_amount,
      'direction', 'in',
      'source_module', 'finance',
      'source_id', v_collection.id
    ));
  end if;

  perform public.finance_refresh_receivable_status(p_receivable_id);
  select * into v_receivable from public.finance_receivables where id = p_receivable_id;

  return jsonb_build_object('collection', to_jsonb(v_collection), 'receivable', to_jsonb(v_receivable));
end;
$$;

create or replace function public.get_finance_cash_flow(
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_start_date, (now() at time zone 'America/Guatemala')::date - 30);
  v_end date := coalesce(p_end_date, (now() at time zone 'America/Guatemala')::date);
  v_rows jsonb := '[]'::jsonb;
  v_running numeric := 0;
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver finanzas.';
  end if;

  with daily as (
    select d.day::date as flow_date,
      coalesce(sum(case when t.direction = 'in' then t.amount else 0 end), 0) as inflows,
      coalesce(sum(case when t.direction = 'out' then t.amount else 0 end), 0) as outflows
    from generate_series(v_start, v_end, interval '1 day') as d(day)
    left join public.finance_bank_transactions t on t.transaction_date = d.day::date
    group by d.day
    order by d.day
  ),
  with_running as (
    select
      flow_date,
      inflows,
      outflows,
      inflows - outflows as net,
      sum(inflows - outflows) over (order by flow_date) as running_balance
    from daily
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'flow_date', flow_date,
    'inflows', inflows,
    'outflows', outflows,
    'net', net,
    'running_balance', running_balance
  ) order by flow_date), '[]'::jsonb)
  into v_rows
  from with_running;

  return jsonb_build_object('start_date', v_start, 'end_date', v_end, 'rows', v_rows);
end;
$$;

create or replace function public.create_or_get_finance_reconciliation(
  p_bank_account_id uuid,
  p_month int,
  p_year int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_reconciliations;
  v_start date;
  v_end date;
  v_system_balance numeric;
begin
  if not public.can_reconcile_finance() then
    raise exception 'No tienes permiso para conciliar.';
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  select * into v_row
  from public.finance_reconciliations
  where bank_account_id = p_bank_account_id
    and period_month = p_month
    and period_year = p_year;

  if not found then
    select coalesce(current_balance, 0) into v_system_balance
    from public.finance_bank_accounts where id = p_bank_account_id;

    insert into public.finance_reconciliations (
      bank_account_id, period_month, period_year,
      statement_start_balance, statement_end_balance, system_end_balance,
      difference, created_by
    )
    values (
      p_bank_account_id, p_month, p_year,
      0, 0, v_system_balance, 0, auth.uid()
    )
    returning * into v_row;

    insert into public.finance_reconciliation_items (reconciliation_id, bank_transaction_id)
    select v_row.id, t.id
    from public.finance_bank_transactions t
    where t.bank_account_id = p_bank_account_id
      and t.transaction_date between v_start and v_end
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'reconciliation', to_jsonb(v_row),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item', to_jsonb(i),
        'transaction', to_jsonb(t)
      ) order by t.transaction_date, t.created_at)
      from public.finance_reconciliation_items i
      join public.finance_bank_transactions t on t.id = i.bank_transaction_id
      where i.reconciliation_id = v_row.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_finance_reconciliation_item(
  p_item_id uuid,
  p_is_checked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.finance_reconciliation_items;
  v_rec public.finance_reconciliations;
  v_checked_in numeric := 0;
  v_checked_out numeric := 0;
  v_difference numeric;
begin
  if not public.can_reconcile_finance() then
    raise exception 'No tienes permiso para conciliar.';
  end if;

  update public.finance_reconciliation_items
  set is_checked = p_is_checked,
      checked_at = case when p_is_checked then now() else null end
  where id = p_item_id
  returning * into v_item;

  if not found then raise exception 'Item de conciliación no encontrado.'; end if;

  select * into v_rec from public.finance_reconciliations where id = v_item.reconciliation_id for update;
  if v_rec.status = 'closed' then raise exception 'La conciliación ya está cerrada.'; end if;

  select
    coalesce(sum(case when t.direction = 'in' then t.amount else 0 end), 0),
    coalesce(sum(case when t.direction = 'out' then t.amount else 0 end), 0)
  into v_checked_in, v_checked_out
  from public.finance_reconciliation_items i
  join public.finance_bank_transactions t on t.id = i.bank_transaction_id
  where i.reconciliation_id = v_rec.id and i.is_checked;

  v_difference := v_rec.statement_end_balance - (v_rec.statement_start_balance + v_checked_in - v_checked_out);

  update public.finance_reconciliations
  set system_end_balance = v_rec.statement_start_balance + v_checked_in - v_checked_out,
      difference = v_difference
  where id = v_rec.id
  returning * into v_rec;

  return jsonb_build_object('item', to_jsonb(v_item), 'reconciliation', to_jsonb(v_rec));
end;
$$;

create or replace function public.update_finance_reconciliation_statement(
  p_reconciliation_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.finance_reconciliations;
begin
  if not public.can_reconcile_finance() then
    raise exception 'No tienes permiso para conciliar.';
  end if;

  update public.finance_reconciliations
  set
    statement_start_balance = coalesce((p_data ->> 'statement_start_balance')::numeric, statement_start_balance),
    statement_end_balance = coalesce((p_data ->> 'statement_end_balance')::numeric, statement_end_balance)
  where id = p_reconciliation_id and status = 'draft'
  returning * into v_rec;

  if not found then raise exception 'Conciliación no encontrada o cerrada.'; end if;

  return to_jsonb(v_rec);
end;
$$;

create or replace function public.close_finance_reconciliation(
  p_reconciliation_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.finance_reconciliations;
begin
  if not public.can_reconcile_finance() then
    raise exception 'No tienes permiso para cerrar conciliaciones.';
  end if;

  select * into v_rec from public.finance_reconciliations where id = p_reconciliation_id for update;
  if not found then raise exception 'Conciliación no encontrada.'; end if;
  if v_rec.status = 'closed' then raise exception 'La conciliación ya está cerrada.'; end if;

  if v_rec.difference <> 0 and not (p_force and public.can_manage_finance()) then
    raise exception 'La diferencia debe ser cero para cerrar la conciliación.';
  end if;

  update public.finance_reconciliations
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = p_reconciliation_id
  returning * into v_rec;

  update public.finance_bank_transactions t
  set reconciliation_status = 'reconciled', reconciled_at = now()
  from public.finance_reconciliation_items i
  where i.reconciliation_id = p_reconciliation_id
    and i.bank_transaction_id = t.id
    and i.is_checked;

  return to_jsonb(v_rec);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.can_view_finance() from public;
revoke all on function public.can_manage_finance() from public;
revoke all on function public.can_reconcile_finance() from public;

grant execute on function public.can_view_finance() to authenticated;
grant execute on function public.can_manage_finance() to authenticated;
grant execute on function public.can_reconcile_finance() to authenticated;

revoke all on function public.get_finance_dashboard(date, date, uuid) from public;
revoke all on function public.list_finance_bank_accounts() from public;
revoke all on function public.list_finance_bank_transactions(uuid, date, date) from public;
revoke all on function public.create_finance_bank_account(jsonb) from public;
revoke all on function public.create_finance_bank_transaction(jsonb) from public;
revoke all on function public.list_finance_payables(text, date, date) from public;
revoke all on function public.create_finance_payable(jsonb) from public;
revoke all on function public.record_finance_payable_payment(uuid, jsonb) from public;
revoke all on function public.list_finance_receivables(text, date, date) from public;
revoke all on function public.create_finance_receivable(jsonb) from public;
revoke all on function public.record_finance_receivable_collection(uuid, jsonb) from public;
revoke all on function public.get_finance_cash_flow(date, date) from public;
revoke all on function public.create_or_get_finance_reconciliation(uuid, int, int) from public;
revoke all on function public.update_finance_reconciliation_item(uuid, boolean) from public;
revoke all on function public.update_finance_reconciliation_statement(uuid, jsonb) from public;
revoke all on function public.close_finance_reconciliation(uuid, boolean) from public;

grant execute on function public.get_finance_dashboard(date, date, uuid) to authenticated;
grant execute on function public.list_finance_bank_accounts() to authenticated;
grant execute on function public.list_finance_bank_transactions(uuid, date, date) to authenticated;
grant execute on function public.create_finance_bank_account(jsonb) to authenticated;
grant execute on function public.create_finance_bank_transaction(jsonb) to authenticated;
grant execute on function public.list_finance_payables(text, date, date) to authenticated;
grant execute on function public.create_finance_payable(jsonb) to authenticated;
grant execute on function public.record_finance_payable_payment(uuid, jsonb) to authenticated;
grant execute on function public.list_finance_receivables(text, date, date) to authenticated;
grant execute on function public.create_finance_receivable(jsonb) to authenticated;
grant execute on function public.record_finance_receivable_collection(uuid, jsonb) to authenticated;
grant execute on function public.get_finance_cash_flow(date, date) to authenticated;
grant execute on function public.create_or_get_finance_reconciliation(uuid, int, int) to authenticated;
grant execute on function public.update_finance_reconciliation_item(uuid, boolean) to authenticated;
grant execute on function public.update_finance_reconciliation_statement(uuid, jsonb) to authenticated;
grant execute on function public.close_finance_reconciliation(uuid, boolean) to authenticated;
