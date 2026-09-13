-- POS FEL invoice candidate listing (Caja) + H1 sales_channel guard on request RPC.
-- No HTTP, no remote calls, no emission enablement.

create or replace function public.fel_assert_pos_fel_pilot_sales_channel(p_sales_channel text)
returns void
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if btrim(coalesce(p_sales_channel, '')) not in ('dine_in', 'takeout') then
    raise exception 'FEL_SALES_CHANNEL_NOT_SUPPORTED: Canal de venta no soportado para emision FEL en caja.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.fel_assert_pos_fel_pilot_sales_channel(text)
  from public, anon, authenticated;

grant execute on function public.fel_assert_pos_fel_pilot_sales_channel(text)
  to service_role;

comment on function public.fel_assert_pos_fel_pilot_sales_channel(text) is
  'Pilot POS FEL channels for Caja: dine_in and takeout only.';

-- H1: channel guard before INSERT only. Existing FACT idempotent return is intentional (no INSERT/mutation;
-- does not authorize Edge certification on blocked channels; Edge gates remain fail-closed).
create or replace function public.request_pos_fel_certification(
  p_order_id uuid,
  p_receiver_nit text default null,
  p_receiver_name text default null,
  p_receiver_address text default null,
  p_receiver_email text default null,
  p_discount_total numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.fel_emission_config;
  v_existing public.pos_fel_documents;
  v_document public.pos_fel_documents;
  v_reconciliation jsonb;
  v_receiver_nit text;
  v_receiver_name text;
  v_receiver_address text;
  v_receiver_email text;
  v_receiver_snapshot jsonb;
  v_order_snapshot jsonb;
  v_items_snapshot jsonb;
  v_taxable_gross numeric(12, 2);
  v_taxable_base numeric(12, 2);
  v_vat_total numeric(12, 2);
begin
  if not public.fel_can_request_fel_certification() then
    raise exception 'No tienes permiso para solicitar certificacion FEL.'
      using errcode = 'P0001';
  end if;

  if p_order_id is null then
    raise exception 'Debes indicar una orden POS.'
      using errcode = 'P0001';
  end if;

  v_config := public.fel_get_emission_config();

  if v_config.id is null then
    raise exception 'FEL_EMISSION_DISABLED: Configuracion FEL ausente. FEL deshabilitado.'
      using errcode = 'P0001';
  end if;

  if v_config.environment <> 'stage' then
    raise exception 'FEL_ENVIRONMENT_NOT_STAGE: Ambiente FEL distinto de stage.'
      using errcode = 'P0001';
  end if;

  if not v_config.emission_enabled then
    raise exception 'FEL_EMISSION_DISABLED: La emision FEL esta deshabilitada.'
      using errcode = 'P0001';
  end if;

  if v_config.formal_contingency_enabled then
    raise exception 'FEL_CONTINGENCY_NOT_SUPPORTED: Contingencia formal no habilitada en esta version.'
      using errcode = 'P0001';
  end if;

  if coalesce(p_discount_total, 0) <> 0 then
    raise exception 'FEL_DISCOUNT_NOT_AUTHORITATIVE: Descuentos no persistidos en Supabase. Solicitud bloqueada.'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_fel_request:' || p_order_id::text));

  v_reconciliation := public.fel_order_payment_reconciliation(p_order_id);

  if coalesce(v_reconciliation ->> 'order_status', '') <> 'paid' then
    raise exception 'FEL_ORDER_NOT_PAID: La orden debe conservar estado paid.'
      using errcode = 'P0001';
  end if;

  if not coalesce((v_reconciliation ->> 'is_fully_paid')::boolean, false) then
    raise exception 'FEL_ORDER_NOT_PAID: La orden debe estar completamente pagada para solicitar FACT.'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'order_total')::numeric) <= 0 then
    raise exception 'FEL_ORDER_TOTAL_ZERO: El total de la orden debe ser mayor a cero.'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'amount_paid')::numeric)
      <> public.fel_round_money((v_reconciliation ->> 'order_total')::numeric) then
    raise exception 'FEL_PAYMENT_MISMATCH: El total pagado no coincide con el total de la orden.'
      using errcode = 'P0001';
  end if;

  if public.fel_round_money((v_reconciliation ->> 'balance_due')::numeric) > 0 then
    raise exception 'FEL_BALANCE_DUE: Existe saldo pendiente en la orden.'
      using errcode = 'P0001';
  end if;

  select d.* into v_existing
  from public.pos_fel_documents d
  where d.order_id = p_order_id
    and d.document_type = 'FACT';

  if v_existing.id is not null then
    return jsonb_build_object(
      'document_id', v_existing.id,
      'order_id', v_existing.order_id,
      'external_id', v_existing.external_id,
      'status', v_existing.status,
      'invoice_total', v_existing.invoice_total,
      'taxable_base', v_existing.taxable_base,
      'vat_total', v_existing.vat_total,
      'idempotent', true,
      'message', 'Documento FEL existente reutilizado.'
    );
  end if;

  perform public.fel_assert_pos_fel_pilot_sales_channel(
    (select o.sales_channel from public.pos_orders o where o.id = p_order_id)
  );

  v_receiver_nit := public.fel_normalize_receiver_nit(p_receiver_nit);
  if char_length(v_receiver_nit) > 20 then
    raise exception 'FEL_RECEIVER_NIT_TOO_LONG: NIT excede longitud permitida.'
      using errcode = 'P0001';
  end if;

  if v_receiver_nit = 'CF' then
    v_receiver_name := 'Consumidor Final';
  else
    v_receiver_name := nullif(trim(p_receiver_name), '');
    if v_receiver_name is null then
      raise exception 'FEL_RECEIVER_NAME_REQUIRED: Debes indicar nombre del receptor cuando proporcionas NIT.'
        using errcode = 'P0001';
    end if;
    if char_length(v_receiver_name) > 200 then
      raise exception 'FEL_RECEIVER_NAME_TOO_LONG: Nombre del receptor excede longitud permitida.'
        using errcode = 'P0001';
    end if;
  end if;

  v_receiver_address := nullif(trim(p_receiver_address), '');
  if v_receiver_address is not null and char_length(v_receiver_address) > 500 then
    raise exception 'FEL_RECEIVER_ADDRESS_TOO_LONG: Direccion excede longitud permitida.'
      using errcode = 'P0001';
  end if;

  v_receiver_email := nullif(trim(p_receiver_email), '');
  if v_receiver_email is not null and char_length(v_receiver_email) > 320 then
    raise exception 'FEL_RECEIVER_EMAIL_TOO_LONG: Correo excede longitud permitida.'
      using errcode = 'P0001';
  end if;

  v_receiver_snapshot := jsonb_build_object(
    'nit', v_receiver_nit,
    'name', v_receiver_name,
    'address', coalesce(v_receiver_address, ''),
    'email', coalesce(v_receiver_email, ''),
    'captured_at', now()
  );

  v_order_snapshot := v_reconciliation || jsonb_build_object(
    'captured_at', now(),
    'sales_channel', (select o.sales_channel from public.pos_orders o where o.id = p_order_id),
    'customer_id', (select o.customer_id from public.pos_orders o where o.id = p_order_id)
  );

  v_items_snapshot := public.fel_build_order_items_snapshot(p_order_id);

  v_taxable_gross := public.fel_round_money((v_reconciliation ->> 'order_total')::numeric);
  v_taxable_base := public.fel_taxable_base_from_gross(v_taxable_gross, v_config.tax_rate);
  v_vat_total := public.fel_vat_from_gross_included(v_taxable_gross, v_config.tax_rate);

  if not public.fel_assert_tax_reconciliation(v_taxable_base, v_vat_total, v_taxable_gross) then
    raise exception 'FEL_TAX_RECONCILIATION_FAILED: No fue posible conciliar base e IVA.'
      using errcode = 'P0001';
  end if;

  insert into public.pos_fel_documents (
    order_id,
    trigger_payment_id,
    document_type,
    external_id,
    environment,
    status,
    receiver_nit,
    receiver_name,
    receiver_address,
    receiver_email,
    receiver_snapshot,
    order_snapshot,
    items_snapshot,
    fiscal_description,
    gross_items_total,
    discount_total,
    tip_total,
    taxable_gross_total,
    taxable_base,
    vat_rate,
    vat_total,
    invoice_total,
    request_payload,
    requested_by
  ) values (
    p_order_id,
    nullif(v_reconciliation ->> 'trigger_payment_id', '')::uuid,
    'FACT',
    public.fel_build_external_id(p_order_id),
    v_config.environment,
    'pending_certification',
    v_receiver_nit,
    v_receiver_name,
    v_receiver_address,
    v_receiver_email,
    v_receiver_snapshot,
    v_order_snapshot,
    v_items_snapshot,
    v_config.invoice_description,
    v_taxable_gross,
    0,
    0,
    v_taxable_gross,
    v_taxable_base,
    v_config.tax_rate,
    v_vat_total,
    v_taxable_gross,
    null,
    auth.uid()
  )
  returning * into v_document;

  return jsonb_build_object(
    'document_id', v_document.id,
    'order_id', v_document.order_id,
    'trigger_payment_id', v_document.trigger_payment_id,
    'external_id', v_document.external_id,
    'status', v_document.status,
    'receiver_nit', v_document.receiver_nit,
    'receiver_name', v_document.receiver_name,
    'invoice_total', v_document.invoice_total,
    'taxable_base', v_document.taxable_base,
    'vat_total', v_document.vat_total,
    'items_snapshot_count', jsonb_array_length(v_document.items_snapshot),
    'request_payload', null,
    'idempotent', false,
    'message', 'Solicitud FEL registrada. Certificacion pendiente (Edge Function).'
  );
