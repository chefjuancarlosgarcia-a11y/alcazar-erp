-- Sales goals and motivational progress reports.
-- Apply after 047_ticket_templates_settings.sql.

create table if not exists public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  goal_month date not null,
  goal_type text not null default 'monthly_sales' check (goal_type in ('monthly_sales')),
  target_amount numeric(12,2) not null check (target_amount > 0),
  title text not null default 'Meta mensual',
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (goal_month = date_trunc('month', goal_month)::date)
);

create unique index if not exists sales_goals_one_active_month_idx
  on public.sales_goals (goal_month, goal_type)
  where status = 'active';

create index if not exists sales_goals_month_status_idx
  on public.sales_goals (goal_month desc, status, goal_type);

alter table public.sales_goals enable row level security;

grant select, insert, update, delete on public.sales_goals to authenticated;
grant all on public.sales_goals to service_role;

create or replace function public.can_read_sales_goals()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor')
      and status = 'active'
  );
$$;

create or replace function public.can_manage_sales_goals()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
      and status = 'active'
  );
$$;

create or replace function public.can_read_public_goal_widgets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
  );
$$;

revoke all on function
  public.can_read_sales_goals(),
  public.can_manage_sales_goals(),
  public.can_read_public_goal_widgets()
from public;

grant execute on function
  public.can_read_sales_goals(),
  public.can_manage_sales_goals(),
  public.can_read_public_goal_widgets()
to authenticated;

drop policy if exists "sales_goals_authorized_read" on public.sales_goals;
create policy "sales_goals_authorized_read" on public.sales_goals
  for select to authenticated using (public.can_read_sales_goals());

drop policy if exists "sales_goals_authorized_insert" on public.sales_goals;
create policy "sales_goals_authorized_insert" on public.sales_goals
  for insert to authenticated with check (public.can_manage_sales_goals());

drop policy if exists "sales_goals_authorized_update" on public.sales_goals;
create policy "sales_goals_authorized_update" on public.sales_goals
  for update to authenticated using (public.can_manage_sales_goals()) with check (public.can_manage_sales_goals());

drop policy if exists "sales_goals_authorized_delete" on public.sales_goals;
create policy "sales_goals_authorized_delete" on public.sales_goals
  for delete to authenticated using (public.can_manage_sales_goals());

create or replace function public.touch_sales_goals_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.goal_month := date_trunc('month', new.goal_month)::date;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists touch_sales_goals_updated_at on public.sales_goals;
create trigger touch_sales_goals_updated_at
  before insert or update on public.sales_goals
  for each row execute function public.touch_sales_goals_updated_at();

create or replace function public.save_sales_goal(p_data jsonb)
returns public.sales_goals
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.sales_goals;
  goal_id uuid := nullif(p_data ->> 'id', '')::uuid;
  v_goal_month date := date_trunc('month', coalesce(nullif(p_data ->> 'goal_month', '')::date, current_date))::date;
  v_goal_type text := coalesce(nullif(p_data ->> 'goal_type', ''), 'monthly_sales');
  v_target numeric := coalesce(nullif(p_data ->> 'target_amount', '')::numeric, 0);
  v_status text := coalesce(nullif(p_data ->> 'status', ''), 'active');
begin
  if not public.can_manage_sales_goals() then
    raise exception 'No tienes permiso para configurar metas de venta.';
  end if;
  if v_target <= 0 then
    raise exception 'La meta debe ser mayor que cero.';
  end if;
  if v_goal_type <> 'monthly_sales' then
    raise exception 'Tipo de meta invalido.';
  end if;

  if v_status = 'active' then
    update public.sales_goals
    set status = 'inactive'
    where goal_month = v_goal_month
      and goal_type = v_goal_type
      and status = 'active'
      and (goal_id is null or id <> goal_id);
  end if;

  if goal_id is null then
    insert into public.sales_goals (
      goal_month, goal_type, target_amount, title, description, status, created_by, updated_by
    ) values (
      v_goal_month,
      v_goal_type,
      v_target,
      coalesce(nullif(trim(p_data ->> 'title'), ''), 'Meta mensual'),
      nullif(trim(p_data ->> 'description'), ''),
      v_status,
      auth.uid(),
      auth.uid()
    ) returning * into saved;
  else
    update public.sales_goals set
      goal_month = v_goal_month,
      goal_type = v_goal_type,
      target_amount = v_target,
      title = coalesce(nullif(trim(p_data ->> 'title'), ''), 'Meta mensual'),
      description = nullif(trim(p_data ->> 'description'), ''),
      status = v_status
    where id = goal_id
    returning * into saved;
    if saved.id is null then
      raise exception 'La meta seleccionada no existe.';
    end if;
  end if;

  return saved;
