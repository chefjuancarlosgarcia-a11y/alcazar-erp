-- Executive dashboard aggregated metrics RPC (A2.1b contract v2).
-- Apply after 199_fix_operational_station_pos_catalog_parity.sql.
-- Business rules: America/Guatemala, operational day 04:00, semi-open ranges [start, end),
-- settled = paid orders by paid_at (never created_at fallback),
-- partial_open = snapshot of currently partially_paid orders (NOT sumable with settled),
-- in_progress = open pipeline statuses within current operational day (+ stale metadata).
-- SECURITY INVOKER on main RPC; payment aggregates via executive_partial_open_snapshot (DEFINER, no payments RLS).

create or replace function public.is_executive_dashboard_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_current_profile_active()
    and public.normalize_profile_role(public.current_profile_role()) in (
      'admin', 'ceo', 'gerente_general'
    );
$$;

revoke all on function public.is_executive_dashboard_reader() from public;
grant execute on function public.is_executive_dashboard_reader() to authenticated;

comment on function public.is_executive_dashboard_reader() is
  'True when the active session may read executive dashboard RPC metrics.';

create or replace function public.executive_gt_local_ts(p_at timestamptz)
returns timestamp
language sql
immutable
set search_path = ''
as $$
  select (coalesce(p_at, now()) at time zone 'America/Guatemala');
$$;

revoke all on function public.executive_gt_local_ts(timestamptz) from public;
grant execute on function public.executive_gt_local_ts(timestamptz) to authenticated;

