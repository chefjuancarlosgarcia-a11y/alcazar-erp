-- Regression + oracle tests for 200_get_executive_dashboard_metrics.sql
-- Run AFTER applying 200 in isolated lab. BEGIN … ROLLBACK (no COMMIT).

begin;

create or replace function public.test_get_executive_dashboard_metrics_200()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_ref timestamptz := '2026-07-31 13:34:00+00';
  v_admin uuid := 'a2100000-0000-4000-8000-000000000001';
  v_ceo uuid := 'a2100000-0000-4000-8000-000000000002';
  v_gerente uuid := 'a2100000-0000-4000-8000-000000000003';
  v_mesero uuid := 'a2100000-0000-4000-8000-000000000004';
  v_inactive uuid := 'a2100000-0000-4000-8000-000000000005';
  v_payload jsonb;
  v_err text;
  v_day_cur_start timestamptz;
  v_day_cur_end timestamptz;
  v_day_prev_start timestamptz;
  v_day_prev_end timestamptz;
  v_order_partial uuid := 'a2110000-0000-4000-8000-000000000010';
  v_order_paid_no_at uuid := 'a2130000-0000-4000-8000-000000000099';
  v_payment_valid uuid := 'a2120000-0000-4000-8000-000000000020';
  v_payment_void uuid := 'a2120000-0000-4000-8000-000000000021';
