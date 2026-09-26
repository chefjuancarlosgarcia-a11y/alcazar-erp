-- Finance accounting — Balanza de Comprobación.
-- Apply after 215_finance_general_ledger.sql.
-- Number 216. Reserved and not included here: 210 unused, 211 POS/Caja,
-- 212 payment-session RLS, 213 IGSS medical suspension, 214 IGSS approval guard.
-- 215 Libro Mayor stays unchanged.
-- Read-only report RPC. Does not write supabase_migrations.schema_migrations.
-- Does not create tables and does not modify journal rows.

create or replace function public.get_finance_trial_balance(
  p_from_date date default null,
  p_to_date date default null,
  p_period_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_search text default null,
  p_include_zero_accounts boolean default false,
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
  v_include_zero boolean := coalesce(p_include_zero_accounts, false);
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_period_start date;
  v_period_end date;
  v_effective_from date;
  v_effective_to date;
  v_branch_scope uuid[];
  v_opening_debit numeric(18, 2);
  v_opening_credit numeric(18, 2);
  v_period_debit numeric(18, 2);
  v_period_credit numeric(18, 2);
  v_closing_debit numeric(18, 2);
  v_closing_credit numeric(18, 2);
  v_account_count bigint;
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

  with lines as (
    select
      jl.account_id,
      jl.debit,
      jl.credit,
      (v_effective_from is not null and je.entry_date < v_effective_from) as is_opening,
      (
        (v_effective_from is null or je.entry_date >= v_effective_from)
        and (v_effective_to is null or je.entry_date <= v_effective_to)
        and (p_period_id is null or je.period_id = p_period_id)
      ) as is_movement
    from public.finance_journal_entries je
    inner join public.finance_journal_lines jl on jl.journal_entry_id = je.id
    where je.status = 'posted'
      and je.posted_at is not null
      and je.posted_at <= v_snapshot_at
      and (p_branch_id is null or jl.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and (
        v_branch_scope is null
        or jl.branch_id is null
        or jl.branch_id = any (v_branch_scope)
      )
  ),
  aggregated as (
    select
      l.account_id,
      coalesce(sum(l.debit) filter (where l.is_opening), 0)::numeric(18, 2) as opening_debit_sum,
      coalesce(sum(l.credit) filter (where l.is_opening), 0)::numeric(18, 2) as opening_credit_sum,
      coalesce(sum(l.debit) filter (where l.is_movement), 0)::numeric(18, 2) as period_debit,
      coalesce(sum(l.credit) filter (where l.is_movement), 0)::numeric(18, 2) as period_credit,
      count(*) filter (where l.is_movement)::bigint as movement_count
    from lines l
    group by l.account_id
  ),
  placed as (
    select
      a.id as account_id,
      a.code,
      a.name,
      a.natural_balance,
      a.parent_id,
      parent.code as parent_code,
      a.is_active,
      a.accepts_entries,
      coalesce(g.period_debit, 0)::numeric(18, 2) as period_debit,
      coalesce(g.period_credit, 0)::numeric(18, 2) as period_credit,
      coalesce(g.movement_count, 0)::bigint as movement_count,
      (
        case
          when a.natural_balance = 'credit'
            then coalesce(g.opening_credit_sum, 0) - coalesce(g.opening_debit_sum, 0)
          else coalesce(g.opening_debit_sum, 0) - coalesce(g.opening_credit_sum, 0)
        end
      )::numeric(18, 2) as opening_signed,
      (
        case
          when a.natural_balance = 'credit'
            then (coalesce(g.opening_credit_sum, 0) - coalesce(g.opening_debit_sum, 0))
              + (coalesce(g.period_credit, 0) - coalesce(g.period_debit, 0))
          else (coalesce(g.opening_debit_sum, 0) - coalesce(g.opening_credit_sum, 0))
            + (coalesce(g.period_debit, 0) - coalesce(g.period_credit, 0))
        end
      )::numeric(18, 2) as closing_signed
    from public.finance_chart_accounts a
    left join public.finance_chart_accounts parent on parent.id = a.parent_id
    left join aggregated g on g.account_id = a.id
    where a.account_kind = 'detail'
  ),
  sided as (
    select
      p.*,
      case
        when abs(p.opening_signed) < 0.005 then 0
        when p.opening_signed > 0 and p.natural_balance = 'debit' then p.opening_signed
        when p.opening_signed < 0 and p.natural_balance = 'credit' then -p.opening_signed
        else 0
      end::numeric(18, 2) as opening_debit,
      case
        when abs(p.opening_signed) < 0.005 then 0
        when p.opening_signed > 0 and p.natural_balance = 'credit' then p.opening_signed
        when p.opening_signed < 0 and p.natural_balance = 'debit' then -p.opening_signed
        else 0
      end::numeric(18, 2) as opening_credit,
      (p.opening_signed < -0.004) as opening_contrary,
      case
        when abs(p.closing_signed) < 0.005 then 0
        when p.closing_signed > 0 and p.natural_balance = 'debit' then p.closing_signed
        when p.closing_signed < 0 and p.natural_balance = 'credit' then -p.closing_signed
        else 0
      end::numeric(18, 2) as closing_debit,
      case
        when abs(p.closing_signed) < 0.005 then 0
        when p.closing_signed > 0 and p.natural_balance = 'credit' then p.closing_signed
        when p.closing_signed < 0 and p.natural_balance = 'debit' then -p.closing_signed
        else 0
      end::numeric(18, 2) as closing_credit,
      (p.closing_signed < -0.004) as closing_contrary,
      (
        abs(p.opening_signed) < 0.005
        and p.period_debit < 0.005
        and p.period_credit < 0.005
      ) as is_zero
    from placed p
  ),
  control as (
    select * from sided
    where v_include_zero or not is_zero
  ),
  visible as (
    select * from control
    where v_search is null
      or position(lower(v_search) in lower(code)) > 0
      or position(lower(v_search) in lower(name)) > 0
  ),
  totals as (
    select
      coalesce(sum(opening_debit), 0)::numeric(18, 2) as opening_debit_total,
      coalesce(sum(opening_credit), 0)::numeric(18, 2) as opening_credit_total,
      coalesce(sum(period_debit), 0)::numeric(18, 2) as period_debit_total,
      coalesce(sum(period_credit), 0)::numeric(18, 2) as period_credit_total,
      coalesce(sum(closing_debit), 0)::numeric(18, 2) as closing_debit_total,
      coalesce(sum(closing_credit), 0)::numeric(18, 2) as closing_credit_total,
      count(*)::bigint as account_count
    from control
  ),
  matches as (
    select count(*)::bigint as match_count from visible
  )
  select
    t.opening_debit_total,
    t.opening_credit_total,
    t.period_debit_total,
    t.period_credit_total,
    t.closing_debit_total,
    t.closing_credit_total,
    t.account_count,
    m.match_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', v.account_id,
        'code', v.code,
        'name', v.name,
        'natural_balance', v.natural_balance,
        'parent_id', v.parent_id,
        'parent_code', v.parent_code,
        'is_active', v.is_active,
        'accepts_entries', v.accepts_entries,
        'opening_debit', v.opening_debit,
        'opening_credit', v.opening_credit,
        'period_debit', v.period_debit,
        'period_credit', v.period_credit,
        'closing_debit', v.closing_debit,
        'closing_credit', v.closing_credit,
        'opening_contrary', v.opening_contrary,
        'closing_contrary', v.closing_contrary,
        'movement_count', v.movement_count
      ) order by v.code asc, v.account_id asc)
      from (
        select *
        from visible
        order by code asc, account_id asc
        offset (v_page - 1) * v_page_size
        limit v_page_size
      ) v
    ), '[]'::jsonb)
  into
    v_opening_debit, v_opening_credit, v_period_debit, v_period_credit,
    v_closing_debit, v_closing_credit, v_account_count, v_match_count, v_rows
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
    'scope', case
      when p_branch_id is not null and p_cost_center_id is not null then 'branch_and_cost_center'
      when p_branch_id is not null then 'branch'
      when p_cost_center_id is not null then 'cost_center'
      else 'global'
    end,
    'effective_from', v_effective_from,
    'effective_to', v_effective_to,
    'include_zero_accounts', v_include_zero,
    'opening_debit_total', v_opening_debit,
    'opening_credit_total', v_opening_credit,
    'period_debit_total', v_period_debit,
    'period_credit_total', v_period_credit,
    'closing_debit_total', v_closing_debit,
    'closing_credit_total', v_closing_credit,
    'opening_difference', (v_opening_debit - v_opening_credit)::numeric(18, 2),
    'period_difference', (v_period_debit - v_period_credit)::numeric(18, 2),
    'closing_difference', (v_closing_debit - v_closing_credit)::numeric(18, 2),
    'is_square',
      abs(v_opening_debit - v_opening_credit) < 0.005
      and abs(v_period_debit - v_period_credit) < 0.005
      and abs(v_closing_debit - v_closing_credit) < 0.005,
    'account_count', v_account_count,
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

revoke all on function public.get_finance_trial_balance(
  date, date, uuid, uuid, uuid, text, boolean, integer, integer, timestamptz
) from public, anon, service_role;

grant execute on function public.get_finance_trial_balance(
  date, date, uuid, uuid, uuid, text, boolean, integer, integer, timestamptz
) to authenticated;
