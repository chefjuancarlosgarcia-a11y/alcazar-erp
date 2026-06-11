-- POS split payments by order items (partial payments per product/quantity).
-- Apply after 063_checklist_template_library_approval.sql.

alter table public.pos_orders
  drop constraint if exists pos_orders_status_check;

alter table public.pos_orders
  add constraint pos_orders_status_check
  check (status in ('open', 'sent', 'awaiting_bill', 'sent_to_cashier', 'partially_paid', 'paid', 'cancelled'));

alter table public.pos_order_items
  add column if not exists quantity_paid numeric(12,2) not null default 0;

alter table public.pos_order_items
  drop constraint if exists pos_order_items_quantity_paid_check;

alter table public.pos_order_items
  add constraint pos_order_items_quantity_paid_check
  check (quantity_paid >= 0);

create table if not exists public.pos_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  payment_number integer not null default 1,
  payment_method text not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'paid' check (status in ('paid', 'void')),
  paid_by_label text,
  methods jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.pos_order_payment_items (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.pos_order_payments(id) on delete cascade,
  order_item_id uuid not null references public.pos_order_items(id) on delete cascade,
  quantity_paid numeric(12,2) not null default 1 check (quantity_paid > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);

create index if not exists pos_order_payments_order_idx
  on public.pos_order_payments (order_id, created_at desc);
create index if not exists pos_order_payment_items_payment_idx
  on public.pos_order_payment_items (payment_id);
create index if not exists pos_order_payment_items_order_item_idx
  on public.pos_order_payment_items (order_item_id);

alter table public.pos_order_payments enable row level security;
alter table public.pos_order_payment_items enable row level security;

grant select on public.pos_order_payments, public.pos_order_payment_items to authenticated;
grant all on public.pos_order_payments, public.pos_order_payment_items to service_role;

drop policy if exists "pos_order_payments_cash_read" on public.pos_order_payments;
create policy "pos_order_payments_cash_read"
  on public.pos_order_payments for select to authenticated
  using (public.is_cash_operator());

drop policy if exists "pos_order_payment_items_cash_read" on public.pos_order_payment_items;
create policy "pos_order_payment_items_cash_read"
  on public.pos_order_payment_items for select to authenticated
  using (
    exists (
      select 1 from public.pos_order_payments payment
      where payment.id = pos_order_payment_items.payment_id
        and public.is_cash_operator()
    )
  );

create or replace function public.get_pos_order_payment_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_row public.pos_orders;
  result jsonb;
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para consultar pagos POS.';
  end if;

  select * into order_row
  from public.pos_orders
  where id = p_order_id;

  if order_row.id is null then
    raise exception 'Orden no encontrada.';
  end if;

  select jsonb_build_object(
    'order_id', order_row.id,
    'order_total', order_row.total,
    'order_status', order_row.status,
    'amount_paid', coalesce((
      select sum(p.amount)
      from public.pos_order_payments p
      where p.order_id = order_row.id and p.status = 'paid'
    ), 0),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'order_item_id', item.id,
          'product_name', item.product_name,
          'quantity_total', item.quantity,
          'quantity_paid', item.quantity_paid,
          'quantity_remaining', greatest(0, item.quantity - item.quantity_paid),
          'unit_price', item.unit_price,
          'line_total', item.total_price,
          'line_remaining', round(greatest(0, item.quantity - item.quantity_paid) * item.unit_price, 2),
          'status', item.status,
          'is_fully_paid', item.quantity_paid >= item.quantity
        )
        order by item.created_at, item.id
      )
      from public.pos_order_items item
      where item.order_id = order_row.id
        and item.status <> 'cancelled'
    ), '[]'::jsonb)
  ) into result;

  return result || jsonb_build_object(
    'balance_due', greatest(0, order_row.total - coalesce((result ->> 'amount_paid')::numeric, 0))
  );
end;
$$;