end;
$$;

create or replace function public.list_pos_fel_invoice_candidates(
  p_limit integer default 15,
  p_paid_within_days integer default 30,
  p_order_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_days integer;
  v_items jsonb;
begin
  if not public.fel_can_request_fel_certification() then
    raise exception 'No tienes permiso para solicitar certificacion FEL.'
      using errcode = 'P0001';
  end if;

  if p_limit is null then
    v_limit := 15;
  elsif p_limit < 1 or p_limit > 50 then
    raise exception 'FEL_LIST_PARAM_LIMIT_OUT_OF_RANGE: El limite debe estar entre 1 y 50.'
      using errcode = 'P0001';
  else
    v_limit := p_limit;
  end if;

  if p_paid_within_days is null then
    v_days := 30;
  elsif p_paid_within_days < 1 or p_paid_within_days > 90 then
    raise exception 'FEL_LIST_PARAM_DAYS_OUT_OF_RANGE: La ventana de dias debe estar entre 1 y 90.'
      using errcode = 'P0001';
  else
    v_days := p_paid_within_days;
  end if;

  select coalesce(
    jsonb_agg(row_payload order by sort_paid_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      ps.paid_at as sort_paid_at,
      jsonb_build_object(
        'order_id', o.id,
        'sales_channel', btrim(o.sales_channel),
        'order_total', public.fel_round_money(o.total),
        'paid_at', ps.paid_at,
        'display_label', case btrim(coalesce(o.sales_channel, ''))
          when 'takeout' then 'Para llevar'
          when 'dine_in' then 'En mesa'
          else 'Orden POS'
        end,
        'fel_status', d.status,
        'can_request', case
          when d.status = 'failed' then false
          when d.status is not null then false
          else true
        end
      ) as row_payload
    from public.pos_orders o
    inner join lateral (
      select
        coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::numeric(12, 2) as amount_paid,
        max(p.created_at) filter (where p.status = 'paid') as paid_at
      from public.pos_order_payments p
      where p.order_id = o.id
    ) ps on true
    left join lateral (
      select doc.id, doc.status
      from public.pos_fel_documents doc
      where doc.order_id = o.id
        and doc.document_type = 'FACT'
      order by doc.created_at desc
      limit 1
    ) d on true
    where o.status = 'paid'
      and btrim(coalesce(o.sales_channel, '')) in ('dine_in', 'takeout')
      and public.fel_round_money(o.total) > 0
      and ps.paid_at is not null
      and public.fel_round_money(ps.amount_paid) >= public.fel_round_money(o.total)
      and public.fel_round_money(greatest(0, o.total - ps.amount_paid)) = 0
      and public.fel_round_money(ps.amount_paid) = public.fel_round_money(o.total)
      and (
        (p_order_id is not null and o.id = p_order_id)
        or (
          p_order_id is null
          and ps.paid_at >= (now() - make_interval(days => v_days))
        )
      )
    order by ps.paid_at desc
    limit case when p_order_id is not null then 1 else v_limit end
  ) scoped;

  return jsonb_build_object(
    'items', v_items,
    'meta', jsonb_build_object(
      'limit', v_limit,
      'paid_within_days', v_days,
      'scoped_order_id', p_order_id
    )
  );
end;
$$;

revoke all on function public.list_pos_fel_invoice_candidates(integer, integer, uuid)
  from public, anon;

grant execute on function public.list_pos_fel_invoice_candidates(integer, integer, uuid)
  to authenticated;

comment on function public.list_pos_fel_invoice_candidates(integer, integer, uuid) is
  'Caja: lists paid pilot-channel POS orders eligible for FACT request. No PII/SAT payloads. '
  'paid_at from pos_order_payments.created_at (last paid payment). '
  'p_limit/p_paid_within_days: NULL uses defaults (15, 30); explicit out-of-range values raise FEL_LIST_PARAM_* errors. '
  'p_order_id: exact historical order lookup (ignores paid_within_days), max one row, never falls back to general list.';
