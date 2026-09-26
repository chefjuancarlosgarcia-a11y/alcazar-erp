-- Finance accounting Phase A — General Journal (Libro Diario)
-- Apply after 204_finance_accounting_journal_engine.sql
-- Read-only report RPC for posted journal lines with server-side filters and pagination.

-- ---------------------------------------------------------------------------
-- Constants (documented in docs/finance-general-journal.md)
-- MAX_PAGE_SIZE = 500
-- MAX_EXPORT_ROWS = 10000 (enforced client-side; RPC exposes total_rows for guard)
-- ---------------------------------------------------------------------------

create or replace function public.finance_general_journal_row_to_json(
  p_line_id uuid,
  p_entry_id uuid,
  p_entry_date date,
  p_entry_number text,
  p_entry_reference text,
  p_entry_description text,
  p_line_number smallint,
  p_account_id uuid,
  p_account_code text,
  p_account_name text,
  p_line_description text,
  p_line_reference text,
  p_branch_id uuid,
  p_branch_code text,
  p_branch_name text,
  p_cost_center_id uuid,
  p_cost_center_code text,
  p_cost_center_name text,
  p_debit numeric,
  p_credit numeric,
  p_is_reversal boolean,
  p_reversal_of_id uuid,
  p_reversal_of_entry_number text,
  p_reversed_by_entry_id uuid
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'line_id', p_line_id,
    'entry_id', p_entry_id,
    'entry_date', p_entry_date,
    'entry_number', p_entry_number,
    'entry_reference', coalesce(p_entry_reference, ''),
    'entry_description', coalesce(p_entry_description, ''),
    'line_number', p_line_number,
    'account_id', p_account_id,
    'account_code', p_account_code,
    'account_name', p_account_name,
    'line_description', coalesce(p_line_description, ''),
    'line_reference', coalesce(p_line_reference, ''),
    'branch_id', p_branch_id,
    'branch_code', p_branch_code,
    'branch_name', p_branch_name,
    'cost_center_id', p_cost_center_id,
    'cost_center_code', p_cost_center_code,
    'cost_center_name', p_cost_center_name,
    'debit', round(coalesce(p_debit, 0), 2),
    'credit', round(coalesce(p_credit, 0), 2),
    'is_reversal', coalesce(p_is_reversal, false),
    'reversal_of_id', p_reversal_of_id,
    'reversal_of_entry_number', p_reversal_of_entry_number,
    'reversed_by_entry_id', p_reversed_by_entry_id
  );
$$;

