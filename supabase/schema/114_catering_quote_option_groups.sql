-- Catering quote option groups: alternative menu lines that do not all sum to total.
-- Apply after 088_catering_quotes_operations.sql.

alter table public.catering_quote_items
  add column if not exists line_kind text not null default 'normal'
    check (line_kind in ('normal', 'option')),
  add column if not exists option_group_name text,
  add column if not exists option_label text,
  add column if not exists is_selected_option boolean not null default false;

comment on column public.catering_quote_items.line_kind is
  'normal = suma al total; option = alternativa dentro de un grupo (solo suma si is_selected_option).';
comment on column public.catering_quote_items.option_group_name is
  'Nombre del grupo de opciones (ej. Platillos formales).';
comment on column public.catering_quote_items.option_label is
  'Etiqueta de la opcion (ej. Opcion A, Opcion Res).';
comment on column public.catering_quote_items.is_selected_option is
  'Si true, esta opcion alternativa suma al total de la cotizacion.';

-- ---------------------------------------------------------------------------
-- Totals: exclude unselected option alternatives
-- ---------------------------------------------------------------------------

create or replace function public.catering_quote_totals(
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_tax_rate numeric default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := coalesce(p_discount_amount, 0);
  v_total numeric(12, 2) := 0;
  v_item jsonb;
  v_qty numeric(12, 2);
  v_unit numeric(12, 2);
  v_line_kind text;
  v_selected boolean;
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select value from jsonb_array_elements(p_items) as value loop
      v_line_kind := coalesce(nullif(trim(v_item ->> 'line_kind'), ''), 'normal');
      v_selected := coalesce((v_item ->> 'is_selected_option')::boolean, false);

      if v_line_kind = 'option' and not v_selected then
        continue;
      end if;

      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
      v_unit := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0);
      v_subtotal := v_subtotal + round(v_qty * v_unit, 2);
    end loop;
  end if;

  v_discount := greatest(coalesce(v_discount, 0), 0);
  v_total := round(greatest(v_subtotal - v_discount, 0), 2);

  return jsonb_build_object(
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'tax_amount', 0,
    'tax_included', true,
    'total', v_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Quote RPCs: persist option group fields
-- ---------------------------------------------------------------------------

create or replace function public.create_catering_quote(
  p_request_id uuid,
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_valid_until date default null,
  p_notes text default null,
  p_terms text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
  v_quote public.catering_quotes;
  v_totals jsonb;
  v_item jsonb;
  v_sort integer := 0;
  v_quote_number text;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear cotizaciones de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes incluir al menos una linea en la cotizacion.';
  end if;

  select * into v_request from public.catering_requests where id = p_request_id;
  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  v_totals := public.catering_quote_totals(p_items, p_discount_amount);
  v_quote_number := public.next_catering_quote_number();

  insert into public.catering_quotes (
    request_id, quote_number, status, subtotal, discount_amount, tax_amount, total,
    valid_until, notes, terms, created_by
  )
  values (
    p_request_id, v_quote_number, 'draft',
    (v_totals ->> 'subtotal')::numeric,
    (v_totals ->> 'discount_amount')::numeric,
    0,
    (v_totals ->> 'total')::numeric,
    p_valid_until,
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_terms, '')), ''),
    auth.uid()
  )
  returning * into v_quote;

  for v_item in select value from jsonb_array_elements(p_items) as value loop
    v_sort := v_sort + 1;
    insert into public.catering_quote_items (
      quote_id, item_type, description, quantity, quantity_unit, unit_price, total_price, sort_order,
      line_kind, option_group_name, option_label, is_selected_option
    )
    values (
      v_quote.id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(trim(v_item ->> 'quantity_unit'), ''), 'unidades'),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      round(coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1) * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0), 2),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort),
      coalesce(nullif(trim(v_item ->> 'line_kind'), ''), 'normal'),
      nullif(trim(coalesce(v_item ->> 'option_group_name', '')), ''),
      nullif(trim(coalesce(v_item ->> 'option_label', '')), ''),
      coalesce((v_item ->> 'is_selected_option')::boolean, false)
    );
  end loop;

  perform public.log_catering_activity(
    v_quote.request_id, 'quote_created',
    'Cotizacion ' || v_quote.quote_number || ' creada',
    jsonb_build_object('quote_id', v_quote.id, 'quote_number', v_quote.quote_number, 'total', v_quote.total)
  );

  return public.get_catering_quote_detail(v_quote.id);
end;
$$;

create or replace function public.update_catering_quote(
  p_quote_id uuid,
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_valid_until date default null,
  p_notes text default null,
  p_terms text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_totals jsonb;
  v_item jsonb;
  v_sort integer := 0;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar cotizaciones de catering.';
  end if;

  if p_quote_id is null then
    raise exception 'p_quote_id es obligatorio.';
  end if;

  select * into v_quote from public.catering_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotizacion no encontrada.';
  end if;

  if v_quote.status <> 'draft' then
    raise exception 'Solo se pueden editar cotizaciones en borrador.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes incluir al menos una linea en la cotizacion.';
  end if;

  v_totals := public.catering_quote_totals(p_items, p_discount_amount);

  update public.catering_quotes
  set
    subtotal = (v_totals ->> 'subtotal')::numeric,
    discount_amount = (v_totals ->> 'discount_amount')::numeric,
    tax_amount = 0,
    total = (v_totals ->> 'total')::numeric,
    valid_until = p_valid_until,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    terms = nullif(trim(coalesce(p_terms, '')), ''),
    updated_at = now()
  where id = p_quote_id;

  delete from public.catering_quote_items where quote_id = p_quote_id;

  for v_item in select value from jsonb_array_elements(p_items) as value loop
    v_sort := v_sort + 1;
    insert into public.catering_quote_items (
      quote_id, item_type, description, quantity, quantity_unit, unit_price, total_price, sort_order,
      line_kind, option_group_name, option_label, is_selected_option
    )
    values (
      p_quote_id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(trim(v_item ->> 'quantity_unit'), ''), 'unidades'),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      round(coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1) * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0), 2),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort),
      coalesce(nullif(trim(v_item ->> 'line_kind'), ''), 'normal'),
      nullif(trim(coalesce(v_item ->> 'option_group_name', '')), ''),
      nullif(trim(coalesce(v_item ->> 'option_label', '')), ''),
      coalesce((v_item ->> 'is_selected_option')::boolean, false)
    );
  end loop;

  return public.get_catering_quote_detail(p_quote_id);
end;
$$;