create or replace function public.create_pos_split_payment(
  p_order_id uuid,
  p_items jsonb,
  p_methods jsonb,
  p_paid_by_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.pos_orders;
  item_row public.pos_order_items;
  line jsonb;
  qty numeric(12,2);
  unit_price numeric(12,2);
  line_total numeric(12,2);
  subtotal numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  cash_total numeric(12,2) := 0;
  payment_row public.pos_order_payments;
  payment_number integer;
  method_row jsonb;
  method_label text;
  session_row public.cash_sessions;
  amount_paid_so_far numeric(12,2);
  balance_after numeric(12,2);
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para registrar pagos POS.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes seleccionar al menos un producto para cobrar.';
  end if;

  if p_methods is null or jsonb_typeof(p_methods) <> 'array' or jsonb_array_length(p_methods) = 0 then
    raise exception 'Debes indicar al menos un metodo de pago.';
  end if;

  select * into order_row
  from public.pos_orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Orden no encontrada.';
  end if;

  if order_row.status not in ('awaiting_bill', 'sent_to_cashier', 'partially_paid') then
    raise exception 'La orden no esta disponible para cobro parcial.';
  end if;

  for line in select * from jsonb_array_elements(p_items)
  loop
    select * into item_row
    from public.pos_order_items
    where id = (line ->> 'order_item_id')::uuid
      and order_id = p_order_id
      and status <> 'cancelled'
    for update;

    if item_row.id is null then
      raise exception 'Item de orden invalido.';
    end if;

    qty := coalesce((line ->> 'quantity_paid')::numeric, 0);
    if qty <= 0 then
      raise exception 'Cantidad invalida para %.', item_row.product_name;
    end if;

    if qty > greatest(0, item_row.quantity - item_row.quantity_paid) then
      raise exception 'No puedes cobrar mas unidades de las pendientes para %.', item_row.product_name;
    end if;

    unit_price := item_row.unit_price;
    line_total := round(qty * unit_price, 2);
    subtotal := subtotal + line_total;
  end loop;

  if subtotal <= 0 then
    raise exception 'El subtotal de la subcuenta debe ser mayor a cero.';
  end if;

  for method_row in select * from jsonb_array_elements(p_methods)
  loop
    paid_total := paid_total + coalesce((method_row ->> 'amount')::numeric, 0);
    if coalesce(method_row ->> 'method', '') = 'cash' then
      cash_total := cash_total + coalesce((method_row ->> 'amount')::numeric, 0);
    end if;
  end loop;

  if round(paid_total, 2) < round(subtotal, 2) then
    raise exception 'El pago esta incompleto para esta subcuenta.';
  end if;

  select coalesce(max(p.payment_number), 0) + 1 into payment_number
  from public.pos_order_payments p
  where p.order_id = p_order_id;

  method_label := coalesce(
    nullif(trim(p_paid_by_label), ''),
    (
      select string_agg(
        case coalesce(m ->> 'method', 'cash')
          when 'cash' then 'Efectivo'
          when 'card' then 'Tarjeta'
          when 'transfer' then 'Transferencia'
          when 'qr' then 'QR'
          else coalesce(m ->> 'method', 'Pago')
        end,
        ' + '
      )
      from jsonb_array_elements(p_methods) m
    )
  );

  insert into public.pos_order_payments (
    order_id, payment_number, payment_method, amount, paid_by_label, methods, created_by
  ) values (
    p_order_id,
    payment_number,
    case when jsonb_array_length(p_methods) > 1 then 'mixed' else coalesce(p_methods -> 0 ->> 'method', 'cash') end,
    subtotal,
    method_label,
    p_methods,
    auth.uid()
  ) returning * into payment_row;

  for line in select * from jsonb_array_elements(p_items)
  loop
    select * into item_row
    from public.pos_order_items
    where id = (line ->> 'order_item_id')::uuid
      and order_id = p_order_id
    for update;

    qty := coalesce((line ->> 'quantity_paid')::numeric, 0);
    unit_price := item_row.unit_price;
    line_total := round(qty * unit_price, 2);

    insert into public.pos_order_payment_items (
      payment_id, order_item_id, quantity_paid, unit_price, line_total
    ) values (
      payment_row.id, item_row.id, qty, unit_price, line_total
    );

    update public.pos_order_items
    set quantity_paid = quantity_paid + qty,
        updated_at = now()
    where id = item_row.id;
  end loop;

  select coalesce(sum(p.amount), 0) into amount_paid_so_far
  from public.pos_order_payments p
  where p.order_id = p_order_id and p.status = 'paid';

  balance_after := greatest(0, order_row.total - amount_paid_so_far);

  update public.pos_orders
  set status = case when balance_after <= 0 then 'paid' else 'partially_paid' end,
      paid_at = case when balance_after <= 0 then now() else paid_at end,
      updated_at = now()
  where id = p_order_id;

  if cash_total > 0 then
    select * into session_row
    from public.cash_sessions
    where status = 'open'
    order by opened_at desc
    limit 1;

    if session_row.id is not null then
      perform public.create_cash_movement(
        session_row.id,
        'sale_cash',
        cash_total,
        'Subcuenta POS #' || payment_number::text,
        payment_row.id::text,
        p_order_id
      );
    end if;
  end if;

  perform public.record_pos_order_event(
    p_order_id,
    case when balance_after <= 0 then 'order_paid' else 'partial_payment' end,
    'Pago parcial Q' || subtotal::text || '. Saldo restante Q' || balance_after::text
  );

  return jsonb_build_object(
    'payment_id', payment_row.id,
    'payment_number', payment_number,
    'subtotal', subtotal,
    'amount_paid_total', amount_paid_so_far,
    'balance_due', balance_after,
    'order_status', case when balance_after <= 0 then 'paid' else 'partially_paid' end,
    'paid_by_label', method_label
  );
end;
$$;

revoke all on function
  public.get_pos_order_payment_status(uuid),
  public.create_pos_split_payment(uuid, jsonb, jsonb, text)
from public;

grant execute on function
  public.get_pos_order_payment_status(uuid),
  public.create_pos_split_payment(uuid, jsonb, jsonb, text)
to authenticated;
