-- Productive purchase order reception: receipts, inventory, weighted average cost.
-- Apply after 142_requisition_low_stock_purchase_suggestions.sql.

-- ---------------------------------------------------------------------------
-- inventory_movements extensions
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  add column if not exists unit_cost_base numeric,
  add column if not exists unit_cost_purchase numeric,
  add column if not exists receipt_id uuid,
  add column if not exists receipt_line_id uuid,
  add column if not exists purchase_order_id text,
  add column if not exists invoice_number text;

-- ---------------------------------------------------------------------------
-- Receipt tables
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text not null default '',
  invoice_number text,
  invoice_date date,
  invoice_image_url text,
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  notes text,
  status text not null default 'received' check (status in ('received', 'cancelled')),
  is_test boolean not null default false,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

alter table public.purchase_order_receipts
  add column if not exists client_request_id uuid;

create unique index if not exists purchase_order_receipts_po_client_request_uidx
  on public.purchase_order_receipts (purchase_order_id, client_request_id)
  where client_request_id is not null;

create table if not exists public.purchase_order_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_order_receipts(id) on delete cascade,
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  item_name text not null,
  supplier_name text not null default '',
  qty_ordered numeric not null default 0 check (qty_ordered >= 0),
  qty_received numeric not null check (qty_received > 0),
  qty_received_base numeric not null check (qty_received_base > 0),
  purchase_unit text,
  base_unit text,
  conversion_factor numeric not null default 1 check (conversion_factor > 0),
  unit_cost_purchase numeric not null default 0 check (unit_cost_purchase >= 0),
  unit_cost_base numeric not null default 0 check (unit_cost_base >= 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_receipts_po_idx
  on public.purchase_order_receipts (purchase_order_id, received_at desc);

create index if not exists purchase_order_receipt_lines_po_item_idx
  on public.purchase_order_receipt_lines (purchase_order_id, item_id);

create index if not exists purchase_order_receipt_lines_receipt_idx
  on public.purchase_order_receipt_lines (receipt_id);

alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_lines enable row level security;

grant select on public.purchase_order_receipts to authenticated;
grant select on public.purchase_order_receipt_lines to authenticated;
grant all on public.purchase_order_receipts to service_role;
grant all on public.purchase_order_receipt_lines to service_role;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
create or replace function public.can_receive_purchase_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_role() in ('admin', 'gerente_general', 'encargado_almacen');
$$;

revoke all on function public.can_receive_purchase_orders() from public;
grant execute on function public.can_receive_purchase_orders() to authenticated;

drop policy if exists "purchase_order_receipts_operational_read" on public.purchase_order_receipts;
create policy "purchase_order_receipts_operational_read"
  on public.purchase_order_receipts for select to authenticated
  using (public.current_profile_role() in ('admin', 'gerente_general', 'gerente', 'encargado_almacen'));

drop policy if exists "purchase_order_receipt_lines_operational_read" on public.purchase_order_receipt_lines;
create policy "purchase_order_receipt_lines_operational_read"
  on public.purchase_order_receipt_lines for select to authenticated
  using (public.current_profile_role() in ('admin', 'gerente_general', 'gerente', 'encargado_almacen'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.po_receipt_qty_tolerance()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 0.001::numeric;
$$;

create or replace function public.po_line_item_id(p_line jsonb)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select nullif(
    coalesce(
      nullif(trim(p_line ->> 'inventory_item_id'), ''),
      nullif(trim(p_line ->> 'producto_id'), ''),
      nullif(trim(p_line ->> 'item_id'), ''),
      nullif(trim(p_line ->> 'id'), '')
    ),
    ''
  )::uuid;
$$;

create or replace function public.po_line_conversion_factor(p_line jsonb, p_item public.inventory_items)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(
    coalesce(
      nullif(trim(p_line ->> 'factor_conversion'), '')::numeric,
      nullif(trim(p_line ->> 'conversion_factor'), '')::numeric,
      p_item.conversion_factor,
      1
    ),
    0.0001
  );
$$;

create or replace function public.po_line_qty_ordered(p_line jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(
    coalesce(
      nullif(trim(p_line ->> 'cantidadComprar'), '')::numeric,
      nullif(trim(p_line ->> 'cantidad_compra'), '')::numeric,
      nullif(trim(p_line ->> 'quantity'), '')::numeric,
      0
    ),
    0
  );
$$;

create or replace function public.po_line_supplier_name(p_line jsonb, p_default text default '')
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(trim(p_line ->> 'proveedor'), ''),
    nullif(trim(p_line ->> 'supplier'), ''),
    nullif(trim(p_default), ''),
    'Sin proveedor'
  );
$$;

create or replace function public.po_item_received_base(
  p_purchase_order_id text,
  p_item_id uuid,
  p_is_test boolean default false
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(rl.qty_received_base), 0)
  from public.purchase_order_receipt_lines rl
  join public.purchase_order_receipts r on r.id = rl.receipt_id
  where rl.purchase_order_id = p_purchase_order_id
    and rl.item_id = p_item_id
    and r.status = 'received'
    and coalesce(r.is_test, false) = coalesce(p_is_test, false);
$$;

create or replace function public.po_receiving_target_area(p_order_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Fase 1: area destino desde data.lugar de la OC (UI manual usa "almacen").
  -- Fase 2: soportar target_area_id explicito y validar contra public.areas.
  select coalesce(nullif(trim(p_order_data ->> 'lugar'), ''), 'almacen');
$$;

create or replace function public.po_order_receiving_is_complete(
  p_purchase_order_id text,
  p_is_test boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_po_items jsonb;
  v_po_line jsonb;
  v_item public.inventory_items;
  v_item_id uuid;
  v_factor numeric;
  v_qty_ordered_base numeric;
  v_cumulative_base numeric;
begin
  select coalesce(data -> 'items', '[]'::jsonb)
  into v_po_items
  from public.purchase_orders
  where id = trim(p_purchase_order_id);

  if v_po_items is null or jsonb_array_length(v_po_items) = 0 then
    return false;
  end if;

  for v_po_line in select value from jsonb_array_elements(v_po_items)
  loop
    v_item_id := public.po_line_item_id(v_po_line);
    if v_item_id is null then
      continue;
    end if;
    select * into v_item from public.inventory_items where id = v_item_id;
    v_factor := public.po_line_conversion_factor(v_po_line, v_item);
    v_qty_ordered_base := public.po_line_qty_ordered(v_po_line) * v_factor;
    if v_qty_ordered_base <= 0 then
      continue;
    end if;
    v_cumulative_base := public.po_item_received_base(p_purchase_order_id, v_item_id, p_is_test);
    if v_cumulative_base + public.po_receipt_qty_tolerance() < v_qty_ordered_base then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.po_build_receipt_rpc_result(
  p_receipt_id uuid,
  p_order public.purchase_orders,
  p_idempotent boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt public.purchase_order_receipts;
  v_progress numeric;
  v_lines jsonb;
begin
  select * into v_receipt
  from public.purchase_order_receipts
  where id = p_receipt_id;

  if v_receipt.id is null then
    raise exception 'Recepcion no encontrada.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rl)), '[]'::jsonb)
  into v_lines
  from public.purchase_order_receipt_lines rl
  where rl.receipt_id = p_receipt_id;

  v_progress := (select (payload ->> 'progress_percent')::numeric
    from (select public.get_purchase_order_receiving_progress(p_order.id) as payload) q);

  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'purchase_order_id', p_order.id,
    'order_number', p_order.order_number,
    'status', p_order.status,
    'progress_percent', v_progress,
    'lines', v_lines,
    'is_test', coalesce(v_receipt.is_test, false),
    'idempotent', p_idempotent
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- receive_purchase_order_lines
-- ---------------------------------------------------------------------------
create or replace function public.receive_purchase_order_lines(
  p_purchase_order_id text,
  p_supplier_name text,
  p_lines jsonb,
  p_invoice jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_line jsonb;
  v_po_line jsonb;
  v_item public.inventory_items;
  v_item_id uuid;
  v_receipt public.purchase_order_receipts;
  v_receipt_line public.purchase_order_receipt_lines;
  v_supplier_name text := coalesce(nullif(trim(p_supplier_name), ''), 'Sin proveedor');
  v_supplier_id uuid;
  v_target_area text;
  v_is_test boolean;
  v_stock_before numeric;
  v_stock_total_before numeric;
  v_current_cost numeric;
  v_new_cost numeric;
  v_qty_ordered numeric;
  v_qty_ordered_base numeric;
  v_qty_received numeric;
  v_qty_received_base numeric;
  v_cumulative_base numeric;
  v_factor numeric;
  v_unit_cost_purchase numeric;
  v_unit_cost_base numeric;
  v_subtotal numeric;
  v_stock_after numeric;
  v_yield_pct numeric;
  v_usable_cost numeric;
  v_invoice_number text;
  v_invoice_date date;
  v_invoice_image_url text;
  v_invoice_notes text;
  v_all_complete boolean := true;
  v_any_received boolean := false;
  v_new_status text;
  v_progress numeric;
  v_recepcion_summary jsonb;
  v_result_lines jsonb := '[]'::jsonb;
  v_po_items jsonb;
  v_found boolean;
  v_profile public.inventory_yield_profiles;
  v_client_request_id uuid;
  v_touched_item_ids uuid[] := array[]::uuid[];
  v_recipe_item_id uuid;
begin
  if not public.can_receive_purchase_orders() then
    raise exception 'No tienes permiso para recibir ordenes de compra.';
  end if;

  if nullif(trim(p_purchase_order_id), '') is null then
    raise exception 'La orden de compra es obligatoria.';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Debes indicar al menos una linea para recibir.';
  end if;

  select * into v_order
  from public.purchase_orders
  where id = trim(p_purchase_order_id)
  for update;

  if v_order.id is null then
    raise exception 'Orden de compra no encontrada.';
  end if;

  if v_order.status in ('borrador', 'pendiente_aprobacion', 'rechazada', 'cancelada') then
    raise exception 'La orden no esta lista para recepcion (estado: %).', v_order.status;
  end if;

  if v_order.status not in ('aprobada', 'enviada_proveedor', 'recibida_parcial', 'recibida_completa') then
    raise exception 'La orden no puede recibirse en estado %.', v_order.status;
  end if;

  v_is_test := coalesce(v_order.is_test, false);
  v_target_area := public.po_receiving_target_area(v_order.data);
  v_po_items := coalesce(v_order.data -> 'items', '[]'::jsonb);

  v_client_request_id := nullif(trim(p_invoice ->> 'client_request_id'), '')::uuid;

  if v_client_request_id is not null then
    select * into v_receipt
    from public.purchase_order_receipts
    where purchase_order_id = v_order.id
      and client_request_id = v_client_request_id
    limit 1;

    if v_receipt.id is not null then
      return public.po_build_receipt_rpc_result(v_receipt.id, v_order, true);
    end if;
  end if;

  if public.po_order_receiving_is_complete(v_order.id, v_is_test) then
    raise exception
      'La orden % ya esta completamente recibida. No quedan productos pendientes.',
      coalesce(v_order.order_number, v_order.id);
  end if;

  v_invoice_number := nullif(trim(p_invoice ->> 'invoice_number'), '');
  v_invoice_date := nullif(trim(p_invoice ->> 'invoice_date'), '')::date;
  v_invoice_image_url := coalesce(
    nullif(trim(p_invoice ->> 'invoice_image_url'), ''),
    nullif(trim(p_invoice ->> 'invoice_image_base64'), '')
  );
  v_invoice_notes := nullif(trim(p_invoice ->> 'notes'), '');

  select s.id into v_supplier_id
  from public.suppliers s
  where lower(trim(s.name)) = lower(v_supplier_name)
  limit 1;

  insert into public.purchase_order_receipts (
    purchase_order_id,
    supplier_id,
    supplier_name,
    invoice_number,
    invoice_date,
    invoice_image_url,
    received_by,
    notes,
    is_test,
    client_request_id
  ) values (
    v_order.id,
    v_supplier_id,
    v_supplier_name,
    v_invoice_number,
    v_invoice_date,
    v_invoice_image_url,
    auth.uid(),
    v_invoice_notes,
    v_is_test,
    v_client_request_id
  )
  returning * into v_receipt;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item_id := nullif(trim(v_line ->> 'item_id'), '')::uuid;
    if v_item_id is null then
      raise exception 'Cada linea debe incluir item_id valido.';
    end if;

    v_qty_received := coalesce(
      nullif(trim(v_line ->> 'qty_received'), '')::numeric,
      nullif(trim(v_line ->> 'cantidadRecibida'), '')::numeric,
      0
    );
    if v_qty_received <= 0 then
      raise exception 'La cantidad recibida debe ser mayor que cero.';
    end if;

    select * into v_item from public.inventory_items where id = v_item_id;
    if v_item.id is null then
      raise exception 'Producto % no encontrado en inventario.', v_item_id;
    end if;

    v_po_line := null;
    v_found := false;
    for v_po_line in select value from jsonb_array_elements(v_po_items)
    loop
      if public.po_line_item_id(v_po_line) = v_item_id then
        v_found := true;
        exit;
      end if;
    end loop;

    if not v_found then
      raise exception 'El producto % no pertenece a la orden %.', v_item.name, v_order.order_number;
    end if;

    v_factor := public.po_line_conversion_factor(v_po_line, v_item);
    v_qty_ordered := public.po_line_qty_ordered(v_po_line);
    v_qty_ordered_base := v_qty_ordered * v_factor;
    v_qty_received_base := v_qty_received * v_factor;
    v_cumulative_base := public.po_item_received_base(v_order.id, v_item_id, v_is_test);

    if v_cumulative_base + v_qty_received_base > v_qty_ordered_base + public.po_receipt_qty_tolerance() then
      raise exception
        'Sobre-recepcion para %: pedido % base, ya recibido % base, intento % base.',
        v_item.name,
        round(v_qty_ordered_base, 3),
        round(v_cumulative_base, 3),
        round(v_qty_received_base, 3);
    end if;

    v_unit_cost_purchase := coalesce(
      nullif(trim(v_line ->> 'unit_cost_purchase'), '')::numeric,
      nullif(trim(v_line ->> 'costoUnitario'), '')::numeric,
      nullif(trim(v_po_line ->> 'costoUnitario'), '')::numeric,
      nullif(trim(v_po_line ->> 'precio_unitario_compra'), '')::numeric,
      v_item.purchase_price,
      v_item.cost_per_base_unit,
      0
    );
    v_unit_cost_base := case
      when v_unit_cost_purchase > 0 then v_unit_cost_purchase / v_factor
      else coalesce(v_item.cost_per_base_unit, 0)
    end;
    v_subtotal := v_qty_received * v_unit_cost_purchase;

    insert into public.purchase_order_receipt_lines (
      receipt_id,
      purchase_order_id,
      item_id,
      item_name,
      supplier_name,
      qty_ordered,
      qty_received,
      qty_received_base,
      purchase_unit,
      base_unit,
      conversion_factor,
      unit_cost_purchase,
      unit_cost_base,
      subtotal,
      notes
    ) values (
      v_receipt.id,
      v_order.id,
      v_item_id,
      coalesce(v_item.name, nullif(trim(v_po_line ->> 'nombre'), ''), 'Producto'),
      coalesce(
        nullif(trim(v_line ->> 'supplier_name'), ''),
        public.po_line_supplier_name(v_po_line, v_supplier_name)
      ),
      v_qty_ordered,
      v_qty_received,
      v_qty_received_base,
      coalesce(nullif(trim(v_po_line ->> 'unidadCompra'), ''), nullif(trim(v_po_line ->> 'unidad_compra'), ''), v_item.purchase_unit),
      v_item.base_unit,
      v_factor,
      v_unit_cost_purchase,
      v_unit_cost_base,
      v_subtotal,
      nullif(trim(v_line ->> 'notes'), '')
    )
    returning * into v_receipt_line;

    v_result_lines := v_result_lines || jsonb_build_array(to_jsonb(v_receipt_line));
    v_any_received := true;

    if not v_is_test then
      insert into public.area_inventory (item_id, area_id, quantity, minimum_quantity)
      values (v_item_id, v_target_area, 0, 0)
      on conflict (item_id, area_id) do nothing;

      select coalesce(quantity, 0) into v_stock_before
      from public.area_inventory
      where item_id = v_item_id and area_id = v_target_area
      for update;

      select * into v_item
      from public.inventory_items
      where id = v_item_id
      for update;

      select coalesce(sum(quantity), 0) into v_stock_total_before
      from public.area_inventory
      where item_id = v_item_id;

      v_current_cost := coalesce(v_item.cost_per_base_unit, 0);

      if v_stock_total_before + v_qty_received_base > 0 and v_unit_cost_base >= 0 then
        v_new_cost := case
          when v_stock_total_before <= 0 then v_unit_cost_base
          else ((v_stock_total_before * v_current_cost) + (v_qty_received_base * v_unit_cost_base))
            / (v_stock_total_before + v_qty_received_base)
        end;
      else
        v_new_cost := v_unit_cost_base;
      end if;

      v_stock_after := v_stock_before + v_qty_received_base;

      update public.area_inventory
      set quantity = v_stock_after, updated_at = now()
      where item_id = v_item_id and area_id = v_target_area;

      insert into public.inventory_movements (
        item_id,
        movement_type,
        to_area_id,
        quantity,
        unit,
        previous_quantity,
        new_quantity,
        source_type,
        source_id,
        notes,
        performed_by,
        is_test,
        unit_cost_base,
        unit_cost_purchase,
        receipt_id,
        receipt_line_id,
        purchase_order_id,
        invoice_number
      ) values (
        v_item_id,
        'purchase',
        v_target_area,
        v_qty_received_base,
        coalesce(v_item.base_unit, 'unidad'),
        v_stock_before,
        v_stock_after,
        'purchase_order_receipt',
        v_receipt.id::text,
        'Recepcion OC ' || coalesce(v_order.order_number, v_order.id)
          || ' proveedor ' || v_supplier_name
          || case when v_invoice_number is not null then ' factura ' || v_invoice_number else '' end,
        auth.uid(),
        false,
        v_unit_cost_base,
        v_unit_cost_purchase,
        v_receipt.id,
        v_receipt_line.id,
        v_order.id,
        v_invoice_number
      );

      select * into v_profile
      from public.inventory_yield_profiles
      where inventory_item_id = v_item_id and active = true;

      v_yield_pct := coalesce(v_profile.expected_yield_percent, 100);
      if v_yield_pct <= 0 then
        v_yield_pct := 100;
      end if;
      v_usable_cost := case when v_new_cost > 0 then v_new_cost / (v_yield_pct / 100.0) else 0 end;

      update public.inventory_items
      set
        cost_per_base_unit = v_new_cost,
        purchase_price = v_unit_cost_purchase,
        weighted_average_cost = v_new_cost,
        usable_cost = v_usable_cost,
        updated_at = now()
      where id = v_item_id;

      if not v_item_id = any(v_touched_item_ids) then
        v_touched_item_ids := array_append(v_touched_item_ids, v_item_id);
      end if;
    else
      insert into public.inventory_movements (
        item_id,
        movement_type,
        to_area_id,
        quantity,
        unit,
        source_type,
        source_id,
        notes,
        performed_by,
        is_test,
        unit_cost_base,
        unit_cost_purchase,
        receipt_id,
        receipt_line_id,
        purchase_order_id,
        invoice_number
      ) values (
        v_item_id,
        'purchase',
        v_target_area,
        v_qty_received_base,
        coalesce(v_item.base_unit, 'unidad'),
        'purchase_order_receipt_test',
        v_receipt.id::text,
        'PRUEBA: recepcion OC ' || coalesce(v_order.order_number, v_order.id),
        auth.uid(),
        true,
        v_unit_cost_base,
        v_unit_cost_purchase,
        v_receipt.id,
        v_receipt_line.id,
        v_order.id,
        v_invoice_number
      );
    end if;
  end loop;

  if not v_is_test then
    foreach v_recipe_item_id in array v_touched_item_ids
    loop
      perform public.recalculate_recipes_for_inventory_item(v_recipe_item_id);
    end loop;
  end if;

  -- Determine order completion across all PO items
  for v_po_line in select value from jsonb_array_elements(v_po_items)
  loop
    v_item_id := public.po_line_item_id(v_po_line);
    if v_item_id is null then
      continue;
    end if;
    select * into v_item from public.inventory_items where id = v_item_id;
    v_factor := public.po_line_conversion_factor(v_po_line, v_item);
    v_qty_ordered_base := public.po_line_qty_ordered(v_po_line) * v_factor;
    if v_qty_ordered_base <= 0 then
      continue;
    end if;
    v_cumulative_base := public.po_item_received_base(v_order.id, v_item_id, v_is_test);
    if v_cumulative_base + public.po_receipt_qty_tolerance() < v_qty_ordered_base then
      v_all_complete := false;
    end if;
  end loop;

  if v_all_complete then
    v_new_status := 'recibida_completa';
  elsif v_any_received then
    v_new_status := 'recibida_parcial';
  else
    v_new_status := v_order.status;
  end if;

  v_progress := (select (payload ->> 'progress_percent')::numeric
    from (
      select public.get_purchase_order_receiving_progress(v_order.id) as payload
    ) q);

  v_recepcion_summary := jsonb_build_object(
    'last_receipt_id', v_receipt.id,
    'last_supplier_name', v_supplier_name,
    'last_invoice_number', v_invoice_number,
    'last_received_at', v_receipt.received_at,
    'progress_percent', v_progress,
    'status', v_new_status,
    'legacy_note', 'Resumen; historial completo en purchase_order_receipts'
  );

  update public.purchase_orders
  set
    status = v_new_status,
    data = coalesce(v_order.data, '{}'::jsonb)
      || jsonb_build_object(
        'status', v_new_status,
        'recepcion_status', v_new_status,
        'receiving_progress_percent', v_progress,
        'recepcion', v_recepcion_summary
      ),
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'purchase_order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'progress_percent', v_progress,
    'lines', v_result_lines,
    'is_test', v_is_test,
    'idempotent', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_purchase_order_receiving_progress
-- ---------------------------------------------------------------------------
create or replace function public.get_purchase_order_receiving_progress(p_purchase_order_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_is_test boolean;
  v_po_items jsonb;
  v_po_line jsonb;
  v_item public.inventory_items;
  v_item_id uuid;
  v_factor numeric;
  v_qty_ordered numeric;
  v_qty_ordered_base numeric;
  v_qty_received_base numeric;
  v_qty_remaining_base numeric;
  v_supplier text;
  v_suppliers jsonb := '{}'::jsonb;
  v_supplier_items jsonb;
  v_item_entry jsonb;
  v_total_ordered numeric := 0;
  v_total_received numeric := 0;
  v_progress numeric := 0;
  v_line_status text;
  v_receipts jsonb := '[]'::jsonb;
begin
  if public.current_profile_role() not in ('admin', 'gerente_general', 'gerente', 'encargado_almacen') then
    raise exception 'No tienes permiso para consultar recepciones.';
  end if;

  select * into v_order
  from public.purchase_orders
  where id = trim(p_purchase_order_id);

  if v_order.id is null then
    raise exception 'Orden de compra no encontrada.';
  end if;

  v_is_test := coalesce(v_order.is_test, false);
  v_po_items := coalesce(v_order.data -> 'items', '[]'::jsonb);

  for v_po_line in select value from jsonb_array_elements(v_po_items)
  loop
    v_item_id := public.po_line_item_id(v_po_line);
    if v_item_id is null then
      continue;
    end if;

    select * into v_item from public.inventory_items where id = v_item_id;
    v_factor := public.po_line_conversion_factor(v_po_line, v_item);
    v_qty_ordered := public.po_line_qty_ordered(v_po_line);
    v_qty_ordered_base := v_qty_ordered * v_factor;
    v_qty_received_base := public.po_item_received_base(v_order.id, v_item_id, v_is_test);
    v_qty_remaining_base := greatest(v_qty_ordered_base - v_qty_received_base, 0);

    v_line_status := case
      when v_qty_ordered_base <= 0 then 'sin_pedido'
      when v_qty_received_base <= public.po_receipt_qty_tolerance() then 'pendiente'
      when v_qty_remaining_base <= public.po_receipt_qty_tolerance() then 'completo'
      else 'parcial'
    end;

    v_supplier := public.po_line_supplier_name(
      v_po_line,
      coalesce(v_order.data -> 'proveedor' ->> 'nombre', 'Sin proveedor')
    );

    v_item_entry := jsonb_build_object(
      'item_id', v_item_id,
      'item_name', coalesce(v_item.name, v_po_line ->> 'nombre', 'Producto'),
      'supplier_name', v_supplier,
      'qty_ordered', v_qty_ordered,
      'qty_ordered_base', v_qty_ordered_base,
      'qty_received', round(v_qty_received_base / v_factor, 3),
      'qty_received_base', v_qty_received_base,
      'qty_remaining', round(v_qty_remaining_base / v_factor, 3),
      'qty_remaining_base', v_qty_remaining_base,
      'purchase_unit', coalesce(v_po_line ->> 'unidadCompra', v_po_line ->> 'unidad_compra', v_item.purchase_unit),
      'base_unit', v_item.base_unit,
      'conversion_factor', v_factor,
      'status', v_line_status
    );

    v_supplier_items := coalesce(v_suppliers -> v_supplier, '[]'::jsonb) || jsonb_build_array(v_item_entry);
    v_suppliers := jsonb_set(v_suppliers, array[v_supplier], v_supplier_items, true);

    if v_qty_ordered_base > 0 then
      v_total_ordered := v_total_ordered + v_qty_ordered_base;
      v_total_received := v_total_received + least(v_qty_received_base, v_qty_ordered_base);
    end if;
  end loop;

  if v_total_ordered > 0 then
    v_progress := round((v_total_received / v_total_ordered) * 100, 2);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'receipt_id', r.id,
      'received_at', r.received_at,
      'supplier_name', r.supplier_name,
      'invoice_number', r.invoice_number,
      'invoice_date', r.invoice_date,
      'total', (
        select coalesce(sum(rl.subtotal), 0)
        from public.purchase_order_receipt_lines rl
        where rl.receipt_id = r.id
      ),
      'received_by', r.received_by,
      'is_test', r.is_test
    )
    order by r.received_at desc
  ), '[]'::jsonb)
  into v_receipts
  from public.purchase_order_receipts r
  where r.purchase_order_id = v_order.id
    and r.status = 'received';

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'progress_percent', v_progress,
    'suppliers', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'supplier_name', s.key,
          'items', s.value,
          'status', case
            when not exists (
              select 1
              from jsonb_array_elements(s.value) elem
              where elem ->> 'status' in ('pendiente', 'parcial')
            ) then 'completo'
            when exists (
              select 1
              from jsonb_array_elements(s.value) elem
              where elem ->> 'status' = 'completo'
            ) then 'parcial'
            else 'pendiente'
          end
        )
        order by s.key
      ), '[]'::jsonb)
      from jsonb_each(v_suppliers) s
    ),
    'receipts', v_receipts,
    'is_test', v_is_test
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance: auto CxP only when fully received (avoid estimated partial amounts)
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
  if new.status = 'recibida_completa'
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.create_finance_payable_from_purchase(new.id, true);
  end if;
  return new;
end;
$$;

revoke all on function public.receive_purchase_order_lines(text, text, jsonb, jsonb) from public;
grant execute on function public.receive_purchase_order_lines(text, text, jsonb, jsonb) to authenticated;

revoke all on function public.get_purchase_order_receiving_progress(text) from public;
grant execute on function public.get_purchase_order_receiving_progress(text) to authenticated;
