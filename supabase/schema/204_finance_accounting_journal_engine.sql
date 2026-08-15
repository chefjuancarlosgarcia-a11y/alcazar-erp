-- Finance accounting Phase 2A-2 — journal engine (backend only)
-- Apply after 203_finance_accounting_multibranch_foundation.sql
-- Number 204: journal entries/lines, posting workflow, reversal, numbering.
-- No UI or operational integrations in this phase.

-- ---------------------------------------------------------------------------
-- Permissions (journal-specific capabilities)
-- ---------------------------------------------------------------------------

create or replace function public.can_view_accounting()
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

create or replace function public.can_create_journal()
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

create or replace function public.can_approve_journal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_create_journal();
$$;

create or replace function public.can_post_journal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_create_journal();
$$;

create or replace function public.can_post_journal_in_soft_closed_period()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_post_journal();
$$;

create or replace function public.can_reverse_journal()
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

-- Future branch-scoped access hook. NULL = unrestricted for current roles.
create or replace function public.accounting_journal_branch_scope()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid[];
$$;

revoke all on function public.can_view_accounting() from public;
revoke all on function public.can_create_journal() from public;
revoke all on function public.can_approve_journal() from public;
revoke all on function public.can_post_journal() from public;
revoke all on function public.can_post_journal_in_soft_closed_period() from public;
revoke all on function public.can_reverse_journal() from public;
revoke all on function public.accounting_journal_branch_scope() from public;
grant execute on function public.can_view_accounting() to authenticated;
grant execute on function public.can_create_journal() to authenticated;
grant execute on function public.can_approve_journal() to authenticated;
grant execute on function public.can_post_journal() to authenticated;
grant execute on function public.can_post_journal_in_soft_closed_period() to authenticated;
grant execute on function public.can_reverse_journal() to authenticated;
grant execute on function public.accounting_journal_branch_scope() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.finance_journal_entry_counters (
  period_year integer primary key check (period_year >= 2000 and period_year <= 2100),
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text,
  entry_date date not null,
  period_id uuid not null references public.finance_accounting_periods(id) on delete restrict,
  description text not null default '',
  reference text not null default '',
  source_module text,
  source_id uuid,
  source_event text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'posted')),
  currency text not null default 'GTQ' check (currency = 'GTQ'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejection_reason text not null default '',
  posted_at timestamptz,
  posted_by uuid references public.profiles(id) on delete set null,
  reversal_of_id uuid references public.finance_journal_entries(id) on delete restrict,
  reversed_by_entry_id uuid references public.finance_journal_entries(id) on delete restrict,
  reversal_reason text not null default '',
  constraint finance_journal_entries_reversal_pair_check
    check (reversal_of_id is null or reversed_by_entry_id is null),
  constraint finance_journal_entries_posted_number_check
    check (status <> 'posted' or entry_number is not null)
);

create unique index if not exists finance_journal_entries_entry_number_unique_idx
  on public.finance_journal_entries (entry_number)
  where entry_number is not null;

create index if not exists finance_journal_entries_period_idx
  on public.finance_journal_entries (period_id, status, entry_date desc);

create index if not exists finance_journal_entries_status_idx
  on public.finance_journal_entries (status, entry_date desc);

create unique index if not exists finance_journal_entries_source_idempotency_idx
  on public.finance_journal_entries (source_module, source_id, source_event)
  where source_module is not null
    and source_id is not null
    and source_event is not null
    and status = 'posted'
    and reversal_of_id is null;

create table if not exists public.finance_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.finance_journal_entries(id) on delete restrict,
  line_number smallint not null check (line_number >= 1),
  account_id uuid not null references public.finance_chart_accounts(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  cost_center_id uuid references public.finance_cost_centers(id) on delete restrict,
  description text not null default '',
  reference text not null default '',
  debit numeric(18, 2) not null default 0 check (debit >= 0),
  credit numeric(18, 2) not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_journal_lines_debit_credit_xor
    check (
      (debit > 0 and credit = 0)
      or (credit > 0 and debit = 0)
    ),
  constraint finance_journal_lines_unique_line_number
    unique (journal_entry_id, line_number)
);