end;
$$;

create or replace function public.monthly_sales_for_goal(p_month date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(o.total), 0)::numeric(12,2)
  from public.pos_orders o
  where o.status = 'paid'
    and coalesce(o.paid_at, o.created_at) >= date_trunc('month', p_month)::timestamptz
    and coalesce(o.paid_at, o.created_at) < (date_trunc('month', p_month)::date + interval '1 month')::timestamptz;
$$;

create or replace function public.goal_status_label(p_progress numeric, p_days_remaining integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_progress >= 100 then 'Meta superada'
    when p_days_remaining <= 0 and p_progress < 100 then 'Atrasada'
    when p_progress >= 75 then 'En camino'
    when p_progress >= 45 then 'Riesgo'
    else 'Atrasada'
  end;
$$;

create or replace function public.get_public_monthly_goal_progress(p_month date default current_date)
returns table (
  goal_month date,
  title text,
  progress_percent numeric,
  status_label text,
  days_remaining integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  goal_row public.sales_goals;
  month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  month_end date := (month_start + interval '1 month - 1 day')::date;
  actual_sales numeric;
  percent numeric;
  remaining_days integer;
begin
  if not public.can_read_public_goal_widgets() then
    raise exception 'No tienes permiso para ver el avance de metas.';
  end if;

  select * into goal_row
  from public.sales_goals
  where sales_goals.goal_month = month_start
    and sales_goals.goal_type = 'monthly_sales'
    and sales_goals.status = 'active'
  limit 1;

  if goal_row.id is null then
    return query select month_start, 'Meta del mes pendiente de configurar.'::text, 0::numeric, 'Sin meta'::text, greatest(0, month_end - current_date);
    return;
  end if;

  actual_sales := public.monthly_sales_for_goal(month_start);
  percent := round((actual_sales / nullif(goal_row.target_amount, 0)) * 100, 2);
  remaining_days := greatest(0, month_end - current_date);

  return query select
    goal_row.goal_month,
    goal_row.title,
    coalesce(percent, 0),
    public.goal_status_label(coalesce(percent, 0), remaining_days),
    remaining_days;
end;
$$;

create or replace function public.get_monthly_goal_report(p_month date default current_date)
returns table (
  goal_month date,
  target_amount numeric,
  actual_sales numeric,
  progress_percent numeric,
  remaining_amount numeric,
  days_elapsed integer,
  days_remaining integer,
  average_daily_sales numeric,
  required_daily_sales numeric,
  status_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  goal_row public.sales_goals;
  month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  month_end date := (month_start + interval '1 month - 1 day')::date;
  elapsed integer := greatest(1, least(current_date, month_end) - month_start + 1);
  remaining integer := greatest(0, month_end - current_date);
  actual numeric;
  percent numeric;
  remaining_amount_value numeric;
begin
  if not public.can_read_sales_goals() then
    raise exception 'No tienes permiso para ver reportes de metas.';
  end if;

  select * into goal_row
  from public.sales_goals
  where sales_goals.goal_month = month_start
    and sales_goals.goal_type = 'monthly_sales'
    and sales_goals.status = 'active'
  limit 1;

  if goal_row.id is null then
    return query select month_start, 0::numeric, 0::numeric, 0::numeric, 0::numeric, elapsed, remaining, 0::numeric, 0::numeric, 'Sin meta'::text;
    return;
  end if;

  actual := public.monthly_sales_for_goal(month_start);
  percent := round((actual / nullif(goal_row.target_amount, 0)) * 100, 2);
  remaining_amount_value := greatest(0, goal_row.target_amount - actual);

  return query select
    goal_row.goal_month,
    goal_row.target_amount,
    actual,
    coalesce(percent, 0),
    remaining_amount_value,
    elapsed,
    remaining,
    round(actual / elapsed, 2),
    round(case when remaining > 0 then remaining_amount_value / remaining else remaining_amount_value end, 2),
    public.goal_status_label(coalesce(percent, 0), remaining);
end;
$$;

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

revoke all on function
  public.save_sales_goal(jsonb),
  public.monthly_sales_for_goal(date),
  public.goal_status_label(numeric, integer),
  public.get_public_monthly_goal_progress(date),
  public.get_monthly_goal_report(date),
  public.get_waiter_sales_ranking(date, boolean)
from public;

grant execute on function
  public.save_sales_goal(jsonb),
  public.get_public_monthly_goal_progress(date),
  public.get_monthly_goal_report(date),
  public.get_waiter_sales_ranking(date, boolean)
to authenticated;
