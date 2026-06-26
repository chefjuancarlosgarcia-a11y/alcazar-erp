-- Finance Phase 2 — ERP integrations (purchases, catering, cash closing)
-- Apply after 129_finance_cash_flow_hotfix.sql

-- ---------------------------------------------------------------------------
-- Schema adjustments
-- ---------------------------------------------------------------------------

alter table public.finance_payables
  alter column source_id type text using source_id::text;

alter table public.finance_receivables
  alter column source_id type text using source_id::text;

alter table public.finance_bank_transactions
  alter column source_id type text using source_id::text;

alter table public.finance_bank_transactions
  drop constraint if exists finance_bank_transactions_source_module_check;

alter table public.finance_bank_transactions
  add constraint finance_bank_transactions_source_module_check
  check (source_module is null or source_module in (
    'caja', 'pos', 'compras', 'manual', 'catering', 'finance', 'purchases', 'cash_closing'
  ));

create unique index if not exists finance_payables_source_unique_idx
  on public.finance_payables (source_module, source_id)
  where source_module is not null and source_id is not null;

create unique index if not exists finance_receivables_source_unique_idx
  on public.finance_receivables (source_module, source_id)
  where source_module is not null and source_id is not null;

create unique index if not exists finance_bank_tx_cash_closing_unique_idx
  on public.finance_bank_transactions (source_module, source_id, coalesce(reference, ''))
  where source_module = 'cash_closing' and type = 'deposit';

create table if not exists public.finance_integration_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source_module text not null,
  source_id text not null,
  finance_record_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists finance_integration_events_source_idx
  on public.finance_integration_events (source_module, source_id, created_at desc);

alter table public.finance_integration_events enable row level security;

drop policy if exists finance_integration_events_select on public.finance_integration_events;
create policy finance_integration_events_select on public.finance_integration_events
  for select using (public.can_view_finance());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.finance_purchase_order_amounts(p_data jsonb)
returns table(subtotal numeric, tax_amount numeric, total_amount numeric)
language sql
immutable
set search_path = ''
as $$
  with items as (
    select coalesce(sum(
      coalesce(
        nullif(item ->> 'subtotal', '')::numeric,
        coalesce(nullif(item ->> 'costoUnitario', '')::numeric, 0)
          * coalesce(
            nullif(item ->> 'cantidadComprar', '')::numeric,
            nullif(item ->> 'cantidad_compra', '')::numeric,
            0
          )
      )
    ), 0) as subtotal
    from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) as item
  )
  select
    i.subtotal,
    coalesce(
      nullif(p_data ->> 'tax_amount', '')::numeric,
      nullif(p_data ->> 'iva', '')::numeric,
      round(i.subtotal * 0.12, 2)
    ) as tax_amount,
    coalesce(
      nullif(p_data ->> 'total', '')::numeric,
      nullif(p_data ->> 'totalOrden', '')::numeric,
      i.subtotal
        + coalesce(
          nullif(p_data ->> 'tax_amount', '')::numeric,
          nullif(p_data ->> 'iva', '')::numeric,
          round(i.subtotal * 0.12, 2)
        )
    ) as total_amount
  from items i;
$$;

