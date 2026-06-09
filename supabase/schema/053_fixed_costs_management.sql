-- Monthly fixed costs for executive reports and future income statement.
-- Apply after 052_user_roles_hr_assignable_and_rpc.sql.
--
-- CASCADE: safe when the table does not exist yet (fresh Supabase) and when
-- upgrading from 022 (drops old policies/triggers with the table).

drop table if exists public.fixed_costs cascade;

create table public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in (
    'renta',
    'servicios_basicos',
    'internet_telefono',
    'planilla_administrativa',
    'software_suscripciones',
    'mantenimiento',
    'seguros',
    'impuestos',
    'financiamiento',
    'otros'
  )),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'annual')),
  cost_month date not null check (cost_month = date_trunc('month', cost_month)::date),
  due_day integer check (due_day is null or (due_day >= 1 and due_day <= 31)),
  payment_status text not null default 'pending' check (payment_status in (
    'pending', 'paid', 'overdue', 'cancelled'
  )),
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fixed_costs_month_active_idx
  on public.fixed_costs (cost_month desc, is_active);

create index if not exists fixed_costs_category_idx
  on public.fixed_costs (category);

alter table public.fixed_costs enable row level security;

grant select on public.fixed_costs to authenticated;
grant insert, update, delete on public.fixed_costs to authenticated;
grant all on public.fixed_costs to service_role;

create or replace function public.can_view_fixed_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_role() in ('admin', 'ceo', 'gerente_general', 'supervisor');
$$;

create or replace function public.can_manage_fixed_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_role() in ('admin', 'ceo', 'gerente_general');
$$;

create or replace function public.normalize_fixed_cost_month(p_month date)
returns date
language sql
immutable
as $$
  select date_trunc('month', coalesce(p_month, current_date))::date;
$$;

create or replace function public.set_fixed_cost_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.cost_month := public.normalize_fixed_cost_month(new.cost_month);
  return new;
end;
$$;

drop trigger if exists set_fixed_cost_updated_at on public.fixed_costs;
create trigger set_fixed_cost_updated_at
  before insert or update on public.fixed_costs
  for each row execute procedure public.set_fixed_cost_updated_at();

drop policy if exists "fixed_costs_select" on public.fixed_costs;
create policy "fixed_costs_select"
  on public.fixed_costs for select to authenticated
  using (public.can_view_fixed_costs());

drop policy if exists "fixed_costs_insert" on public.fixed_costs;
create policy "fixed_costs_insert"
  on public.fixed_costs for insert to authenticated
  with check (public.can_manage_fixed_costs());

drop policy if exists "fixed_costs_update" on public.fixed_costs;
create policy "fixed_costs_update"
  on public.fixed_costs for update to authenticated
  using (public.can_manage_fixed_costs())
  with check (public.can_manage_fixed_costs());

drop policy if exists "fixed_costs_delete" on public.fixed_costs;
create policy "fixed_costs_delete"
  on public.fixed_costs for delete to authenticated
  using (public.can_manage_fixed_costs());

