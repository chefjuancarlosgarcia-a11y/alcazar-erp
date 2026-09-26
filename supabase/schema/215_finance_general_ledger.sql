-- Finance accounting — Libro Mayor.
-- Apply after 209_finance_general_journal_helper_acl.sql.
-- Number 215. Reserved and not included here: 210 unused, 211 POS/Caja,
-- 212 payment-session RLS, 213 IGSS medical suspension, 214 IGSS approval guard.
-- Read-only report RPC. Does not write supabase_migrations.schema_migrations.
-- Does not create tables and does not modify journal rows.

create or replace function public.get_finance_general_ledger(
  p_account_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_period_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page integer := coalesce(p_page, 1);
  v_page_size integer := coalesce(p_page_size, 50);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_account public.finance_chart_accounts;
  v_period_start date;
  v_period_end date;
  v_effective_from date;
  v_effective_to date;
  v_branch_scope uuid[];
  v_opening numeric(18, 2);
  v_period_debit numeric(18, 2);
  v_period_credit numeric(18, 2);
  v_closing numeric(18, 2);
  v_movement_count bigint;
  v_match_count bigint;
  v_total_pages integer;
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if not public.can_view_accounting() then
    raise exception 'No tienes permiso para consultar reportes contables.';
  end if;

  if p_account_id is null then
    raise exception 'Seleccione una cuenta contable de detalle.';
  end if;

  select * into v_account
  from public.finance_chart_accounts
  where id = p_account_id;

  if not found then
    raise exception 'La cuenta contable no existe.';
  end if;

  if v_account.account_kind <> 'detail' then
    raise exception 'El Libro Mayor solo consulta cuentas de detalle.';
  end if;

  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'La fecha desde no puede ser posterior a la fecha hasta.';
  end if;

  if p_period_id is not null then
    select start_date, end_date into v_period_start, v_period_end
    from public.finance_accounting_periods
    where id = p_period_id;

    if not found then
      raise exception 'El periodo contable no existe.';
    end if;

    v_effective_from := v_period_start;
    v_effective_to := v_period_end;
    if p_from_date is not null and p_from_date > v_effective_from then
      v_effective_from := p_from_date;
    end if;
    if p_to_date is not null and p_to_date < v_effective_to then
      v_effective_to := p_to_date;
    end if;
    if v_effective_from > v_effective_to then
      raise exception 'El periodo contable y el rango de fechas no se intersectan.';
    end if;
  else
    v_effective_from := p_from_date;
    v_effective_to := p_to_date;
  end if;

  if v_page < 1 then
    raise exception 'El número de página debe ser mayor o igual a 1.';
  end if;

  if v_page_size < 1 or v_page_size > 500 then
    raise exception 'El tamaño de página debe estar entre 1 y 500.';
  end if;

  v_branch_scope := public.accounting_journal_branch_scope();

  with scoped as (
    select
      jl.id as line_id,
      je.id as entry_id,
      je.entry_date,
      je.entry_number,
      je.reference as entry_reference,
      je.description as entry_description,
      jl.line_number,
      jl.description as line_description,
      jl.reference as line_reference,
      jl.branch_id,
      b.code as branch_code,
      b.name as branch_name,
      jl.cost_center_id,
      cc.code as cost_center_code,
      cc.name as cost_center_name,
      jl.debit,
      jl.credit,
      je.period_id,
      (je.reversal_of_id is not null) as is_reversal,
      orig.entry_number as reversal_of_entry_number,
      case
        when v_account.natural_balance = 'credit' then jl.credit - jl.debit
        else jl.debit - jl.credit
      end as signed_movement
    from public.finance_journal_entries je
    inner join public.finance_journal_lines jl on jl.journal_entry_id = je.id
    left join public.branches b on b.id = jl.branch_id
    left join public.finance_cost_centers cc on cc.id = jl.cost_center_id
    left join public.finance_journal_entries orig on orig.id = je.reversal_of_id
    where je.status = 'posted'
      and je.posted_at is not null
      and je.posted_at <= v_snapshot_at
      and jl.account_id = p_account_id
      and (p_branch_id is null or jl.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and (
        v_branch_scope is null
        or jl.branch_id is null
        or jl.branch_id = any (v_branch_scope)
      )
  ),
  opening as (
    select coalesce(sum(signed_movement), 0)::numeric(18, 2) as opening_balance
    from scoped
    where v_effective_from is not null
      and entry_date < v_effective_from
  ),
  movements as (
    select *
    from scoped
    where (v_effective_from is null or entry_date >= v_effective_from)
      and (v_effective_to is null or entry_date <= v_effective_to)
      and (p_period_id is null or period_id = p_period_id)
  ),
  valued as (
    select
      m.*,
      (
        o.opening_balance
        + sum(m.signed_movement) over (
          order by m.entry_date asc, m.entry_number asc, m.line_number asc, m.line_id asc
          rows between unbounded preceding and current row
        )
      )::numeric(18, 2) as running_balance
    from movements m
    cross join opening o
  ),
  display as (
    select *
    from valued
    where v_search is null
      or position(lower(v_search) in lower(coalesce(entry_number, ''))) > 0
      or position(lower(v_search) in lower(coalesce(entry_reference, ''))) > 0
      or position(lower(v_search) in lower(coalesce(line_reference, ''))) > 0
      or position(lower(v_search) in lower(coalesce(entry_description, ''))) > 0
      or position(lower(v_search) in lower(coalesce(line_description, ''))) > 0
  ),
  totals as (
    select
      (select opening_balance from opening) as opening_balance,
      coalesce(sum(debit), 0)::numeric(18, 2) as period_debit,
      coalesce(sum(credit), 0)::numeric(18, 2) as period_credit,
      coalesce(sum(signed_movement), 0)::numeric(18, 2) as period_signed,
      count(*)::bigint as movement_count
    from movements
  ),
  matches as (
    select count(*)::bigint as match_count from display
  ),
  paged as (
    select *
    from display
    order by entry_date asc, entry_number asc, line_number asc, line_id asc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select
    t.opening_balance,
    t.period_debit,
    t.period_credit,
    (t.opening_balance + t.period_signed)::numeric(18, 2),
    t.movement_count,
    m.match_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'line_id', p.line_id,
          'entry_id', p.entry_id,
          'entry_date', p.entry_date,
          'entry_number', p.entry_number,
          'entry_reference', p.entry_reference,
          'entry_description', p.entry_description,
          'line_number', p.line_number,
          'line_description', p.line_description,
          'line_reference', p.line_reference,
          'account_code', v_account.code,
          'account_name', v_account.name,
          'branch_code', p.branch_code,
          'branch_name', p.branch_name,
          'cost_center_code', p.cost_center_code,
          'cost_center_name', p.cost_center_name,
          'debit', p.debit,
          'credit', p.credit,
          'running_balance', p.running_balance,
          'balance_side', case
            when abs(p.running_balance) < 0.005 then 'zero'
            when p.running_balance > 0 and v_account.natural_balance = 'credit' then 'credit'
            when p.running_balance > 0 then 'debit'
            when v_account.natural_balance = 'debit' then 'credit'
            else 'debit'
          end,
          'balance_side_label', case
            when abs(p.running_balance) < 0.005 then 'Cero'
            when p.running_balance > 0 and v_account.natural_balance = 'credit' then 'Acreedor'
            when p.running_balance > 0 then 'Deudor'
            when v_account.natural_balance = 'debit' then 'Acreedor'
            else 'Deudor'
          end,
          'contrary_to_nature', p.running_balance < -0.004,
          'is_reversal', p.is_reversal,
          'reversal_of_entry_number', p.reversal_of_entry_number
        )
        order by p.entry_date asc, p.entry_number asc, p.line_number asc, p.line_id asc
      )
      from paged p
    ), '[]'::jsonb)
  into v_opening, v_period_debit, v_period_credit, v_closing, v_movement_count, v_match_count, v_rows
  from totals t
  cross join matches m;

  v_total_pages := case
    when v_match_count = 0 then 0
    else ceil(v_match_count::numeric / v_page_size::numeric)::integer
  end;

  if v_match_count = 0 and v_page <> 1 then
    raise exception 'La página solicitada está fuera de rango.';
  end if;

  if v_match_count > 0 and v_page > v_total_pages then
    raise exception 'La página solicitada está fuera de rango.';
  end if;

  return jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_account.id,
      'code', v_account.code,
      'name', v_account.name,
      'natural_balance', v_account.natural_balance,
      'is_active', v_account.is_active,
      'accepts_entries', v_account.accepts_entries,
      'account_kind', v_account.account_kind
    ),
    'scope', case
      when p_branch_id is not null and p_cost_center_id is not null then 'branch_and_cost_center'
      when p_branch_id is not null then 'branch'
      when p_cost_center_id is not null then 'cost_center'
      else 'global'
    end,
    'effective_from', v_effective_from,
    'effective_to', v_effective_to,
    'opening_balance', v_opening,
    'opening_balance_side', case
      when abs(v_opening) < 0.005 then 'zero'
      when v_opening > 0 and v_account.natural_balance = 'credit' then 'credit'
      when v_opening > 0 then 'debit'
      when v_account.natural_balance = 'debit' then 'credit'
      else 'debit'
    end,
    'opening_contrary', v_opening < -0.004,
    'period_debit', v_period_debit,
    'period_credit', v_period_credit,
    'closing_balance', v_closing,
    'closing_balance_side', case
      when abs(v_closing) < 0.005 then 'zero'
      when v_closing > 0 and v_account.natural_balance = 'credit' then 'credit'
      when v_closing > 0 then 'debit'
      when v_account.natural_balance = 'debit' then 'credit'
      else 'debit'
    end,
    'closing_contrary', v_closing < -0.004,
    'movement_count', v_movement_count,
    'match_count', v_match_count,
    'search_applied', v_search is not null,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'page', v_page,
    'page_size', v_page_size,
    'total_pages', v_total_pages,
    'snapshot_at', v_snapshot_at
  );
end;
$$;

revoke all on function public.get_finance_general_ledger(
  uuid, date, date, uuid, uuid, uuid, text, integer, integer, timestamptz
) from public, anon, service_role;

grant execute on function public.get_finance_general_ledger(
  uuid, date, date, uuid, uuid, uuid, text, integer, integer, timestamptz
) to authenticated;