create index if not exists finance_journal_lines_entry_idx
  on public.finance_journal_lines (journal_entry_id, line_number);

create index if not exists finance_journal_lines_account_idx
  on public.finance_journal_lines (account_id);

drop trigger if exists finance_journal_entries_updated_at on public.finance_journal_entries;
create trigger finance_journal_entries_updated_at
  before update on public.finance_journal_entries
  for each row execute function public.finance_set_updated_at();

drop trigger if exists finance_journal_lines_updated_at on public.finance_journal_lines;
create trigger finance_journal_lines_updated_at
  before update on public.finance_journal_lines
  for each row execute function public.finance_set_updated_at();

alter table public.finance_journal_entries enable row level security;
alter table public.finance_journal_lines enable row level security;

grant select on public.finance_journal_entries to authenticated;
grant select on public.finance_journal_lines to authenticated;
grant all on public.finance_journal_entries to service_role;
grant all on public.finance_journal_lines to service_role;
grant all on public.finance_journal_entry_counters to service_role;

drop policy if exists finance_journal_entries_select on public.finance_journal_entries;
create policy finance_journal_entries_select on public.finance_journal_entries
  for select to authenticated
  using (public.can_view_accounting());

drop policy if exists finance_journal_entries_insert on public.finance_journal_entries;
drop policy if exists finance_journal_entries_update on public.finance_journal_entries;
drop policy if exists finance_journal_lines_insert on public.finance_journal_lines;
drop policy if exists finance_journal_lines_update on public.finance_journal_lines;

-- Writes only through SECURITY DEFINER RPCs (owner privileges). authenticated = SELECT only.

drop policy if exists finance_journal_lines_select on public.finance_journal_lines;
create policy finance_journal_lines_select on public.finance_journal_lines
  for select to authenticated
  using (public.can_view_accounting());

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------

create or replace function public.finance_journal_entry_guard_transitions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'No se permite eliminar partidas contables.';
  end if;

  if old.status = 'draft' then
    if new.status not in ('draft', 'pending_approval') then
      raise exception 'Transición de estado inválida desde borrador.';
    end if;
    if (new.entry_date is distinct from old.entry_date or new.period_id is distinct from old.period_id)
      and new.status <> 'draft' then
      raise exception 'No se puede cambiar fecha o periodo al enviar la partida.';
    end if;
  elsif old.status = 'pending_approval' then
    if new.status not in ('pending_approval', 'draft', 'approved') then
      raise exception 'Transición de estado inválida desde pendiente de aprobación.';
    end if;
    if new.entry_date is distinct from old.entry_date or new.period_id is distinct from old.period_id then
      raise exception 'No se puede cambiar fecha o periodo después de enviar la partida.';
    end if;
  elsif old.status = 'approved' then
    if new.status not in ('approved', 'posted') then
      raise exception 'Transición de estado inválida desde aprobada.';
    end if;
    if new.entry_date is distinct from old.entry_date or new.period_id is distinct from old.period_id then
      raise exception 'No se puede cambiar fecha o periodo en partida aprobada.';
    end if;
  end if;

  if new.entry_number is not null and not (old.status = 'approved' and new.status = 'posted') then
    if old.entry_number is distinct from new.entry_number then
      raise exception 'El número de partida solo se asigna al contabilizar.';
    end if;
  end if;

  if new.reversal_of_id is distinct from old.reversal_of_id
     or (new.reversed_by_entry_id is distinct from old.reversed_by_entry_id
         and not (old.status = 'posted' and old.reversed_by_entry_id is null and new.reversed_by_entry_id is not null)) then
    raise exception 'Los enlaces de reversión solo pueden establecerse mediante la RPC de reversión.';
  end if;

  return new;
end;
$$;