begin
  return query select 'static_security_invoker'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'get_executive_dashboard_metrics'
        and not p.prosecdef
    ),
    'get_executive_dashboard_metrics.prosecdef is false'::text;

  return query select 'static_search_path'::text,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_executive_dashboard_metrics'
        and exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
          where split_part(cfg, '=', 1) = 'search_path'
            and btrim(split_part(cfg, '=', 2), ' "') = ''
        )
    ),
    'search_path empty'::text;

  return query select 'static_no_payments_executive_rls'::text,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'pos_order_payments'
        and policyname = 'pos_order_payments_executive_read'
    ),
    'pos_order_payments_executive_read must not exist in v2'::text;

  return query select 'static_partial_open_definer'::text,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'executive_partial_open_snapshot'
        and p.prosecdef
    ),
    'executive_partial_open_snapshot is SECURITY DEFINER'::text;

  perform set_config('session_replication_role', 'replica', true);

  insert into auth.users (id, email) values
    (v_admin, 'admin-a21@lab.local'),
    (v_ceo, 'ceo-a21@lab.local'),
    (v_gerente, 'gerente-a21@lab.local'),
    (v_mesero, 'mesero-a21@lab.local'),
    (v_inactive, 'inactive-a21@lab.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, email, role, status) values
    (v_admin, 'Admin Lab', 'admin-a21@lab.local', 'admin', 'active'),
    (v_ceo, 'CEO Lab', 'ceo-a21@lab.local', 'ceo', 'active'),
    (v_gerente, 'Gerente Lab', 'gerente-a21@lab.local', 'gerente_general', 'active'),
    (v_mesero, 'Mesero Lab', 'mesero-a21@lab.local', 'mesero', 'active'),
    (v_inactive, 'Inactive Lab', 'inactive-a21@lab.local', 'gerente_general', 'inactive')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  insert into public.pos_orders (id, table_id, status, subtotal, total, created_at, paid_at, waiter_id) values
    ('a2130000-0000-4000-8000-000000000001', 't1', 'paid', 100, 100, '2026-07-31 10:00:00+00', '2026-07-31 12:00:00+00', v_admin),
    ('a2130000-0000-4000-8000-000000000002', 't2', 'paid', 80, 80, '2026-07-30 10:00:00+00', '2026-07-30 12:00:00+00', v_admin),
    ('a2130000-0000-4000-8000-000000000003', 't3', 'open', 50, 50, '2026-07-31 11:00:00+00', null, v_admin),
    ('a2130000-0000-4000-8000-000000000004', 't4', 'sent', 40, 40, '2026-07-31 11:30:00+00', null, v_admin),
    ('a2130000-0000-4000-8000-000000000005', 't5', 'awaiting_bill', 30, 30, '2026-07-31 12:30:00+00', null, v_admin),
    ('a2130000-0000-4000-8000-000000000006', 't6', 'sent_to_cashier', 20, 20, '2026-07-31 13:00:00+00', null, v_admin),
    ('a2130000-0000-4000-8000-000000000007', 't7', 'cancelled', 999, 999, '2026-07-31 12:00:00+00', null, v_admin),
    ('a2130000-0000-4000-8000-000000000008', 't8', 'paid', 0, 0, '2026-07-31 11:00:00+00', '2026-07-31 11:30:00+00', v_admin),
    (v_order_partial, 't9', 'partially_paid', 150, 150, '2026-07-31 10:30:00+00', null, v_admin),
    ('a2130000-0000-4000-8000-000000000009', 't10', 'open', 25, 25, '2026-07-28 15:00:00+00', null, v_admin),
    (v_order_paid_no_at, 't11', 'paid', 60, 60, '2026-07-31 12:00:00+00', null, v_admin);

  insert into public.pos_order_payments (id, order_id, payment_number, payment_method, amount, status, created_at) values
    (v_payment_valid, v_order_partial, 1, 'cash', 75.00, 'paid', '2026-07-31 13:00:00+00'),
    (v_payment_void, v_order_partial, 2, 'cash', 50.00, 'void', '2026-07-31 13:10:00+00');

  perform set_config('session_replication_role', 'origin', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    v_payload := public.get_executive_dashboard_metrics(v_ref);
  exception when others then
    return query select 'rpc_admin_call'::text, false, SQLERRM;
    return;
  end;

  return query select 'contract_version'::text,
    (v_payload ->> 'contract_version')::int = 2,
    coalesce(v_payload ->> 'contract_version', 'missing');

  return query select 'metrics_non_sumable_partial_open'::text,
    v_payload -> 'metrics_non_sumable' ? 'partial_open',
    v_payload ->> 'metrics_non_sumable';

  select b.start_at, b.end_at into v_day_cur_start, v_day_cur_end
  from public.executive_period_bounds(v_ref, 'day', 'current') b;

  select b.start_at, b.end_at into v_day_prev_start, v_day_prev_end
  from public.executive_period_bounds(v_ref, 'day', 'previous') b;

  return query select 'range_day_semiopen'::text,
    v_day_cur_end = v_ref and v_day_cur_start = public.executive_operational_day_start(v_ref),
    format('cur [%s,%s)', v_day_cur_start, v_day_cur_end);

  return query select 'settled_day_paid_only'::text,
    (v_payload #>> '{settled,current,day,sales}')::numeric = 100
      and (v_payload #>> '{settled,current,day,orders}')::bigint = 2,
    format('sales=%s orders=%s', v_payload #>> '{settled,current,day,sales}', v_payload #>> '{settled,current,day,orders}');

  return query select 'settled_day_prev_same_slot'::text,
    (v_payload #>> '{settled,previous,day,sales}')::numeric = 80
      and (v_payload #>> '{settled,previous,day,orders}')::bigint = 1,
    v_payload #>> '{settled,previous,day,sales}';

  return query select 'settled_excludes_paid_without_paid_at'::text,
    (v_payload #>> '{settled,current,day,orders}')::bigint = 2
      and (v_payload #>> '{data_quality,paid_without_paid_at}')::bigint = 1,
    'paid row without paid_at excluded from settled'::text;

  return query select 'partial_open_snapshot'::text,
    (v_payload #>> '{partial_open,orders}')::bigint = 1
      and (v_payload #>> '{partial_open,collected}')::numeric = 75
      and (v_payload #>> '{partial_open,outstanding}')::numeric = 75,
    v_payload #>> '{partial_open,collected}';

  return query select 'partial_open_excludes_void'::text,
    (v_payload #>> '{partial_open,collected}')::numeric = 75,
    'void payment not counted in partial_open.collected'::text;

  return query select 'no_double_count_settled_vs_partial_open'::text,
    (v_payload #>> '{settled,current,day,sales}')::numeric = 100
      and (v_payload #>> '{partial_open,collected}')::numeric = 75,
    'partial payment not in settled.sales'::text;

  return query select 'in_progress_current_op_day'::text,
    (v_payload #>> '{in_progress,sales}')::numeric = 140
      and (v_payload #>> '{in_progress,orders}')::bigint = 4,
    v_payload #>> '{in_progress,sales}';

  return query select 'in_progress_stale_metadata'::text,
    (v_payload #>> '{in_progress,stale_outside_current_operational_day_orders}')::bigint = 1
      and (v_payload #>> '{in_progress,stale_outside_current_operational_day_sales}')::numeric = 25,
    v_payload #>> '{in_progress,stale_outside_current_operational_day_orders}';

  return query select 'no_individual_rows_in_payload'::text,
    not (v_payload::text ilike '%order_id%' or v_payload::text ilike '%waiter%'),
    'aggregates only'::text;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.get_executive_dashboard_metrics(v_ref);
    return query select 'security_mesero_denied'::text, false, 'mesero should be rejected';
  exception when others then
    v_err := SQLERRM;
    return query select 'security_mesero_denied'::text, v_err ilike '%permiso%', v_err;
  end;

  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  begin
    perform public.get_executive_dashboard_metrics(v_ref);
    return query select 'security_inactive_denied'::text, false, 'inactive should be rejected';
  exception when others then
    v_err := SQLERRM;
    return query select 'security_inactive_denied'::text, v_err ilike '%permiso%', v_err;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_executive_dashboard_metrics(v_ref);
    return query select 'security_anonymous_denied'::text, false, 'anon should be rejected';
  exception when others then
    v_err := SQLERRM;
    return query select 'security_anonymous_denied'::text, v_err ilike '%Authentication%', v_err;
  end;

  perform set_config('request.jwt.claim.sub', v_ceo::text, true);
  begin
    perform public.get_executive_dashboard_metrics(v_ref);
    return query select 'security_ceo_allowed'::text, true, 'ceo ok';
  exception when others then
    return query select 'security_ceo_allowed'::text, false, SQLERRM;
  end;

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  begin
    perform public.get_executive_dashboard_metrics(v_ref);
    return query select 'security_gerente_allowed'::text, true, 'gerente ok';
  exception when others then
    return query select 'security_gerente_allowed'::text, false, SQLERRM;
  end;

  return query select 'operational_day_cutoff_0400'::text,
    public.executive_operational_day_start('2026-07-31 09:59:00+00')
      = timestamptz '2026-07-30 10:00:00+00'
      and public.executive_operational_day_start('2026-07-31 10:00:00+00')
      = timestamptz '2026-07-31 10:00:00+00',
    '03:59 GT belongs to previous op day; 04:00 starts new day'::text;

  return query select 'leap_year_month_bounds'::text,
    exists (
      select 1
      from public.executive_period_bounds('2024-03-01 12:00:00+00', 'month', 'current') b
      where b.start_at is not null and b.end_at > b.start_at
    ),
    'month bounds valid in leap year'::text;

  return;
end;
$$;

with results as materialized (
  select * from public.test_get_executive_dashboard_metrics_200()
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where passed)::bigint as passed_total,
    count(*) filter (where not passed)::bigint as failed_total
  from results
)
select r.scenario, r.passed, r.detail, s.total, s.passed_total, s.failed_total
from results r
cross join summary s
order by r.passed asc, r.scenario;

drop function if exists public.test_get_executive_dashboard_metrics_200();

rollback;