create or replace function public.executive_operational_day_start(p_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  with local_ts as (
    select public.executive_gt_local_ts(p_at) as ts
  ),
  op_date as (
    select case
      when ts::time >= time '04:00:00' then ts::date
      else ts::date - 1
    end as d
    from local_ts
  )
  select ((select d from op_date) + time '04:00:00') at time zone 'America/Guatemala';
$$;

revoke all on function public.executive_operational_day_start(timestamptz) from public;
grant execute on function public.executive_operational_day_start(timestamptz) to authenticated;

create or replace function public.executive_period_start_local(
  p_local timestamp,
  p_grain text
)
returns timestamp
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_monday date;
  v_candidate timestamp;
begin
  case p_grain
    when 'day' then
      return public.executive_gt_local_ts(
        public.executive_operational_day_start((p_local at time zone 'America/Guatemala'))
      );
    when 'week' then
      v_monday := date_trunc('week', p_local)::date;
      v_candidate := v_monday + time '04:00:00';
      if p_local >= v_candidate then
        return v_candidate;
      end if;
      return v_candidate - interval '7 days';
    when 'month' then
      v_candidate := date_trunc('month', p_local)::date + time '04:00:00';
      if p_local >= v_candidate then
        return v_candidate;
      end if;
      return (date_trunc('month', p_local - interval '1 month')::date + time '04:00:00');
    when 'year' then
      v_candidate := make_date(extract(year from p_local)::int, 1, 1) + time '04:00:00';
      if p_local >= v_candidate then
        return v_candidate;
      end if;
      return make_date(extract(year from p_local)::int - 1, 1, 1) + time '04:00:00';
    else
      raise exception 'Unsupported executive period grain: %', p_grain;
  end case;
end;
$$;

revoke all on function public.executive_period_start_local(timestamp, text) from public;
grant execute on function public.executive_period_start_local(timestamp, text) to authenticated;

create or replace function public.executive_period_bounds(
  p_reference_at timestamptz,
  p_grain text,
  p_segment text
)
returns table (
  start_at timestamptz,
  end_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ref timestamptz := coalesce(p_reference_at, now());
  v_local timestamp := public.executive_gt_local_ts(v_ref);
  v_cur_start_local timestamp;
  v_cur_start timestamptz;
  v_prev_start_local timestamp;
  v_elapsed interval;
begin
  v_cur_start_local := public.executive_period_start_local(v_local, p_grain);
  v_cur_start := v_cur_start_local at time zone 'America/Guatemala';

  if p_segment = 'current' then
    start_at := v_cur_start;
    end_at := v_ref;
    return next;
    return;
  end if;

  if p_segment <> 'previous' then
    raise exception 'Unsupported executive period segment: %', p_segment;
  end if;

  v_elapsed := v_ref - v_cur_start;

  case p_grain
    when 'day' then
      v_prev_start_local := v_cur_start_local - interval '1 day';
    when 'week' then
      v_prev_start_local := v_cur_start_local - interval '7 days';
    when 'month' then
      v_prev_start_local := (date_trunc('month', v_cur_start_local - interval '1 day')::date + time '04:00:00');
    when 'year' then
      v_prev_start_local := make_date(extract(year from v_cur_start_local)::int - 1, 1, 1) + time '04:00:00';
    else
      raise exception 'Unsupported executive period grain: %', p_grain;
  end case;

  start_at := v_prev_start_local at time zone 'America/Guatemala';
  end_at := least(start_at + v_elapsed, v_cur_start);
  return next;
end;
$$;

revoke all on function public.executive_period_bounds(timestamptz, text, text) from public;
grant execute on function public.executive_period_bounds(timestamptz, text, text) to authenticated;

-- Aggregated partial-open snapshot without exposing pos_order_payments via RLS.
create or replace function public.executive_partial_open_snapshot(p_reference_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref timestamptz := coalesce(p_reference_at, now());
begin
  if auth.uid() is null then
    raise exception 'Authentication required for executive partial-open snapshot.';
  end if;

  if not public.is_executive_dashboard_reader() then
    raise exception 'No tienes permiso para consultar metricas ejecutivas.';
  end if;

  return (
    select jsonb_build_object(
      'orders', count(*)::bigint,
      'collected', round(coalesce(sum(pay.paid_sum), 0)::numeric, 2),
      'outstanding', round(coalesce(sum(greatest(o.total - pay.paid_sum, 0)), 0)::numeric, 2),
      'as_of', to_jsonb(v_ref)
    )
    from public.pos_orders o
    cross join lateral (
      select coalesce(sum(p.amount), 0)::numeric(14, 2) as paid_sum
      from public.pos_order_payments p
      where p.order_id = o.id
        and p.status = 'paid'
    ) pay
    where o.status = 'partially_paid'
  );
end;
$$;

comment on function public.executive_partial_open_snapshot(timestamptz) is
  'Operational snapshot of partially_paid orders; aggregates only. Not sumable with settled.sales.';

revoke all on function public.executive_partial_open_snapshot(timestamptz) from public;
grant execute on function public.executive_partial_open_snapshot(timestamptz) to authenticated;

create or replace function public.get_executive_dashboard_metrics(
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ref timestamptz := coalesce(p_reference_at, now());
  v_op_day_start timestamptz;
  v_op_day_end timestamptz;
  v_ranges jsonb := '{}'::jsonb;
  v_settled_current jsonb := '{}'::jsonb;
  v_settled_previous jsonb := '{}'::jsonb;
  v_grain text;
  v_seg text;
  v_start timestamptz;
  v_end timestamptz;
  v_day_cur_s timestamptz;
  v_day_cur_e timestamptz;
  v_day_prev_s timestamptz;
  v_day_prev_e timestamptz;
  v_week_cur_s timestamptz;
  v_week_cur_e timestamptz;
  v_week_prev_s timestamptz;
  v_week_prev_e timestamptz;
  v_month_cur_s timestamptz;
  v_month_cur_e timestamptz;
  v_month_prev_s timestamptz;
  v_month_prev_e timestamptz;
  v_year_cur_s timestamptz;
  v_year_cur_e timestamptz;
  v_year_prev_s timestamptz;
  v_year_prev_e timestamptz;
  v_min_settled timestamptz;
  v_sales numeric(14, 2);
  v_orders bigint;
  v_avg numeric(14, 2);
  v_in_sales numeric(14, 2);
  v_in_orders bigint;
  v_stale_orders bigint;
  v_stale_sales numeric(14, 2);
  v_paid_without_paid_at bigint;
  v_partial_open jsonb;
  v_day_cur_sales numeric(14, 2);
  v_day_cur_orders bigint;
  v_day_prev_sales numeric(14, 2);
  v_day_prev_orders bigint;
  v_week_cur_sales numeric(14, 2);
  v_week_cur_orders bigint;
  v_week_prev_sales numeric(14, 2);
  v_week_prev_orders bigint;
  v_month_cur_sales numeric(14, 2);
  v_month_cur_orders bigint;
  v_month_prev_sales numeric(14, 2);
  v_month_prev_orders bigint;
  v_year_cur_sales numeric(14, 2);
  v_year_cur_orders bigint;
  v_year_prev_sales numeric(14, 2);
  v_year_prev_orders bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required for executive dashboard metrics.';
  end if;

  if not public.is_executive_dashboard_reader() then
    raise exception 'No tienes permiso para consultar metricas ejecutivas.';
  end if;

  v_op_day_start := public.executive_operational_day_start(v_ref);
  v_op_day_end := v_op_day_start + interval '1 day';

  foreach v_grain in array array['day', 'week', 'month', 'year'] loop
    foreach v_seg in array array['current', 'previous'] loop
      select b.start_at, b.end_at
      into v_start, v_end
      from public.executive_period_bounds(v_ref, v_grain, v_seg) b;

      v_ranges := v_ranges || jsonb_build_object(
        v_grain,
        coalesce(v_ranges -> v_grain, '{}'::jsonb) || jsonb_build_object(
          v_seg,
          jsonb_build_object(
            'start_at', to_jsonb(v_start),
            'end_at', to_jsonb(v_end)
          )
        )
      );

      case v_grain
        when 'day' then
          if v_seg = 'current' then
            v_day_cur_s := v_start;
            v_day_cur_e := v_end;
          else
            v_day_prev_s := v_start;
            v_day_prev_e := v_end;
          end if;
        when 'week' then
          if v_seg = 'current' then
            v_week_cur_s := v_start;
            v_week_cur_e := v_end;
          else
            v_week_prev_s := v_start;
            v_week_prev_e := v_end;
          end if;
        when 'month' then
          if v_seg = 'current' then
            v_month_cur_s := v_start;
            v_month_cur_e := v_end;
          else
            v_month_prev_s := v_start;
            v_month_prev_e := v_end;
          end if;
        when 'year' then
          if v_seg = 'current' then
            v_year_cur_s := v_start;
            v_year_cur_e := v_end;
          else
            v_year_prev_s := v_start;
            v_year_prev_e := v_end;
          end if;
        else
          null;
      end case;
    end loop;
  end loop;

  v_min_settled := least(
    v_day_prev_s,
    v_week_prev_s,
    v_month_prev_s,
    v_year_prev_s
  );

  select
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_day_cur_s and o.paid_at < v_day_cur_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_day_cur_s and o.paid_at < v_day_cur_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_day_prev_s and o.paid_at < v_day_prev_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_day_prev_s and o.paid_at < v_day_prev_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_week_cur_s and o.paid_at < v_week_cur_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_week_cur_s and o.paid_at < v_week_cur_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_week_prev_s and o.paid_at < v_week_prev_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_week_prev_s and o.paid_at < v_week_prev_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_month_cur_s and o.paid_at < v_month_cur_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_month_cur_s and o.paid_at < v_month_cur_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_month_prev_s and o.paid_at < v_month_prev_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_month_prev_s and o.paid_at < v_month_prev_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_year_cur_s and o.paid_at < v_year_cur_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_year_cur_s and o.paid_at < v_year_cur_e),
    round(coalesce(sum(o.total) filter (
      where o.paid_at >= v_year_prev_s and o.paid_at < v_year_prev_e
    ), 0)::numeric, 2),
    count(*) filter (where o.paid_at >= v_year_prev_s and o.paid_at < v_year_prev_e)
  into
    v_day_cur_sales, v_day_cur_orders,
    v_day_prev_sales, v_day_prev_orders,
    v_week_cur_sales, v_week_cur_orders,
    v_week_prev_sales, v_week_prev_orders,
    v_month_cur_sales, v_month_cur_orders,
    v_month_prev_sales, v_month_prev_orders,
    v_year_cur_sales, v_year_cur_orders,
    v_year_prev_sales, v_year_prev_orders
  from public.pos_orders o
  where o.status = 'paid'
    and o.paid_at is not null
    and o.paid_at >= v_min_settled
    and o.paid_at < v_ref;

  v_settled_current := jsonb_build_object(
    'day', jsonb_build_object(
      'sales', v_day_cur_sales,
      'orders', v_day_cur_orders,
      'average_ticket', case when v_day_cur_orders > 0 then round(v_day_cur_sales / v_day_cur_orders, 2) else 0 end
    ),
    'week', jsonb_build_object(
      'sales', v_week_cur_sales,
      'orders', v_week_cur_orders,
      'average_ticket', case when v_week_cur_orders > 0 then round(v_week_cur_sales / v_week_cur_orders, 2) else 0 end
    ),
    'month', jsonb_build_object(
      'sales', v_month_cur_sales,
      'orders', v_month_cur_orders,
      'average_ticket', case when v_month_cur_orders > 0 then round(v_month_cur_sales / v_month_cur_orders, 2) else 0 end
    ),
    'year', jsonb_build_object(
      'sales', v_year_cur_sales,
      'orders', v_year_cur_orders,
      'average_ticket', case when v_year_cur_orders > 0 then round(v_year_cur_sales / v_year_cur_orders, 2) else 0 end
    )
  );

  v_settled_previous := jsonb_build_object(
    'day', jsonb_build_object(
      'sales', v_day_prev_sales,
      'orders', v_day_prev_orders,
      'average_ticket', case when v_day_prev_orders > 0 then round(v_day_prev_sales / v_day_prev_orders, 2) else 0 end
    ),
    'week', jsonb_build_object(
      'sales', v_week_prev_sales,
      'orders', v_week_prev_orders,
      'average_ticket', case when v_week_prev_orders > 0 then round(v_week_prev_sales / v_week_prev_orders, 2) else 0 end
    ),
    'month', jsonb_build_object(
      'sales', v_month_prev_sales,
      'orders', v_month_prev_orders,
      'average_ticket', case when v_month_prev_orders > 0 then round(v_month_prev_sales / v_month_prev_orders, 2) else 0 end
    ),
    'year', jsonb_build_object(
      'sales', v_year_prev_sales,
      'orders', v_year_prev_orders,
      'average_ticket', case when v_year_prev_orders > 0 then round(v_year_prev_sales / v_year_prev_orders, 2) else 0 end
    )
  );

  select
    round(coalesce(sum(o.total) filter (
      where o.created_at >= v_op_day_start and o.created_at < v_op_day_end
    ), 0)::numeric, 2),
    count(*) filter (where o.created_at >= v_op_day_start and o.created_at < v_op_day_end),
    count(*) filter (where o.created_at < v_op_day_start),
    round(coalesce(sum(o.total) filter (
      where o.created_at < v_op_day_start
    ), 0)::numeric, 2)
  into v_in_sales, v_in_orders, v_stale_orders, v_stale_sales
  from public.pos_orders o
  where o.status in ('open', 'sent', 'awaiting_bill', 'sent_to_cashier');

  select count(*)::bigint
  into v_paid_without_paid_at
  from public.pos_orders o
  where o.status = 'paid'
    and o.paid_at is null;

  v_partial_open := public.executive_partial_open_snapshot(v_ref);

  return jsonb_build_object(
    'contract_version', 2,
    'generated_at', to_jsonb(v_ref),
    'timezone', 'America/Guatemala',
    'business_day_cutoff', '04:00:00',
    'comparison_mode', 'same_elapsed_previous_calendar_period',
    'metrics_non_sumable', jsonb_build_array('partial_open'),
    'ranges', v_ranges,
    'settled', jsonb_build_object(
      'current', v_settled_current,
      'previous', v_settled_previous
    ),
    'in_progress', jsonb_build_object(
      'sales', v_in_sales,
      'orders', v_in_orders,
      'as_of', to_jsonb(v_ref),
      'operational_day_start', to_jsonb(v_op_day_start),
      'operational_day_end', to_jsonb(v_op_day_end),
      'stale_outside_current_operational_day_orders', v_stale_orders,
      'stale_outside_current_operational_day_sales', v_stale_sales
    ),
    'partial_open', v_partial_open,
    'data_quality', jsonb_build_object(
      'paid_without_paid_at', v_paid_without_paid_at
    )
  );
end;
$$;

comment on function public.get_executive_dashboard_metrics(timestamptz) is
  'Aggregated executive dashboard metrics (contract v2). SECURITY INVOKER; partial_open via DEFINER snapshot; no payment row payloads.';

revoke all on function public.get_executive_dashboard_metrics(timestamptz) from public;
grant execute on function public.get_executive_dashboard_metrics(timestamptz) to authenticated;