create or replace function public.get_finance_general_journal(
  p_from_date date default null,
  p_to_date date default null,
  p_period_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_account_id uuid default null,
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
  v_branch_scope uuid[];
  v_total_rows bigint;
  v_total_entries bigint;
  v_total_debit numeric(18, 2);
  v_total_credit numeric(18, 2);
  v_difference numeric(18, 2);
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

  if v_page < 1 then
    raise exception 'El número de página debe ser mayor o igual a 1.';
  end if;

  if v_page_size < 1 or v_page_size > 500 then
    raise exception 'El tamaño de página debe estar entre 1 y 500.';
  end if;

  v_branch_scope := public.accounting_journal_branch_scope();

  with filtered as (
    select
      jl.id as line_id,
      je.id as entry_id,
      je.entry_date,
      je.entry_number,
      je.reference as entry_reference,
      je.description as entry_description,
      jl.line_number,
      jl.account_id,
      a.code as account_code,
      a.name as account_name,
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
      (je.reversal_of_id is not null) as is_reversal,
      je.reversal_of_id,
      orig.entry_number as reversal_of_entry_number,
      je.reversed_by_entry_id
    from public.finance_journal_entries je
    inner join public.finance_journal_lines jl on jl.journal_entry_id = je.id
    inner join public.finance_chart_accounts a on a.id = jl.account_id
    left join public.branches b on b.id = jl.branch_id
    left join public.finance_cost_centers cc on cc.id = jl.cost_center_id
    left join public.finance_journal_entries orig on orig.id = je.reversal_of_id
    where je.status = 'posted'
      and je.posted_at is not null
      and je.posted_at <= v_snapshot_at
      and (p_from_date is null or je.entry_date >= p_from_date)
      and (p_to_date is null or je.entry_date <= p_to_date)
      and (p_period_id is null or je.period_id = p_period_id)
      and (p_branch_id is null or jl.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and (p_account_id is null or jl.account_id = p_account_id)
      and (
        v_branch_scope is null
        or jl.branch_id is null
        or jl.branch_id = any(v_branch_scope)
      )
      and (
        v_search is null
        or position(lower(v_search) in lower(coalesce(je.entry_number, ''))) > 0
        or position(lower(v_search) in lower(coalesce(je.reference, ''))) > 0
        or position(lower(v_search) in lower(coalesce(je.description, ''))) > 0
        or position(lower(v_search) in lower(coalesce(a.code, ''))) > 0
        or position(lower(v_search) in lower(coalesce(a.name, ''))) > 0
        or position(lower(v_search) in lower(coalesce(jl.description, ''))) > 0
        or position(lower(v_search) in lower(coalesce(jl.reference, ''))) > 0
      )
  ),
  totals as (
    select
      count(*)::bigint as total_rows,
      count(distinct entry_id)::bigint as total_entries,
      coalesce(sum(debit), 0)::numeric(18, 2) as total_debit,
      coalesce(sum(credit), 0)::numeric(18, 2) as total_credit
    from filtered
  ),
  paged as (
    select *
    from filtered
    order by entry_date asc, entry_number asc, line_number asc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select
    t.total_rows,
    t.total_entries,
    t.total_debit,
    t.total_credit,
    coalesce((
      select jsonb_agg(
        public.finance_general_journal_row_to_json(
          p.line_id,
          p.entry_id,
          p.entry_date,
          p.entry_number,
          p.entry_reference,
          p.entry_description,
          p.line_number,
          p.account_id,
          p.account_code,
          p.account_name,
          p.line_description,
          p.line_reference,
          p.branch_id,
          p.branch_code,
          p.branch_name,
          p.cost_center_id,
          p.cost_center_code,
          p.cost_center_name,
          p.debit,
          p.credit,
          p.is_reversal,
          p.reversal_of_id,
          p.reversal_of_entry_number,
          p.reversed_by_entry_id
        )
        order by p.entry_date asc, p.entry_number asc, p.line_number asc
      )
      from paged p
    ), '[]'::jsonb)
  into v_total_rows, v_total_entries, v_total_debit, v_total_credit, v_rows
  from totals t;

  v_difference := round(v_total_debit - v_total_credit, 2);
  v_total_pages := case
    when v_total_rows = 0 then 0
    else ceil(v_total_rows::numeric / v_page_size::numeric)::integer
  end;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total_rows', coalesce(v_total_rows, 0),
    'total_entries', coalesce(v_total_entries, 0),
    'total_debit', coalesce(v_total_debit, 0),
    'total_credit', coalesce(v_total_credit, 0),
    'difference', coalesce(v_difference, 0),
    'page', v_page,
    'page_size', v_page_size,
    'total_pages', v_total_pages,
    'snapshot_at', v_snapshot_at
  );
end;
$$;

revoke all on function public.finance_general_journal_row_to_json(
  uuid, uuid, date, text, text, text, smallint, uuid, text, text, text, text,
  uuid, text, text, uuid, text, text, numeric, numeric, boolean, uuid, text, uuid
) from public;
revoke all on function public.get_finance_general_journal(
  date, date, uuid, uuid, uuid, uuid, text, integer, integer, timestamptz
) from public;

grant execute on function public.get_finance_general_journal(
  date, date, uuid, uuid, uuid, uuid, text, integer, integer, timestamptz
) to authenticated;
