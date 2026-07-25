-- F0A — POS order owner identity, backfill, immutability guard, ranking alignment.
-- Design: docs/pos-station-technical-design.md v1.2.1 §20 F0A
-- Apply after 183c_task_labels_catalog_ops.sql (or latest schema).
-- Corrective audit: no internal owner RPC; diagnostics service_role only; backfill before triggers.

-- =============================================================================
-- 1. Column + FK + index
-- =============================================================================

alter table public.pos_orders
  add column if not exists owner_profile_id uuid;

comment on column public.pos_orders.owner_profile_id is
  'Canonical order owner (mesero acreditado venta/ranking). Legacy alias: waiter_id.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pos_orders_owner_profile_id_fkey'
      and conrelid = 'public.pos_orders'::regclass
  ) then
    alter table public.pos_orders
      add constraint pos_orders_owner_profile_id_fkey
      foreign key (owner_profile_id) references public.profiles(id)
      on delete restrict;
  end if;
end $$;

create index if not exists pos_orders_owner_profile_id_idx
  on public.pos_orders (owner_profile_id)
  where owner_profile_id is not null;

create index if not exists pos_orders_owner_paid_idx
  on public.pos_orders (owner_profile_id, paid_at desc)
  where status = 'paid' and owner_profile_id is not null;

-- =============================================================================
-- 2. Backfill BEFORE triggers (guard would block post-trigger updates)
-- =============================================================================

update public.pos_orders o
set owner_profile_id = o.waiter_id
where o.owner_profile_id is null
  and o.waiter_id is not null
  and exists (select 1 from public.profiles p where p.id = o.waiter_id);

-- Orphan waiter_id rows intentionally keep owner_profile_id NULL.

-- =============================================================================
-- 3. Diagnostics — SQL Editor / service_role only (not app runtime)
-- =============================================================================

create or replace function public.diagnose_pos_order_owner_integrity()
returns table (
  check_code text,
  metric_value bigint,
  notes text
)
language sql
stable
security definer
set search_path = '', public
as $$
  select 'total_orders'::text, count(*)::bigint, null::text
  from public.pos_orders
  union all
  select 'waiter_id_null', count(*)::bigint, null
  from public.pos_orders where waiter_id is null
  union all
  select 'owner_profile_id_null', count(*)::bigint, null
  from public.pos_orders where owner_profile_id is null
  union all
  select 'waiter_id_orphan_no_profile', count(*)::bigint,
    'waiter_id sin fila en profiles'::text
  from public.pos_orders o
  where o.waiter_id is not null
    and not exists (select 1 from public.profiles p where p.id = o.waiter_id)
  union all
  select 'owner_profile_id_orphan_no_profile', count(*)::bigint,
    'owner_profile_id sin fila en profiles'::text
  from public.pos_orders o
  where o.owner_profile_id is not null
    and not exists (select 1 from public.profiles p where p.id = o.owner_profile_id)
  union all
  select 'waiter_name_empty', count(*)::bigint, null
  from public.pos_orders
  where nullif(trim(coalesce(waiter_name, '')), '') is null
  union all
  select 'owner_waiter_mismatch', count(*)::bigint,
    'ambos presentes pero distintos'::text
  from public.pos_orders
  where owner_profile_id is not null
    and waiter_id is not null
    and owner_profile_id <> waiter_id
  union all
  select 'open_orders_owner_null', count(*)::bigint, null
  from public.pos_orders
  where owner_profile_id is null
    and status in ('open', 'sent', 'awaiting_bill', 'sent_to_cashier', 'partially_paid')
  union all
  select 'historical_inactive_owner', count(*)::bigint,
    'owner con profile status != active'::text
  from public.pos_orders o
  join public.profiles p on p.id = o.owner_profile_id
  where p.status is distinct from 'active';
$$;