create or replace function public.finance_journal_entry_block_posted_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'No se permite eliminar partidas contables.';
  end if;
  if old.status = 'posted' then
    if old.reversed_by_entry_id is null
      and new.reversed_by_entry_id is not null
    then
      if not exists (
        select 1
        from public.finance_journal_entries r
        where r.id = new.reversed_by_entry_id
          and r.reversal_of_id = old.id
          and r.status = 'posted'
      ) then
        raise exception 'Los enlaces de reversión solo pueden establecerse mediante la RPC de reversión.';
      end if;
      if new.status = old.status
      and new.entry_number is not distinct from old.entry_number
      and new.entry_date = old.entry_date
      and new.period_id = old.period_id
      and new.description = old.description
      and new.reference = old.reference
      and new.source_module is not distinct from old.source_module
      and new.source_id is not distinct from old.source_id
      and new.source_event is not distinct from old.source_event
      and new.currency = old.currency
      and new.reversal_of_id is not distinct from old.reversal_of_id
      and new.reversal_reason = old.reversal_reason
      then
        return new;
      end if;
    end if;
    raise exception 'Las partidas contabilizadas son inmutables.';
  end if;
  return new;
end;
$$;

create or replace function public.finance_journal_line_block_posted_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_entry_id uuid;
begin
  v_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  select status into v_status
  from public.finance_journal_entries
  where id = v_entry_id;

  if tg_op = 'DELETE' then
    if v_status <> 'draft' then
      raise exception 'Solo se pueden eliminar líneas de partidas en borrador.';
    end if;
    return old;
  end if;

  if v_status <> 'draft' then
    raise exception 'Solo se pueden modificar líneas de partidas en borrador.';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_journal_entries_guard_transitions on public.finance_journal_entries;
create trigger finance_journal_entries_guard_transitions
  before update or delete on public.finance_journal_entries
  for each row execute function public.finance_journal_entry_guard_transitions();

drop trigger if exists finance_journal_entries_block_posted on public.finance_journal_entries;
create trigger finance_journal_entries_block_posted
  before update on public.finance_journal_entries
  for each row execute function public.finance_journal_entry_block_posted_mutation();

drop trigger if exists finance_journal_lines_block_posted on public.finance_journal_lines;
create trigger finance_journal_lines_block_posted
  before update or delete on public.finance_journal_lines
  for each row execute function public.finance_journal_line_block_posted_parent();

revoke all on function public.finance_journal_entry_guard_transitions() from public;
revoke all on function public.finance_journal_entry_block_posted_mutation() from public;
revoke all on function public.finance_journal_line_block_posted_parent() from public;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.finance_journal_resolve_period(p_entry_date date)
returns public.finance_accounting_periods
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period public.finance_accounting_periods;
begin
  select * into v_period
  from public.finance_accounting_periods p
  where p_entry_date between p.start_date and p.end_date
  order by p.period_year desc, p.period_month desc
  limit 1;
  if not found then
    raise exception 'No existe un periodo contable para la fecha %.', p_entry_date;
  end if;
  return v_period;
end;
$$;

create or replace function public.finance_journal_next_entry_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.finance_journal_entry_counters.' || p_year::text));

  insert into public.finance_journal_entry_counters (period_year, last_number, updated_at)
  values (p_year, 1, now())
  on conflict (period_year) do update
  set last_number = public.finance_journal_entry_counters.last_number + 1,
      updated_at = now()
  returning last_number into v_next;

  return format('JE-%s-%s', p_year, lpad(v_next::text, 6, '0'));
end;
$$;

