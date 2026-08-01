-- Rollback for 200_get_executive_dashboard_metrics.sql (lab / manual only).

revoke all on function public.get_executive_dashboard_metrics(timestamptz) from public;
drop function if exists public.get_executive_dashboard_metrics(timestamptz);

revoke all on function public.executive_partial_open_snapshot(timestamptz) from public;
drop function if exists public.executive_partial_open_snapshot(timestamptz);

revoke all on function public.executive_period_bounds(timestamptz, text, text) from public;
drop function if exists public.executive_period_bounds(timestamptz, text, text);

revoke all on function public.executive_period_start_local(timestamp, text) from public;
drop function if exists public.executive_period_start_local(timestamp, text);

revoke all on function public.executive_operational_day_start(timestamptz) from public;
drop function if exists public.executive_operational_day_start(timestamptz);

revoke all on function public.executive_gt_local_ts(timestamptz) from public;
drop function if exists public.executive_gt_local_ts(timestamptz);

revoke all on function public.is_executive_dashboard_reader() from public;
drop function if exists public.is_executive_dashboard_reader();

-- Legacy A2.1 policy (188); safe no-op if never applied.
drop policy if exists "pos_order_payments_executive_read" on public.pos_order_payments;