create or replace function public.log_finance_integration_event(
  p_event_type text,
  p_source_module text,
  p_source_id text,
  p_finance_record_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.finance_integration_events (
    event_type, source_module, source_id, finance_record_id, payload, created_by
  )
  values (
    p_event_type,
    p_source_module,
    p_source_id,
    p_finance_record_id,
    coalesce(p_payload, '{}'::jsonb),
    auth.uid()
  );
end;
$$;

create or replace function public.can_view_finance_integration(p_source_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case lower(trim(coalesce(p_source_module, '')))
    when 'purchases' then public.can_view_finance()
      or public.current_profile_role() in ('admin', 'gerente_general', 'gerente', 'encargado_almacen')
    when 'catering' then public.can_view_finance()
      or public.can_manage_catering_requests()
    when 'cash_closing' then public.can_view_finance()
      or public.is_cash_operator()
    else public.can_view_finance()
  end;
$$;

create or replace function public.finance_integration_status_label(
  p_kind text,
  p_status text,
  p_linked boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_linked then case p_kind
      when 'payable' then 'Sin cuenta por pagar'
      when 'receivable' then 'Sin cuenta por cobrar'
      else 'Sin depósito bancario'
    end
    when p_kind = 'payable' and p_status = 'partial' then 'Parcialmente pagada'
    when p_kind = 'payable' and p_status = 'paid' then 'Pagada'
    when p_kind = 'receivable' and p_status = 'partial' then 'Parcialmente cobrada'
    when p_kind = 'receivable' and p_status = 'collected' then 'Cobrada'
    when p_kind = 'deposit' then 'Ya enviado a Finanzas'
    when p_kind = 'payable' then 'Cuenta por pagar creada'
    when p_kind = 'receivable' then 'Cuenta por cobrar creada'
    else 'Vinculado'
  end;
$$;

-- Patch bank transaction creator for text source_id
create or replace function public.create_finance_bank_transaction(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_bank_transactions;
  v_amount numeric := (p_data ->> 'amount')::numeric;
  v_direction text := coalesce(p_data ->> 'direction', 'in');
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para registrar movimientos.';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;

  insert into public.finance_bank_transactions (
    bank_account_id, transaction_date, type, description, reference, amount, direction,
    source_module, source_id, created_by
  )
  values (
    (p_data ->> 'bank_account_id')::uuid,
    coalesce((p_data ->> 'transaction_date')::date, (now() at time zone 'America/Guatemala')::date),
    coalesce(p_data ->> 'type', 'adjustment'),
    coalesce(trim(p_data ->> 'description'), ''),
    nullif(trim(p_data ->> 'reference'), ''),
    v_amount,
    v_direction,
    coalesce(p_data ->> 'source_module', 'manual'),
    nullif(trim(p_data ->> 'source_id'), ''),
    auth.uid()
  )
  returning * into v_row;

  perform public.finance_apply_bank_transaction(v_row.bank_account_id, v_amount, v_direction);

  return to_jsonb(v_row);
end;
$$;

create or replace function public.create_finance_payable(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_payables;
  v_subtotal numeric := coalesce((p_data ->> 'subtotal')::numeric, 0);
  v_tax numeric := coalesce((p_data ->> 'tax_amount')::numeric, 0);
  v_total numeric := coalesce((p_data ->> 'total_amount')::numeric, v_subtotal + v_tax);
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para crear cuentas por pagar.';
  end if;

  if v_total <= 0 then raise exception 'El total debe ser mayor a cero.'; end if;

  insert into public.finance_payables (
    supplier_id, supplier_name, invoice_number, issue_date, due_date, description,
    subtotal, tax_amount, total_amount, source_module, source_id, created_by
  )
  values (
    nullif(p_data ->> 'supplier_id', '')::uuid,
    trim(p_data ->> 'supplier_name'),
    nullif(trim(p_data ->> 'invoice_number'), ''),
    coalesce((p_data ->> 'issue_date')::date, (now() at time zone 'America/Guatemala')::date),
    coalesce((p_data ->> 'due_date')::date, (now() at time zone 'America/Guatemala')::date),
    coalesce(trim(p_data ->> 'description'), ''),
    v_subtotal, v_tax, v_total,
    coalesce(p_data ->> 'source_module', 'manual'),
    nullif(trim(p_data ->> 'source_id'), ''),
    auth.uid()
  )
  returning * into v_row;

  perform public.finance_refresh_payable_status(v_row.id);
  select * into v_row from public.finance_payables where id = v_row.id;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.create_finance_receivable(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_receivables;
  v_subtotal numeric := coalesce((p_data ->> 'subtotal')::numeric, 0);
  v_tax numeric := coalesce((p_data ->> 'tax_amount')::numeric, 0);
  v_total numeric := coalesce((p_data ->> 'total_amount')::numeric, v_subtotal + v_tax);
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para crear cuentas por cobrar.';
  end if;

  if v_total <= 0 then raise exception 'El total debe ser mayor a cero.'; end if;

  insert into public.finance_receivables (
    customer_name, customer_phone, customer_email, document_number,
    issue_date, due_date, description, subtotal, tax_amount, total_amount,
    source_module, source_id, created_by
  )
  values (
    trim(p_data ->> 'customer_name'),
    nullif(trim(p_data ->> 'customer_phone'), ''),
    nullif(trim(p_data ->> 'customer_email'), ''),
    nullif(trim(p_data ->> 'document_number'), ''),
    coalesce((p_data ->> 'issue_date')::date, (now() at time zone 'America/Guatemala')::date),
    nullif(p_data ->> 'due_date', '')::date,
    coalesce(trim(p_data ->> 'description'), ''),
    v_subtotal, v_tax, v_total,
    coalesce(p_data ->> 'source_module', 'manual'),
    nullif(trim(p_data ->> 'source_id'), ''),
    auth.uid()
  )
  returning * into v_row;

  perform public.finance_refresh_receivable_status(v_row.id);
  select * into v_row from public.finance_receivables where id = v_row.id;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Integration RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_finance_integration_status(
  p_source_module text,
  p_source_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_module text := lower(trim(coalesce(p_source_module, '')));
  v_id text := trim(coalesce(p_source_id, ''));
  v_payable public.finance_payables;
  v_receivable public.finance_receivables;
  v_deposits int := 0;
begin
  if v_id = '' then
    raise exception 'source_id es obligatorio.';
  end if;
  if not public.can_view_finance_integration(v_module) then
    raise exception 'No tienes permiso para consultar el estado financiero.';
  end if;

  if v_module = 'purchases' then
    select * into v_payable
    from public.finance_payables
    where source_module = 'purchases' and source_id = v_id
    limit 1;

    return jsonb_build_object(
      'source_module', v_module,
      'source_id', v_id,
      'linked', v_payable.id is not null,
      'record_id', v_payable.id,
      'record_type', 'payable',
      'financial_status', coalesce(v_payable.status, 'none'),
      'financial_status_label', public.finance_integration_status_label(
        'payable', coalesce(v_payable.status, 'none'), v_payable.id is not null
      ),
      'balance', coalesce(v_payable.balance, 0),
      'total_amount', coalesce(v_payable.total_amount, 0)
    );
  elsif v_module = 'catering' then
    select * into v_receivable
    from public.finance_receivables
    where source_module = 'catering' and source_id = v_id
    limit 1;

    return jsonb_build_object(
      'source_module', v_module,
      'source_id', v_id,
      'linked', v_receivable.id is not null,
      'record_id', v_receivable.id,
      'record_type', 'receivable',
      'financial_status', coalesce(v_receivable.status, 'none'),
      'financial_status_label', public.finance_integration_status_label(
        'receivable', coalesce(v_receivable.status, 'none'), v_receivable.id is not null
      ),
      'balance', coalesce(v_receivable.balance, 0),
      'total_amount', coalesce(v_receivable.total_amount, 0)
    );
  elsif v_module = 'cash_closing' then
    select count(*) into v_deposits
    from public.finance_bank_transactions
    where source_module = 'cash_closing'
      and source_id = v_id
      and type = 'deposit';

    return jsonb_build_object(
      'source_module', v_module,
      'source_id', v_id,
      'linked', v_deposits > 0,
      'record_type', 'deposit',
      'financial_status', case when v_deposits > 0 then 'sent' else 'none' end,
      'financial_status_label', public.finance_integration_status_label(
        'deposit', case when v_deposits > 0 then 'sent' else 'none' end, v_deposits > 0
      ),
      'deposit_count', v_deposits
    );
  else
    raise exception 'Modulo de integracion no soportado: %.', v_module;
  end if;
end;
$$;

create or replace function public.create_finance_payable_from_purchase(
  p_purchase_order_id text,
  p_auto boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_existing public.finance_payables;
  v_amounts record;
  v_issue date;
  v_due date;
  v_payable public.finance_payables;
  v_supplier_name text;
begin
  if trim(coalesce(p_purchase_order_id, '')) = '' then
    raise exception 'La orden de compra es obligatoria.';
  end if;

  if not p_auto and not public.can_view_finance()
    and public.current_profile_role() not in ('admin', 'gerente_general', 'gerente', 'encargado_almacen') then
    raise exception 'No tienes permiso para enviar esta orden a Finanzas.';
  end if;

  select * into v_existing
  from public.finance_payables
  where source_module = 'purchases' and source_id = trim(p_purchase_order_id);

  if found then
    return jsonb_build_object(
      'created', false,
      'duplicate', true,
      'payable', to_jsonb(v_existing),
      'financial_status', v_existing.status,
      'financial_status_label', public.finance_integration_status_label('payable', v_existing.status, true)
    );
  end if;

  select * into v_order
  from public.purchase_orders
  where id = trim(p_purchase_order_id);

  if not found then
    raise exception 'Orden de compra no encontrada.';
  end if;

  if coalesce(v_order.is_test, false) then
    if p_auto then
      return jsonb_build_object('created', false, 'duplicate', false, 'skipped', true, 'reason', 'test_flow');
    end if;
    raise exception 'No se pueden enviar ordenes de prueba a Finanzas.';
  end if;

  if v_order.status not in ('recibida_parcial', 'recibida_completa', 'aprobada') then
    if p_auto then
      return jsonb_build_object('created', false, 'duplicate', false, 'skipped', true, 'reason', 'status_not_ready');
    end if;
    raise exception 'La orden debe estar aprobada o recibida para enviarla a cuentas por pagar.';
  end if;

  select * into v_amounts from public.finance_purchase_order_amounts(v_order.data);
  v_supplier_name := coalesce(nullif(trim(v_order.data -> 'proveedor' ->> 'nombre'), ''), 'Proveedor sin nombre');
  v_issue := coalesce(
    nullif(v_order.data ->> 'fechaEmision', '')::date,
    v_order.created_at::date
  );
  v_due := coalesce(
    nullif(v_order.data ->> 'fechaEsperadaEntrega', '')::date,
    v_issue + 30
  );

  insert into public.finance_payables (
    supplier_name, invoice_number, issue_date, due_date, description,
    subtotal, tax_amount, total_amount, source_module, source_id, created_by
  )
  values (
    v_supplier_name,
    coalesce(nullif(trim(v_order.order_number), ''), v_order.id),
    v_issue,
    v_due,
    'Orden de compra ' || coalesce(v_order.order_number, v_order.id),
    v_amounts.subtotal,
    v_amounts.tax_amount,
    v_amounts.total_amount,
    'purchases',
    v_order.id,
    auth.uid()
  )
  returning * into v_payable;

  perform public.finance_refresh_payable_status(v_payable.id);
  select * into v_payable from public.finance_payables where id = v_payable.id;

  perform public.log_finance_integration_event(
    'payable_from_purchase',
    'purchases',
    v_order.id,
    v_payable.id,
    jsonb_build_object('order_number', v_order.order_number, 'total_amount', v_payable.total_amount)
  );

  return jsonb_build_object(
    'created', true,
    'duplicate', false,
    'payable', to_jsonb(v_payable),
    'financial_status', v_payable.status,
    'financial_status_label', public.finance_integration_status_label('payable', v_payable.status, true)
  );
end;
$$;

create or replace function public.create_finance_receivable_from_catering(
  p_catering_request_id uuid,
  p_auto boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
  v_quote public.catering_quotes;
  v_existing public.finance_receivables;
  v_receivable public.finance_receivables;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
begin
  if p_catering_request_id is null then
    raise exception 'La solicitud de catering es obligatoria.';
  end if;

  if not p_auto and not public.can_view_finance() and not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para enviar esta solicitud a Finanzas.';
  end if;

  select * into v_existing
  from public.finance_receivables
  where source_module = 'catering' and source_id = p_catering_request_id::text;

  if found then
    return jsonb_build_object(
      'created', false,
      'duplicate', true,
      'receivable', to_jsonb(v_existing),
      'financial_status', v_existing.status,
      'financial_status_label', public.finance_integration_status_label('receivable', v_existing.status, true)
    );
  end if;

  select * into v_request from public.catering_requests where id = p_catering_request_id;
  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  if v_request.status not in ('approved', 'converted')
    and v_request.conversion_status not in ('approved', 'converted') then
    if p_auto then
      return jsonb_build_object('created', false, 'duplicate', false, 'skipped', true, 'reason', 'status_not_ready');
    end if;
    raise exception 'La solicitud debe estar aprobada para enviarla a cuentas por cobrar.';
  end if;

  select * into v_quote
  from public.catering_quotes
  where request_id = p_catering_request_id and status = 'approved'
  order by updated_at desc
  limit 1;

  v_subtotal := coalesce(v_quote.subtotal, v_request.estimated_value, 0);
  v_tax := coalesce(v_quote.tax_amount, 0);
  v_total := coalesce(v_quote.total, v_request.estimated_value, v_subtotal + v_tax);

  if v_total <= 0 then
    raise exception 'La solicitud no tiene un monto valido para cuentas por cobrar.';
  end if;

  insert into public.finance_receivables (
    customer_name, customer_phone, customer_email, document_number,
    issue_date, due_date, description, subtotal, tax_amount, total_amount,
    source_module, source_id, created_by
  )
  values (
    v_request.customer_name,
    v_request.customer_phone,
    v_request.customer_email,
    coalesce(v_quote.quote_number, 'CAT-' || left(p_catering_request_id::text, 8)),
    coalesce(v_request.event_date, (now() at time zone 'America/Guatemala')::date),
    v_request.event_date,
    coalesce(
      'Catering · ' || coalesce(v_request.event_type, 'evento') || ' · ' || coalesce(v_request.customer_name, ''),
      'Cuenta por cobrar catering'
    ),
    v_subtotal,
    v_tax,
    v_total,
    'catering',
    p_catering_request_id::text,
    auth.uid()
  )
  returning * into v_receivable;

  perform public.finance_refresh_receivable_status(v_receivable.id);
  select * into v_receivable from public.finance_receivables where id = v_receivable.id;

  perform public.log_finance_integration_event(
    'receivable_from_catering',
    'catering',
    p_catering_request_id::text,
    v_receivable.id,
    jsonb_build_object('customer_name', v_request.customer_name, 'total_amount', v_receivable.total_amount)
  );

  return jsonb_build_object(
    'created', true,
    'duplicate', false,
    'receivable', to_jsonb(v_receivable),
    'financial_status', v_receivable.status,
    'financial_status_label', public.finance_integration_status_label('receivable', v_receivable.status, true)
  );
end;
$$;

create or replace function public.create_finance_deposit_from_cash_closing(
  p_cash_session_id uuid,
  p_bank_account_id uuid,
  p_amount numeric,
  p_method text default 'cash'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
  v_existing public.finance_bank_transactions;
  v_method text := lower(trim(coalesce(p_method, 'cash')));
  v_tx public.finance_bank_transactions;
  v_register_name text;
begin
  if p_cash_session_id is null or p_bank_account_id is null then
    raise exception 'Sesion de caja y cuenta bancaria son obligatorias.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;
  if not public.can_view_finance() and not public.is_cash_operator() then
    raise exception 'No tienes permiso para registrar depositos.';
  end if;

  select * into v_session from public.cash_sessions where id = p_cash_session_id;
  if not found then
    raise exception 'Cierre de caja no encontrado.';
  end if;
  if v_session.status <> 'closed' then
    raise exception 'Solo se pueden registrar depositos de cierres cerrados.';
  end if;

  select * into v_existing
  from public.finance_bank_transactions
  where source_module = 'cash_closing'
    and source_id = p_cash_session_id::text
    and type = 'deposit'
    and coalesce(reference, '') = v_method;

  if found then
    return jsonb_build_object(
      'created', false,
      'duplicate', true,
      'transaction', to_jsonb(v_existing),
      'financial_status', 'sent',
      'financial_status_label', public.finance_integration_status_label('deposit', 'sent', true)
    );
  end if;

  select name into v_register_name from public.cash_registers where id = v_session.cash_register_id;

  select * into v_tx
  from public.finance_bank_transactions
  where false;

  insert into public.finance_bank_transactions (
    bank_account_id, transaction_date, type, description, reference, amount, direction,
    source_module, source_id, created_by
  )
  values (
    p_bank_account_id,
    coalesce(v_session.closed_at, now())::date,
    'deposit',
    'Deposito cierre caja · ' || coalesce(v_register_name, 'Caja') || ' · ' || v_method,
    v_method,
    p_amount,
    'in',
    'cash_closing',
    p_cash_session_id::text,
    auth.uid()
  )
  returning * into v_tx;

  perform public.finance_apply_bank_transaction(v_tx.bank_account_id, v_tx.amount, v_tx.direction);

  perform public.log_finance_integration_event(
    'deposit_from_cash_closing',
    'cash_closing',
    p_cash_session_id::text,
    v_tx.id,
    jsonb_build_object('amount', p_amount, 'method', v_method, 'bank_account_id', p_bank_account_id)
  );

  return jsonb_build_object(
    'created', true,
    'duplicate', false,
    'transaction', to_jsonb(v_tx),
    'financial_status', 'sent',
    'financial_status_label', public.finance_integration_status_label('deposit', 'sent', true)
  );
end;
$$;

create or replace function public.get_finance_pending_integrations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_purchases jsonb := '[]'::jsonb;
  v_catering jsonb := '[]'::jsonb;
  v_cash jsonb := '[]'::jsonb;
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver integraciones pendientes.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', po.id,
    'order_number', po.order_number,
    'supplier_name', coalesce(po.data -> 'proveedor' ->> 'nombre', ''),
    'status', po.status,
    'total_amount', (select total_amount from public.finance_purchase_order_amounts(po.data) limit 1),
    'created_at', po.created_at
  ) order by po.created_at desc), '[]'::jsonb)
  into v_purchases
  from public.purchase_orders po
  where coalesce(po.is_test, false) = false
    and po.status in ('recibida_parcial', 'recibida_completa')
    and not exists (
      select 1 from public.finance_payables fp
      where fp.source_module = 'purchases' and fp.source_id = po.id
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'customer_name', r.customer_name,
    'event_date', r.event_date,
    'status', r.status,
    'estimated_value', coalesce(r.estimated_value, 0),
    'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_catering
  from public.catering_requests r
  where r.status = 'approved' or r.conversion_status = 'approved'
    and not exists (
      select 1 from public.finance_receivables fr
      where fr.source_module = 'catering' and fr.source_id = r.id::text
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'closed_at', s.closed_at,
    'counted_cash', coalesce(s.counted_cash, 0),
    'register_name', cr.name,
    'status', s.status
  ) order by s.closed_at desc nulls last), '[]'::jsonb)
  into v_cash
  from public.cash_sessions s
  left join public.cash_registers cr on cr.id = s.cash_register_id
  where s.status = 'closed'
    and not exists (
      select 1 from public.finance_bank_transactions t
      where t.source_module = 'cash_closing'
        and t.source_id = s.id::text
        and t.type = 'deposit'
    );

  return jsonb_build_object(
    'purchases', v_purchases,
    'catering', v_catering,
    'cash_closings', v_cash,
    'counts', jsonb_build_object(
      'purchases', jsonb_array_length(v_purchases),
      'catering', jsonb_array_length(v_catering),
      'cash_closings', jsonb_array_length(v_cash)
    )
  );
end;
$$;

create or replace function public.list_finance_bank_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() and not public.is_cash_operator() then
    raise exception 'No tienes permiso para ver cuentas bancarias.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.name)
    from public.finance_bank_accounts a
    where a.is_active
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Auto hooks
-- ---------------------------------------------------------------------------

create or replace function public.finance_trigger_payable_from_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_test, false) then
    return new;
  end if;
  if new.status in ('recibida_parcial', 'recibida_completa')
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.create_finance_payable_from_purchase(new.id, true);
  end if;
  return new;
end;
$$;

drop trigger if exists finance_payable_from_purchase_trg on public.purchase_orders;
create trigger finance_payable_from_purchase_trg
  after insert or update of status on public.purchase_orders
  for each row execute function public.finance_trigger_payable_from_purchase();

create or replace function public.update_catering_quote_status(
  p_quote_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_request public.catering_requests;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_activity_type text;
  v_activity_description text;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar cotizaciones de catering.';
  end if;

  if p_quote_id is null then
    raise exception 'p_quote_id es obligatorio.';
  end if;

  if v_status not in ('draft', 'sent', 'approved', 'rejected', 'expired') then
    raise exception 'Estado de cotizacion invalido: %.', v_status;
  end if;

  select * into v_quote from public.catering_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotizacion no encontrada.';
  end if;

  if v_quote.status = v_status then
    return public.get_catering_quote_detail(p_quote_id);
  end if;

  if v_status = 'draft' then
    raise exception 'No se puede regresar una cotizacion a borrador.';
  end if;

  if v_status = 'sent' and v_quote.status not in ('draft') then
    raise exception 'Solo borradores pueden marcarse como enviados.';
  end if;

  if v_status in ('approved', 'rejected') and v_quote.status not in ('sent') then
    raise exception 'Solo cotizaciones enviadas pueden aprobarse o rechazarse.';
  end if;

  if v_status = 'expired' and v_quote.status not in ('sent') then
    raise exception 'Solo cotizaciones enviadas pueden vencer.';
  end if;

  update public.catering_quotes
  set status = v_status, updated_at = now()
  where id = p_quote_id
  returning * into v_quote;

  v_activity_type := case v_status
    when 'sent' then 'quote_sent'
    when 'approved' then 'quote_approved'
    when 'rejected' then 'quote_rejected'
    when 'expired' then 'quote_expired'
    else 'status_changed'
  end;

  v_activity_description := case v_status
    when 'sent' then 'Cotizacion ' || v_quote.quote_number || ' enviada al cliente'
    when 'approved' then 'Cotizacion ' || v_quote.quote_number || ' aprobada'
    when 'rejected' then 'Cotizacion ' || v_quote.quote_number || ' rechazada'
    when 'expired' then 'Cotizacion ' || v_quote.quote_number || ' vencida'
    else 'Estado de cotizacion actualizado'
  end;

  perform public.log_catering_activity(
    v_quote.request_id,
    v_activity_type,
    v_activity_description,
    jsonb_build_object(
      'quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'status', v_quote.status,
      'total', v_quote.total
    )
  );

  select * into v_request from public.catering_requests where id = v_quote.request_id for update;

  if v_status = 'sent' then
    update public.catering_requests
    set
      conversion_status = case
        when conversion_status in ('lead', 'contacted') then 'quoted'
        else conversion_status
      end,
      status = case when status = 'new' then 'quoted' else status end,
      estimated_value = coalesce(estimated_value, v_quote.total),
      updated_by = auth.uid()
    where id = v_quote.request_id;
  elsif v_status = 'approved' then
    update public.catering_requests
    set
      conversion_status = 'approved',
      status = 'approved',
      estimated_value = v_quote.total,
      win_probability = 100,
      updated_by = auth.uid()
    where id = v_quote.request_id;

    perform public.create_finance_receivable_from_catering(v_quote.request_id, true);
  end if;

  perform public.notify_catering_quote_status(p_quote_id, v_status);

  return public.get_catering_quote_detail(p_quote_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.get_finance_integration_status(text, text) from public;
revoke all on function public.create_finance_payable_from_purchase(text, boolean) from public;
revoke all on function public.create_finance_receivable_from_catering(uuid, boolean) from public;
revoke all on function public.create_finance_deposit_from_cash_closing(uuid, uuid, numeric, text) from public;
revoke all on function public.get_finance_pending_integrations() from public;

grant execute on function public.get_finance_integration_status(text, text) to authenticated;
grant execute on function public.create_finance_payable_from_purchase(text, boolean) to authenticated;
grant execute on function public.create_finance_receivable_from_catering(uuid, boolean) to authenticated;
grant execute on function public.create_finance_deposit_from_cash_closing(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.get_finance_pending_integrations() to authenticated;
