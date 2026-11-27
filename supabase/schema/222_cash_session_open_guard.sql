-- One open session per physical register, and an opening that cannot be edited later.
-- Apply after 221_finance_journal_acl_hardening.sql. Do not apply to production until reviewed.
-- cash_sessions_one_open_per_register_idx already exists from 045_cash_sessions_and_movements.sql.

create unique index if not exists cash_sessions_one_open_per_register_idx
  on public.cash_sessions (cash_register_id)
  where status = 'open';

create or replace function public.cash_sessions_guard_opening()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'open' then
    perform 1
    from public.cash_registers
    where id = new.cash_register_id
    for update;

    if exists (
      select 1
      from public.cash_sessions
      where cash_register_id = new.cash_register_id
        and status = 'open'
    ) then
      raise exception 'Ya existe una caja abierta.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.opening_amount is distinct from old.opening_amount
      or new.cash_register_id is distinct from old.cash_register_id
      or new.opened_by is distinct from old.opened_by
      or new.opened_at is distinct from old.opened_at
    then
      raise exception 'La apertura de caja no se puede modificar. Registra un ajuste con motivo.';
    end if;
  end if;

  return new;
end;
$$;

-- Also covers open_station_cash_session: that function inserts directly and re-raises
-- only when the error text is exactly 'Ya existe una caja abierta.'
drop trigger if exists cash_sessions_guard_opening on public.cash_sessions;
create trigger cash_sessions_guard_opening
  before insert or update on public.cash_sessions
  for each row execute function public.cash_sessions_guard_opening();

create or replace function public.open_cash_session(
  p_cash_register_id uuid,
  p_opening_amount numeric,
  p_notes text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  register_row public.cash_registers;
  saved public.cash_sessions;
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para abrir caja.';
  end if;

  select * into register_row
  from public.cash_registers
  where id = p_cash_register_id and status = 'active'
  for update;

  if register_row.id is null then
    raise exception 'La caja no existe o esta inactiva.';
  end if;

  if exists (
    select 1 from public.cash_sessions
    where cash_register_id = p_cash_register_id and status = 'open'
  ) then
    raise exception 'Ya existe una caja abierta.';
  end if;

  insert into public.cash_sessions (
    cash_register_id, opened_by, opening_amount, expected_cash, notes
  ) values (
    p_cash_register_id, auth.uid(), greatest(0, coalesce(p_opening_amount, 0))::numeric(12,2),
    greatest(0, coalesce(p_opening_amount, 0))::numeric(12,2), nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into saved;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  ) values (
    saved.id, saved.cash_register_id, auth.uid(), 'shift_open', 0, 'Apertura de caja'
  );

  return saved;
exception
  when unique_violation then
    raise exception 'Ya existe una caja abierta.';
end;
$$;

alter table public.pos_order_payments
  add column if not exists cash_session_id uuid references public.cash_sessions(id);

comment on column public.pos_order_payments.cash_session_id is
  'Sesion abierta validada al cobrar. Los pagos anteriores quedan sin sesion.';

create index if not exists pos_order_payments_cash_session_idx
  on public.pos_order_payments (cash_session_id);

drop function if exists public.create_pos_split_payment(uuid, jsonb, jsonb, text);

create or replace function public.create_pos_split_payment(
  p_order_id uuid,
  p_items jsonb,
  p_methods jsonb,
  p_paid_by_label text default null,
  p_cash_session_id uuid default null
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
  change_amount numeric(12,2) := 0;
  drawer_cash numeric(12,2) := 0;
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

  change_amount := greatest(0, round(paid_total, 2) - round(subtotal, 2));
  if change_amount > round(cash_total, 2) then
    raise exception 'Solo el pago en efectivo puede generar vuelto.';
  end if;
  drawer_cash := round(cash_total - change_amount, 2);

  if p_cash_session_id is null then
    raise exception 'No hay caja abierta para esta sesion.';
  end if;

  select * into session_row
  from public.cash_sessions
  where id = p_cash_session_id and status = 'open'
  for update;

  if session_row.id is null then
    raise exception 'No hay caja abierta para esta sesion.';
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
    order_id, payment_number, payment_method, amount, paid_by_label, methods, created_by, cash_session_id
  ) values (
    p_order_id,
    payment_number,
    case when jsonb_array_length(p_methods) > 1 then 'mixed' else coalesce(p_methods -> 0 ->> 'method', 'cash') end,
    subtotal,
    method_label,
    p_methods,
    auth.uid(),
    session_row.id
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

  if drawer_cash > 0 then
    perform public.create_cash_movement(
      session_row.id,
      'sale_cash',
      drawer_cash,
      'Subcuenta POS #' || payment_number::text,
      payment_row.id::text,
      p_order_id
    );
  end if;

  perform public.record_pos_order_event(
    p_order_id,
    case when balance_after <= 0 then 'order_paid' else 'partial_payment' end,
    'Pago parcial Q' || subtotal::text || '. Saldo restante Q' || balance_after::text
  );

  return jsonb_build_object(
    'payment_id', payment_row.id,
    'payment_number', payment_number,
    'cash_session_id', session_row.id,
    'subtotal', subtotal,
    'amount_paid_total', amount_paid_so_far,
    'balance_due', balance_after,
    'order_status', case when balance_after <= 0 then 'paid' else 'partially_paid' end,
    'paid_by_label', method_label
  );
end;
$$;

revoke all on function public.create_pos_split_payment(uuid, jsonb, jsonb, text, uuid) from public;
grant execute on function public.create_pos_split_payment(uuid, jsonb, jsonb, text, uuid) to authenticated;

drop function if exists public.record_cash_sale(uuid, numeric);

create or replace function public.record_cash_sale(
  p_order_id uuid,
  p_amount numeric,
  p_cash_session_id uuid
)
returns public.cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.cash_sessions;
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para registrar ventas en efectivo.';
  end if;
  if p_cash_session_id is null then
    raise exception 'No hay caja abierta para esta sesion.';
  end if;

  select * into session_row
  from public.cash_sessions
  where id = p_cash_session_id and status = 'open'
  for update;

  if session_row.id is null then
    raise exception 'No hay caja abierta para esta sesion.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'El efectivo debe ser mayor a cero.';
  end if;

  return public.create_cash_movement(
    session_row.id,
    'sale_cash',
    p_amount,
    'Venta en efectivo POS',
    p_order_id::text,
    p_order_id
  );
end;
$$;

revoke all on function public.record_cash_sale(uuid, numeric, uuid) from public;
grant execute on function public.record_cash_sale(uuid, numeric, uuid) to authenticated;