create or replace function public.get_fixed_costs_by_month(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := public.normalize_fixed_cost_month(coalesce(p_month, current_date));
  v_prev_month date := (v_month - interval '1 month')::date;
  v_costs jsonb;
  v_total numeric(12, 2) := 0;
  v_paid numeric(12, 2) := 0;
  v_pending numeric(12, 2) := 0;
  v_overdue numeric(12, 2) := 0;
  v_prev_total numeric(12, 2) := 0;
  v_by_category jsonb := '[]'::jsonb;
begin
  if not public.can_view_fixed_costs() then
    raise exception 'No tienes permiso para ver costos fijos.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(fc) order by fc.category, fc.name), '[]'::jsonb)
  into v_costs
  from public.fixed_costs fc
  where fc.cost_month = v_month
    and fc.is_active = true;

  select
    coalesce(sum(amount), 0),
    coalesce(sum(amount) filter (where payment_status = 'paid'), 0),
    coalesce(sum(amount) filter (where payment_status = 'pending'), 0),
    coalesce(sum(amount) filter (where payment_status = 'overdue'), 0)
  into v_total, v_paid, v_pending, v_overdue
  from public.fixed_costs
  where cost_month = v_month
    and is_active = true;

  select coalesce(sum(amount), 0)
  into v_prev_total
  from public.fixed_costs
  where cost_month = v_prev_month
    and is_active = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', grouped.category,
    'amount', grouped.amount,
    'percent', case when v_total > 0 then round((grouped.amount / v_total) * 100, 1) else 0 end
  ) order by grouped.amount desc), '[]'::jsonb)
  into v_by_category
  from (
    select category, coalesce(sum(amount), 0) as amount
    from public.fixed_costs
    where cost_month = v_month
      and is_active = true
    group by category
  ) grouped;

  return jsonb_build_object(
    'cost_month', v_month,
    'costs', v_costs,
    'summary', jsonb_build_object(
      'total', v_total,
      'paid_total', v_paid,
      'pending_total', v_pending,
      'overdue_total', v_overdue,
      'by_category', v_by_category,
      'previous_month_total', v_prev_total,
      'comparison_percent', case
        when v_prev_total > 0 then round(((v_total - v_prev_total) / v_prev_total) * 100, 1)
        when v_total > 0 then 100
        else 0
      end
    )
  );
end;
$$;

create or replace function public.upsert_fixed_cost(p_data jsonb)
returns public.fixed_costs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(trim(p_data ->> 'id'), '')::uuid;
  v_name text := nullif(trim(p_data ->> 'name'), '');
  v_category text := nullif(trim(p_data ->> 'category'), '');
  v_amount numeric(12, 2) := coalesce((p_data ->> 'amount')::numeric, 0);
  v_frequency text := coalesce(nullif(trim(p_data ->> 'frequency'), ''), 'monthly');
  v_cost_month date := public.normalize_fixed_cost_month((p_data ->> 'cost_month')::date);
  v_due_day integer := nullif(trim(p_data ->> 'due_day'), '')::integer;
  v_payment_status text := coalesce(nullif(trim(p_data ->> 'payment_status'), ''), 'pending');
  v_notes text := nullif(trim(p_data ->> 'notes'), '');
  v_is_active boolean := coalesce((p_data ->> 'is_active')::boolean, true);
  saved_row public.fixed_costs;
begin
  if not public.can_manage_fixed_costs() then
    raise exception 'No tienes permiso para gestionar costos fijos.';
  end if;

  if v_name is null then
    raise exception 'Falta el campo obligatorio: Nombre del costo.';
  end if;

  if v_category is null then
    raise exception 'Falta el campo obligatorio: Categoria.';
  end if;

  if v_amount < 0 then
    raise exception 'El monto no puede ser negativo.';
  end if;

  if v_due_day is not null and (v_due_day < 1 or v_due_day > 31) then
    raise exception 'El dia de pago debe estar entre 1 y 31.';
  end if;

  if v_id is null then
    insert into public.fixed_costs (
      name, category, amount, frequency, cost_month, due_day,
      payment_status, notes, is_active, created_by, updated_by
    )
    values (
      v_name, v_category, v_amount, v_frequency, v_cost_month, v_due_day,
      v_payment_status, v_notes, v_is_active, auth.uid(), auth.uid()
    )
    returning * into saved_row;
    return saved_row;
  end if;

  update public.fixed_costs
  set
    name = v_name,
    category = v_category,
    amount = v_amount,
    frequency = v_frequency,
    cost_month = v_cost_month,
    due_day = v_due_day,
    payment_status = v_payment_status,
    notes = v_notes,
    is_active = v_is_active,
    updated_by = auth.uid()
  where id = v_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No se encontro el costo fijo a actualizar.';
  end if;

  return saved_row;
end;
$$;

