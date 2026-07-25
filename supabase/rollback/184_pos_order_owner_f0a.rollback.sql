-- F0A — Rollback forward-only (conservador)
-- Revierte comportamiento operativo de 184_pos_order_owner_f0a.sql SIN borrar datos.
-- NO ejecutar en producción sin aprobación explícita post-evaluación.
--
-- Qué revierte:
--   - Triggers sync_pos_order_owner_legacy, guard_pos_order_owner_columns
--   - Política INSERT pos_orders_operators_insert (versión pre-F0A)
--   - Función get_waiter_sales_ranking (versión 048 — solo waiter_id)
--   - Funciones de diagnóstico/prueba F0A
--
-- Qué CONSERVA (intencional):
--   - Columna owner_profile_id y datos backfilled
--   - FK pos_orders_owner_profile_id_fkey (nullable)
--   - Índices owner_profile_id (inofensivos)
--
-- Frontend: tras rollback DB, redeploy Vercel al commit anterior a F0A
--   o revertir posOrdersService.js localmente.
--
-- =============================================================================
-- PRECONDICIONES (ejecutar primero; abortar si no corresponde)
-- =============================================================================
-- 1. Triggers F0A presentes:
--    select tgname from pg_trigger
--    where tgrelid = 'public.pos_orders'::regclass
--      and tgname in ('sync_pos_order_owner_legacy','guard_pos_order_owner_columns')
--      and not tgisinternal;
-- 2. Si NO existen triggers pero sí columna owner_profile_id → migración parcial;
--    este script sigue siendo seguro (idempotente en drops).
-- 3. Snapshot post-rollback: conteos pos_orders deben igualar pre-migración.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Eliminar triggers F0A
-- ---------------------------------------------------------------------------

drop trigger if exists sync_pos_order_owner_legacy on public.pos_orders;
drop trigger if exists guard_pos_order_owner_columns on public.pos_orders;

drop function if exists public.sync_pos_order_owner_legacy();
drop function if exists public.guard_pos_order_owner_columns();

-- ---------------------------------------------------------------------------
-- 2. Restaurar política INSERT pre-F0A (010_pos_orders.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "pos_orders_operators_insert" on public.pos_orders;

create policy "pos_orders_operators_insert"
  on public.pos_orders for insert to authenticated
  with check (
    public.can_operate_pos_orders()
    and waiter_id = auth.uid()
  );

-- UPDATE policy sin cambios (010); guard trigger ya no bloquea owner/waiter.

-- ---------------------------------------------------------------------------
-- 3. Restaurar get_waiter_sales_ranking — versión 048 (solo waiter_id)
-- ---------------------------------------------------------------------------

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
      o.waiter_id as seller_id,
      coalesce(max(p.full_name), max(o.waiter_name), 'Sin nombre') as seller_name,
      sum(o.total)::numeric(12,2) as seller_sales,
      count(*)::integer as seller_orders
    from public.pos_orders o
    left join public.profiles p on p.id = o.waiter_id
    where o.status = 'paid'
      and coalesce(o.paid_at, o.created_at) >= month_start::timestamptz
      and coalesce(o.paid_at, o.created_at) < month_end
      and o.waiter_id is not null
    group by o.waiter_id
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

-- ---------------------------------------------------------------------------
-- 4. Retirar funciones F0A (diagnóstico / QA)
-- ---------------------------------------------------------------------------

drop function if exists public.test_pos_order_owner_f0a_rules();
drop function if exists public.diagnose_pos_order_owner_orphans();
drop function if exists public.diagnose_pos_order_owner_integrity();

-- 184 también eliminaba set_pos_order_owner_internal; no recrear en rollback F0A.
drop function if exists public.set_pos_order_owner_internal(uuid, uuid, text);

commit;

-- =============================================================================
-- VERIFICACIÓN POSTERIOR (read-only)
-- =============================================================================
--
-- Triggers F0A ausentes:
--   select tgname from pg_trigger
--   where tgrelid = 'public.pos_orders'::regclass and not tgisinternal
--   order by tgname;
--
-- Ranking legacy (debe usar waiter_id, NO coalesce owner):
--   select pg_get_functiondef('public.get_waiter_sales_ranking(date, boolean)'::regprocedure)
--   ilike '%coalesce(o.owner_profile_id%';  -- debe ser FALSE
--
-- Conteos sin drift:
--   select count(*) from public.pos_orders;
--   select coalesce(sum(total),0) from public.pos_orders where status='paid';
--
-- Política INSERT restaurada:
--   select with_check from pg_policies
--   where schemaname='public' and tablename='pos_orders'
--     and policyname='pos_orders_operators_insert';
--
-- =============================================================================
-- ROLLBACK FRONTEND (Vercel / Git) — manual
-- =============================================================================
-- 1. No push de posOrdersService.js con owner_profile_id hasta nueva aprobación.
-- 2. Vercel → Deployments → seleccionar deployment anterior a F0A (ej. sha 23dfe3a).
-- 3. Promote to Production / Redeploy.
-- 4. Verificar POS crea órdenes con solo waiter_id (columna owner puede quedar NULL o backfill previo).
