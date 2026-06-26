-- Hotfix: get_finance_cash_flow() mezclaba jsonb_agg() con sum() OVER().
-- PostgreSQL no permite funciones de ventana dentro de funciones agregadas.

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

revoke all on function public.get_finance_cash_flow(date, date) from public;
grant execute on function public.get_finance_cash_flow(date, date) to authenticated;