create or replace function public.diagnose_pos_order_owner_orphans()
returns table (
  order_id uuid,
  orphan_waiter_id uuid,
  order_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = '', public
as $$
  select
    o.id,
    o.waiter_id,
    o.status,
    o.created_at
  from public.pos_orders o
  where o.waiter_id is not null
    and not exists (select 1 from public.profiles p where p.id = o.waiter_id)
  order by o.created_at desc
  limit 500;
$$;

revoke all on function public.diagnose_pos_order_owner_integrity() from public;
revoke all on function public.diagnose_pos_order_owner_integrity() from anon;
revoke all on function public.diagnose_pos_order_owner_integrity() from authenticated;
grant execute on function public.diagnose_pos_order_owner_integrity() to service_role;

revoke all on function public.diagnose_pos_order_owner_orphans() from public;
revoke all on function public.diagnose_pos_order_owner_orphans() from anon;
revoke all on function public.diagnose_pos_order_owner_orphans() from authenticated;
grant execute on function public.diagnose_pos_order_owner_orphans() to service_role;

-- =============================================================================
-- 4. Sync + guard triggers (no set_config bypass; F0B will use authorized RPC)
-- =============================================================================

create or replace function public.sync_pos_order_owner_legacy()
returns trigger
language plpgsql
set search_path = '', public
as $$
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.owner_profile_id is not null
     and new.waiter_id is not null
     and new.owner_profile_id is distinct from new.waiter_id then
    raise exception 'POS_ORDER_OWNER_WAITER_MISMATCH'
      using hint = 'owner_profile_id and waiter_id must match on insert.';
  end if;

  if new.owner_profile_id is null and new.waiter_id is not null then
    new.owner_profile_id := new.waiter_id;
  elsif new.owner_profile_id is not null and new.waiter_id is null then
    new.waiter_id := new.owner_profile_id;
  end if;

  return new;
end;
$$;

create or replace function public.guard_pos_order_owner_columns()
returns trigger
language plpgsql
set search_path = '', public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_profile_id is distinct from old.owner_profile_id
       or new.waiter_id is distinct from old.waiter_id then
      raise exception 'POS_ORDER_OWNER_IMMUTABLE'
        using hint = 'Owner changes require authorized RPC (F0B).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_pos_order_owner_legacy on public.pos_orders;
create trigger sync_pos_order_owner_legacy
  before insert
  on public.pos_orders
  for each row
  execute function public.sync_pos_order_owner_legacy();

drop trigger if exists guard_pos_order_owner_columns on public.pos_orders;
create trigger guard_pos_order_owner_columns
  before update of owner_profile_id, waiter_id
  on public.pos_orders
  for each row
  execute function public.guard_pos_order_owner_columns();

-- =============================================================================
-- 5. RLS INSERT alignment
-- =============================================================================

drop policy if exists "pos_orders_operators_insert" on public.pos_orders;
create policy "pos_orders_operators_insert"
  on public.pos_orders for insert to authenticated
  with check (
    public.can_operate_pos_orders()
    and waiter_id = auth.uid()
    and (
      owner_profile_id is null
      or owner_profile_id = auth.uid()
    )
  );

-- UPDATE policy unchanged for non-owner fields; guard trigger blocks owner/waiter changes.

-- =============================================================================
-- 6. Ranking — coalesce(owner_profile_id, waiter_id)
-- =============================================================================

create or replace function public.get_waiter_sales_ranking(
  p_month date default current_date,
  p_public boolean default false
)
returns table (
  profile_id uuid,
  full_name text,
  display_name text,
  total_sales numeric,
  order_count integer,
  average_ticket numeric,
  rank_position integer,
  relative_percent numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  month_end timestamptz := (month_start + interval '1 month')::timestamptz;
  can_money boolean;
begin
  can_money := public.can_read_sales_goals();
  if p_public then
    if not public.can_read_public_goal_widgets() then
      raise exception 'No tienes permiso para ver ranking.';
    end if;
  elsif not can_money then
    raise exception 'No tienes permiso para ver ranking gerencial.';
  end if;

  return query
  with sales as (
    select
      coalesce(o.owner_profile_id, o.waiter_id) as seller_id,
      coalesce(max(p.full_name), max(o.waiter_name), 'Sin nombre') as seller_name,
      sum(o.total)::numeric(12,2) as seller_sales,
      count(*)::integer as seller_orders
    from public.pos_orders o
    left join public.profiles p on p.id = coalesce(o.owner_profile_id, o.waiter_id)
    where o.status = 'paid'
      and coalesce(o.paid_at, o.created_at) >= month_start::timestamptz
      and coalesce(o.paid_at, o.created_at) < month_end
      and coalesce(o.owner_profile_id, o.waiter_id) is not null
    group by coalesce(o.owner_profile_id, o.waiter_id)
  ),
  ranked as (
    select
      sales.*,
      dense_rank() over (order by sales.seller_sales desc) as seller_rank,
      max(sales.seller_sales) over () as top_sales
    from sales
  )
  select
    ranked.seller_id,
    case when p_public then null::text else ranked.seller_name end,
    ranked.seller_name,
    case when p_public then null::numeric else ranked.seller_sales end,
    ranked.seller_orders,
    case when p_public then null::numeric else round(ranked.seller_sales / nullif(ranked.seller_orders, 0), 2) end,
    ranked.seller_rank::integer,
    round((ranked.seller_sales / nullif(ranked.top_sales, 0)) * 100, 2)
  from ranked
  order by ranked.seller_rank, ranked.seller_name;
end;
$$;

revoke all on function public.get_waiter_sales_ranking(date, boolean) from public;
grant execute on function public.get_waiter_sales_ranking(date, boolean) to authenticated;

-- Drop internal owner RPC if a prior draft was applied (corrective).
drop function if exists public.set_pos_order_owner_internal(uuid, uuid, text);
