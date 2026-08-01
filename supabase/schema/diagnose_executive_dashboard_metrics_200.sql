-- Post-apply diagnostics for 200 (read-only; safe in lab).
select
  p.proname,
  p.prosecdef as security_definer,
  pg_get_function_identity_arguments(p.oid) as args,
  coalesce(array_to_string(p.proconfig, ', '), '') as proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_executive_dashboard_metrics',
    'executive_partial_open_snapshot',
    'is_executive_dashboard_reader',
    'executive_operational_day_start',
    'executive_period_bounds'
  )
order by p.proname;

select policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'pos_order_payments'
order by policyname;

select
  has_function_privilege('authenticated', 'public.get_executive_dashboard_metrics(timestamptz)', 'EXECUTE') as auth_exec_main,
  has_function_privilege('public', 'public.get_executive_dashboard_metrics(timestamptz)', 'EXECUTE') as public_exec_main,
  has_function_privilege('authenticated', 'public.executive_partial_open_snapshot(timestamptz)', 'EXECUTE') as auth_exec_partial,
  has_function_privilege('public', 'public.executive_partial_open_snapshot(timestamptz)', 'EXECUTE') as public_exec_partial;

select count(*) as executive_payments_policy_count
from pg_policies
where schemaname = 'public'
  and tablename = 'pos_order_payments'
  and policyname = 'pos_order_payments_executive_read';