create or replace function public.deactivate_fixed_cost(p_id uuid)
returns public.fixed_costs
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.fixed_costs;
begin
  if not public.can_manage_fixed_costs() then
    raise exception 'No tienes permiso para gestionar costos fijos.';
  end if;

  update public.fixed_costs
  set is_active = false, updated_by = auth.uid()
  where id = p_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No se encontro el costo fijo.';
  end if;

  return saved_row;
end;
$$;

create or replace function public.copy_fixed_costs_from_previous_month(p_target_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target date := public.normalize_fixed_cost_month(coalesce(p_target_month, current_date));
  v_source date := (v_target - interval '1 month')::date;
  v_inserted integer := 0;
begin
  if not public.can_manage_fixed_costs() then
    raise exception 'No tienes permiso para gestionar costos fijos.';
  end if;

  insert into public.fixed_costs (
    name, category, amount, frequency, cost_month, due_day,
    payment_status, notes, is_active, created_by, updated_by
  )
  select
    src.name,
    src.category,
    src.amount,
    src.frequency,
    v_target,
    src.due_day,
    'pending',
    src.notes,
    true,
    auth.uid(),
    auth.uid()
  from public.fixed_costs src
  where src.cost_month = v_source
    and src.is_active = true
    and not exists (
      select 1
      from public.fixed_costs existing
      where existing.cost_month = v_target
        and existing.is_active = true
        and lower(existing.name) = lower(src.name)
        and existing.category = src.category
    );

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'target_month', v_target,
    'source_month', v_source,
    'copied_count', v_inserted
  );
end;
$$;

create or replace function public.generate_monthly_fixed_cost_review_notifications(p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := public.normalize_fixed_cost_month(coalesce(p_month, current_date));
  v_month_label text := to_char(v_month, 'TMMonth YYYY');
  v_roles text[] := array['admin', 'gerente_general'];
  v_role text;
  v_created integer := 0;
begin
  if not public.can_manage_fixed_costs() then
    raise exception 'No tienes permiso para generar notificaciones de costos fijos.';
  end if;

  foreach v_role in array v_roles loop
    if not exists (
      select 1
      from public.notifications n
      where n.type = 'fixed_costs_monthly_review'
        and n.target_role = v_role
        and n.entity_type = 'fixed_costs_month'
        and n.entity_id = to_char(v_month, 'YYYY-MM')
    ) then
      insert into public.notifications (
        target_role, type, title, message, entity_type, entity_id, action_url
      )
      values (
        v_role,
        'fixed_costs_monthly_review',
        'Revisar costos fijos del mes',
        'Confirma si hay cambios en renta, servicios, prestamos, software o costos administrativos para ' || v_month_label || '.',
        'fixed_costs_month',
        to_char(v_month, 'YYYY-MM'),
        '/reports?tab=fixedCosts'
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'month', v_month,
    'notifications_created', v_created
  );
end;
$$;

revoke all on function public.can_view_fixed_costs() from public;
revoke all on function public.can_manage_fixed_costs() from public;
revoke all on function public.normalize_fixed_cost_month(date) from public;
revoke all on function public.get_fixed_costs_by_month(date) from public;
revoke all on function public.upsert_fixed_cost(jsonb) from public;
revoke all on function public.deactivate_fixed_cost(uuid) from public;
revoke all on function public.copy_fixed_costs_from_previous_month(date) from public;
revoke all on function public.generate_monthly_fixed_cost_review_notifications(date) from public;

grant execute on function public.can_view_fixed_costs() to authenticated;
grant execute on function public.can_manage_fixed_costs() to authenticated;
grant execute on function public.get_fixed_costs_by_month(date) to authenticated;
grant execute on function public.upsert_fixed_cost(jsonb) to authenticated;
grant execute on function public.deactivate_fixed_cost(uuid) to authenticated;
grant execute on function public.copy_fixed_costs_from_previous_month(date) to authenticated;
grant execute on function public.generate_monthly_fixed_cost_review_notifications(date) to authenticated;