create or replace function public.finance_journal_validate_cost_center_branch(
  p_branch_id uuid,
  p_cost_center_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cc public.finance_cost_centers;
begin
  if p_cost_center_id is null then
    return;
  end if;

  select * into v_cc
  from public.finance_cost_centers
  where id = p_cost_center_id;

  if not found then
    raise exception 'Centro de costo no encontrado.';
  end if;
  if not v_cc.is_active then
    raise exception 'El centro de costo % está inactivo.', v_cc.code;
  end if;
  if v_cc.branch_id is null then
    return;
  end if;
  if p_branch_id is null or p_branch_id <> v_cc.branch_id then
    raise exception 'El centro de costo % pertenece a otra sucursal.', v_cc.code;
  end if;
end;
$$;

create or replace function public.finance_journal_validate_line(
  p_line jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.finance_chart_accounts;
  v_branch public.branches;
  v_debit numeric(18, 2) := round(coalesce((p_line ->> 'debit')::numeric, 0), 2);
  v_credit numeric(18, 2) := round(coalesce((p_line ->> 'credit')::numeric, 0), 2);
  v_branch_id uuid := nullif(p_line ->> 'branch_id', '')::uuid;
  v_cost_center_id uuid := nullif(p_line ->> 'cost_center_id', '')::uuid;
  v_account_id uuid := nullif(p_line ->> 'account_id', '')::uuid;
begin
  if v_account_id is null then
    raise exception 'La cuenta contable es obligatoria en cada línea.';
  end if;

  select * into v_account
  from public.finance_chart_accounts
  where id = v_account_id;

  if not found then
    raise exception 'Cuenta contable no encontrada.';
  end if;
  if not v_account.is_active then
    raise exception 'La cuenta % está inactiva.', v_account.code;
  end if;
  if v_account.account_kind <> 'detail' then
    raise exception 'La cuenta % es acumuladora y no acepta movimientos.', v_account.code;
  end if;
  if not v_account.accepts_entries then
    raise exception 'La cuenta % no acepta movimientos.', v_account.code;
  end if;

  if v_debit > 0 and v_credit > 0 then
    raise exception 'Una línea no puede tener débito y crédito simultáneos.';
  end if;
  if v_debit = 0 and v_credit = 0 then
    raise exception 'Una línea debe tener débito o crédito mayor a cero.';
  end if;

  if v_account.branch_dimension_rule = 'required' and v_branch_id is null then
    raise exception 'La cuenta % requiere sucursal.', v_account.code;
  end if;
  if v_account.branch_dimension_rule = 'prohibited' and v_branch_id is not null then
    raise exception 'La cuenta % prohíbe sucursal.', v_account.code;
  end if;
  if v_account.cost_center_dimension_rule = 'required' and v_cost_center_id is null then
    raise exception 'La cuenta % requiere centro de costo.', v_account.code;
  end if;
  if v_account.cost_center_dimension_rule = 'prohibited' and v_cost_center_id is not null then
    raise exception 'La cuenta % prohíbe centro de costo.', v_account.code;
  end if;

  if v_branch_id is not null then
    select * into v_branch from public.branches where id = v_branch_id;
    if not found then
      raise exception 'Sucursal no encontrada.';
    end if;
    if not v_branch.is_active then
      raise exception 'La sucursal % está inactiva.', v_branch.code;
    end if;
  end if;

  perform public.finance_journal_validate_cost_center_branch(v_branch_id, v_cost_center_id);
end;
$$;

create or replace function public.finance_journal_validate_entry_balance(p_entry_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line_count int;
  v_debit_total numeric(18, 2);
  v_credit_total numeric(18, 2);
begin
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  into v_line_count, v_debit_total, v_credit_total
  from public.finance_journal_lines
  where journal_entry_id = p_entry_id;

  if v_line_count < 2 then
    raise exception 'La partida requiere al menos dos líneas.';
  end if;
  if v_debit_total <> v_credit_total then
    raise exception 'La partida no cuadra: débitos %, créditos %.', v_debit_total, v_credit_total;
  end if;
end;
$$;

create or replace function public.finance_journal_assert_postable_period(
  p_period public.finance_accounting_periods
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_period.status = 'closed' then
    raise exception 'No se puede contabilizar en un periodo cerrado.';
  end if;
  if p_period.status = 'soft_closed' and not public.can_post_journal_in_soft_closed_period() then
    raise exception 'No tienes permiso para contabilizar en un periodo en cierre suave.';
  end if;
end;
$$;

create or replace function public.finance_journal_line_row_to_json(p_row public.finance_journal_lines)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'journal_entry_id', p_row.journal_entry_id,
    'line_number', p_row.line_number,
    'account_id', p_row.account_id,
    'account_code', (select a.code from public.finance_chart_accounts a where a.id = p_row.account_id),
    'branch_id', p_row.branch_id,
    'branch_code', (select b.code from public.branches b where b.id = p_row.branch_id),
    'cost_center_id', p_row.cost_center_id,
    'cost_center_code', (select c.code from public.finance_cost_centers c where c.id = p_row.cost_center_id),
    'description', p_row.description,
    'reference', p_row.reference,
    'debit', p_row.debit,
    'credit', p_row.credit
  );
$$;

create or replace function public.finance_journal_entry_row_to_json(p_row public.finance_journal_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'entry_number', p_row.entry_number,
    'entry_date', p_row.entry_date,
    'period_id', p_row.period_id,
    'description', p_row.description,
    'reference', p_row.reference,
    'source_module', p_row.source_module,
    'source_id', p_row.source_id,
    'source_event', p_row.source_event,
    'status', p_row.status,
    'currency', p_row.currency,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by,
    'submitted_at', p_row.submitted_at,
    'submitted_by', p_row.submitted_by,
    'approved_at', p_row.approved_at,
    'approved_by', p_row.approved_by,
    'rejected_at', p_row.rejected_at,
    'rejected_by', p_row.rejected_by,
    'rejection_reason', p_row.rejection_reason,
    'posted_at', p_row.posted_at,
    'posted_by', p_row.posted_by,
    'reversal_of_id', p_row.reversal_of_id,
    'reversed_by_entry_id', p_row.reversed_by_entry_id,
    'reversal_reason', p_row.reversal_reason,
    'lines', coalesce((
      select jsonb_agg(public.finance_journal_line_row_to_json(l) order by l.line_number)
      from public.finance_journal_lines l
      where l.journal_entry_id = p_row.id
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Period close guard (pending journal entries)
-- ---------------------------------------------------------------------------

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
  v_pending int;
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

  select * into v_row from public.finance_accounting_periods where id = p_id for update;
  if not found then raise exception 'Periodo contable no encontrado.'; end if;

  if v_status = 'closed' then
    -- Skip entries locked FOR UPDATE by concurrent post (in-flight contabilización).
    select count(*) into v_pending
    from (
      select je.id
      from public.finance_journal_entries je
      where je.period_id = p_id
        and je.status in ('draft', 'pending_approval', 'approved')
      for update skip locked
    ) pending_rows;
    if v_pending > 0 then
      raise exception 'No se puede cerrar un periodo con partidas pendientes de contabilizar.';
    end if;
  end if;

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

-- ---------------------------------------------------------------------------
-- Journal RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_finance_journal_draft(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_date date := nullif(p_data ->> 'entry_date', '')::date;
  v_period public.finance_accounting_periods;
  v_row public.finance_journal_entries;
begin
  if not public.can_create_journal() then
    raise exception 'No tienes permiso para crear partidas contables.';
  end if;
  if v_entry_date is null then
    raise exception 'La fecha de la partida es obligatoria.';
  end if;

  v_period := public.finance_journal_resolve_period(v_entry_date);

  insert into public.finance_journal_entries (
    entry_date, period_id, description, reference,
    source_module, source_id, source_event, currency,
    status, created_by, updated_by
  )
  values (
    v_entry_date,
    v_period.id,
    coalesce(nullif(trim(p_data ->> 'description'), ''), ''),
    coalesce(nullif(trim(p_data ->> 'reference'), ''), ''),
    nullif(trim(p_data ->> 'source_module'), ''),
    nullif(p_data ->> 'source_id', '')::uuid,
    nullif(trim(p_data ->> 'source_event'), ''),
    coalesce(nullif(trim(p_data ->> 'currency'), ''), 'GTQ'),
    'draft',
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  return public.finance_journal_entry_row_to_json(v_row);
end;
$$;

create or replace function public.replace_finance_journal_lines(
  p_entry_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.finance_journal_entries;
  v_line jsonb;
  v_line_number smallint;
begin
  if not public.can_create_journal() then
    raise exception 'No tienes permiso para editar partidas contables.';
  end if;

  select * into v_entry
  from public.finance_journal_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Partida contable no encontrada.';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'Solo se pueden editar partidas en borrador.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Las líneas deben enviarse como arreglo JSON.';
  end if;

  delete from public.finance_journal_lines where journal_entry_id = p_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    perform public.finance_journal_validate_line(v_line);
    v_line_number := coalesce((v_line ->> 'line_number')::smallint, 0);
    if v_line_number < 1 then
      raise exception 'El número de línea es obligatorio.';
    end if;

    insert into public.finance_journal_lines (
      journal_entry_id, line_number, account_id, branch_id, cost_center_id,
      description, reference, debit, credit
    )
    values (
      p_entry_id,
      v_line_number,
      nullif(v_line ->> 'account_id', '')::uuid,
      nullif(v_line ->> 'branch_id', '')::uuid,
      nullif(v_line ->> 'cost_center_id', '')::uuid,
      coalesce(nullif(trim(v_line ->> 'description'), ''), ''),
      coalesce(nullif(trim(v_line ->> 'reference'), ''), ''),
      round(coalesce((v_line ->> 'debit')::numeric, 0), 2),
      round(coalesce((v_line ->> 'credit')::numeric, 0), 2)
    );
  end loop;

  update public.finance_journal_entries
  set updated_by = auth.uid()
  where id = p_entry_id
  returning * into v_entry;

  return public.finance_journal_entry_row_to_json(v_entry);
end;
$$;

create or replace function public.submit_finance_journal_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.finance_journal_entries;
begin
  if not public.can_create_journal() then
    raise exception 'No tienes permiso para enviar partidas contables.';
  end if;

  select * into v_entry from public.finance_journal_entries where id = p_id for update;
  if not found then raise exception 'Partida contable no encontrada.'; end if;
  if v_entry.status <> 'draft' then
    raise exception 'Solo se pueden enviar partidas en borrador.';
  end if;

  perform public.finance_journal_validate_entry_balance(p_id);

  update public.finance_journal_entries
  set status = 'pending_approval',
      submitted_at = now(),
      submitted_by = auth.uid(),
      updated_by = auth.uid()
  where id = p_id
  returning * into v_entry;

  return public.finance_journal_entry_row_to_json(v_entry);
end;
$$;

create or replace function public.reject_finance_journal_entry(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.finance_journal_entries;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.can_approve_journal() then
    raise exception 'No tienes permiso para rechazar partidas contables.';
  end if;
  if v_reason is null then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;

  select * into v_entry from public.finance_journal_entries where id = p_id for update;
  if not found then raise exception 'Partida contable no encontrada.'; end if;
  if v_entry.status <> 'pending_approval' then
    raise exception 'Solo se pueden rechazar partidas pendientes de aprobación.';
  end if;

  update public.finance_journal_entries
  set status = 'draft',
      submitted_at = null,
      submitted_by = null,
      approved_at = null,
      approved_by = null,
      rejected_at = now(),
      rejected_by = auth.uid(),
      rejection_reason = v_reason,
      updated_by = auth.uid()
  where id = p_id
  returning * into v_entry;

  return public.finance_journal_entry_row_to_json(v_entry);
end;
$$;

create or replace function public.approve_finance_journal_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.finance_journal_entries;
begin
  if not public.can_approve_journal() then
    raise exception 'No tienes permiso para aprobar partidas contables.';
  end if;

  select * into v_entry from public.finance_journal_entries where id = p_id for update;
  if not found then raise exception 'Partida contable no encontrada.'; end if;
  if v_entry.status <> 'pending_approval' then
    raise exception 'Solo se pueden aprobar partidas pendientes de aprobación.';
  end if;

  perform public.finance_journal_validate_entry_balance(p_id);

  update public.finance_journal_entries
  set status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  where id = p_id
  returning * into v_entry;

  return public.finance_journal_entry_row_to_json(v_entry);
end;
$$;

create or replace function public.post_finance_journal_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.finance_journal_entries;
  v_period public.finance_accounting_periods;
  v_number text;
begin
  if not public.can_post_journal() then
    raise exception 'No tienes permiso para contabilizar partidas.';
  end if;

  select * into v_entry from public.finance_journal_entries where id = p_id for update;
  if not found then raise exception 'Partida contable no encontrada.'; end if;
  if v_entry.status <> 'approved' then
    raise exception 'Solo se pueden contabilizar partidas aprobadas.';
  end if;

  select * into v_period from public.finance_accounting_periods where id = v_entry.period_id for update;
  perform public.finance_journal_assert_postable_period(v_period);
  perform public.finance_journal_validate_entry_balance(p_id);

  v_number := public.finance_journal_next_entry_number(extract(year from v_entry.entry_date)::integer);

  update public.finance_journal_entries
  set status = 'posted',
      entry_number = v_number,
      posted_at = now(),
      posted_by = auth.uid(),
      updated_by = auth.uid()
  where id = p_id
  returning * into v_entry;

  return public.finance_journal_entry_row_to_json(v_entry);
end;
$$;

create or replace function public.reverse_finance_journal_entry(
  p_id uuid,
  p_reason text,
  p_entry_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.finance_journal_entries;
  v_reversal public.finance_journal_entries;
  v_target_date date;
  v_period public.finance_accounting_periods;
  v_original_period public.finance_accounting_periods;
  v_number text;
  v_line record;
begin
  if not public.can_reverse_journal() then
    raise exception 'No tienes permiso para revertir partidas contables.';
  end if;

  v_target_date := coalesce(p_entry_date, current_date);

  select * into v_original
  from public.finance_journal_entries
  where id = p_id
  for update;

  if not found then raise exception 'Partida contable no encontrada.'; end if;
  if v_original.status <> 'posted' then
    raise exception 'Solo se pueden revertir partidas contabilizadas.';
  end if;
  if v_original.reversed_by_entry_id is not null then
    raise exception 'La partida ya fue revertida.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'El motivo de reversión es obligatorio.';
  end if;

  select * into v_original_period from public.finance_accounting_periods where id = v_original.period_id;

  if v_original_period.status = 'open' then
    if v_target_date < v_original_period.start_date or v_target_date > v_original_period.end_date then
      raise exception 'La reversión en periodo abierto debe usar una fecha dentro del periodo original.';
    end if;
    v_period := v_original_period;
    select * into v_period from public.finance_accounting_periods where id = v_period.id for update;
  else
    v_period := public.finance_journal_resolve_period(v_target_date);
    select * into v_period from public.finance_accounting_periods where id = v_period.id for update;
    if v_period.status <> 'open' then
      raise exception 'La reversión requiere un periodo contable abierto posterior.';
    end if;
    if v_period.start_date < v_original_period.start_date then
      raise exception 'La reversión debe registrarse en un periodo posterior al original.';
    end if;
  end if;

  perform public.finance_journal_assert_postable_period(v_period);

  v_number := public.finance_journal_next_entry_number(extract(year from v_target_date)::integer);

  insert into public.finance_journal_entries (
    entry_date, period_id, description, reference,
    source_module, source_id, source_event, currency,
    status, entry_number, reversal_of_id, reversal_reason,
    created_by, updated_by, posted_at, posted_by
  )
  values (
    v_target_date,
    v_period.id,
    coalesce('Reversión de ' || v_original.entry_number, 'Reversión contable'),
    v_original.reference,
    v_original.source_module,
    v_original.source_id,
    v_original.source_event,
    v_original.currency,
    'posted',
    v_number,
    v_original.id,
    trim(p_reason),
    auth.uid(),
    auth.uid(),
    now(),
    auth.uid()
  )
  returning * into v_reversal;

  for v_line in
    select * from public.finance_journal_lines where journal_entry_id = v_original.id order by line_number
  loop
    insert into public.finance_journal_lines (
      journal_entry_id, line_number, account_id, branch_id, cost_center_id,
      description, reference, debit, credit
    )
    values (
      v_reversal.id,
      v_line.line_number,
      v_line.account_id,
      v_line.branch_id,
      v_line.cost_center_id,
      v_line.description,
      v_line.reference,
      v_line.credit,
      v_line.debit
    );
  end loop;

  update public.finance_journal_entries
  set reversed_by_entry_id = v_reversal.id,
      updated_by = auth.uid()
  where id = v_original.id;

  return public.finance_journal_entry_row_to_json(v_reversal);
end;
$$;

create or replace function public.get_finance_journal_entry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry public.finance_journal_entries;
begin
  if not public.can_view_accounting() then
    raise exception 'No tienes permiso para consultar partidas contables.';
  end if;

  select * into v_entry from public.finance_journal_entries where id = p_id;
  if not found then raise exception 'Partida contable no encontrada.'; end if;

  return public.finance_journal_entry_row_to_json(v_entry);
end;
$$;

create or replace function public.list_finance_journal_entries(
  p_status text default null,
  p_period_id uuid default null,
  p_from_date date default null,
  p_to_date date default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_accounting() then
    raise exception 'No tienes permiso para consultar partidas contables.';
  end if;

  return coalesce((
    select jsonb_agg(public.finance_journal_entry_row_to_json(je) order by je.entry_date desc, je.created_at desc)
    from public.finance_journal_entries je
    where (p_status is null or je.status = lower(trim(p_status)))
      and (p_period_id is null or je.period_id = p_period_id)
      and (p_from_date is null or je.entry_date >= p_from_date)
      and (p_to_date is null or je.entry_date <= p_to_date)
      and (
        p_search is null or trim(p_search) = ''
        or je.description ilike '%' || trim(p_search) || '%'
        or je.reference ilike '%' || trim(p_search) || '%'
        or je.entry_number ilike '%' || trim(p_search) || '%'
      )
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.finance_journal_resolve_period(date) from public;
revoke all on function public.finance_journal_next_entry_number(integer) from public;
revoke all on function public.finance_journal_validate_cost_center_branch(uuid, uuid) from public;
revoke all on function public.finance_journal_validate_line(jsonb) from public;
revoke all on function public.finance_journal_validate_entry_balance(uuid) from public;
revoke all on function public.finance_journal_assert_postable_period(public.finance_accounting_periods) from public;
revoke all on function public.finance_journal_line_row_to_json(public.finance_journal_lines) from public;
revoke all on function public.finance_journal_entry_row_to_json(public.finance_journal_entries) from public;
revoke all on function public.create_finance_journal_draft(jsonb) from public;
revoke all on function public.replace_finance_journal_lines(uuid, jsonb) from public;
revoke all on function public.submit_finance_journal_entry(uuid) from public;
revoke all on function public.reject_finance_journal_entry(uuid, text) from public;
revoke all on function public.approve_finance_journal_entry(uuid) from public;
revoke all on function public.post_finance_journal_entry(uuid) from public;
revoke all on function public.reverse_finance_journal_entry(uuid, text, date) from public;
revoke all on function public.get_finance_journal_entry(uuid) from public;
revoke all on function public.list_finance_journal_entries(text, uuid, date, date, text) from public;

grant execute on function public.create_finance_journal_draft(jsonb) to authenticated;
grant execute on function public.replace_finance_journal_lines(uuid, jsonb) to authenticated;
grant execute on function public.submit_finance_journal_entry(uuid) to authenticated;
grant execute on function public.reject_finance_journal_entry(uuid, text) to authenticated;
grant execute on function public.approve_finance_journal_entry(uuid) to authenticated;
grant execute on function public.post_finance_journal_entry(uuid) to authenticated;
grant execute on function public.reverse_finance_journal_entry(uuid, text, date) to authenticated;
grant execute on function public.get_finance_journal_entry(uuid) to authenticated;
grant execute on function public.list_finance_journal_entries(text, uuid, date, date, text) to authenticated;
