-- Low-stock purchase suggestions after requisition completion.
-- Apply after 141_requisitions_encargado_almacen.sql.

create table if not exists public.requisition_low_stock_suggestion_logs (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  stock_after numeric,
  minimum_stock numeric,
  suggested_quantity numeric,
  user_id uuid not null references public.profiles(id),
  action text not null check (action in ('suggested', 'added_to_po', 'ignored')),
  purchase_order_id text references public.purchase_orders(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists requisition_low_stock_logs_req_idx
  on public.requisition_low_stock_suggestion_logs (requisition_id, created_at desc);

create index if not exists requisition_low_stock_logs_item_idx
  on public.requisition_low_stock_suggestion_logs (item_id, created_at desc);

alter table public.requisition_low_stock_suggestion_logs enable row level security;

drop policy if exists "requisition_low_stock_logs_read" on public.requisition_low_stock_suggestion_logs;
create policy "requisition_low_stock_logs_read"
  on public.requisition_low_stock_suggestion_logs for select to authenticated
  using (
    public.current_profile_role() in ('admin', 'gerente_general', 'gerente', 'encargado_almacen')
  );

grant select on public.requisition_low_stock_suggestion_logs to authenticated;
grant all on public.requisition_low_stock_suggestion_logs to service_role;

create or replace function public.can_operate_purchase_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_role() in ('admin', 'gerente_general', 'gerente', 'encargado_almacen');
$$;

revoke all on function public.can_operate_purchase_orders() from public;
grant execute on function public.can_operate_purchase_orders() to authenticated;

create or replace function public.operational_today_date()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Guatemala')::date;
$$;

create or replace function public.suggest_purchase_quantity(
  p_stock_after numeric,
  p_minimum_stock numeric,
  p_moved_quantity numeric,
  p_conversion_factor numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  target_base numeric;
  needed_base numeric;
  factor numeric;
begin
  target_base := case
    when coalesce(p_minimum_stock, 0) > 0 then p_minimum_stock * 2
    else greatest(coalesce(p_moved_quantity, 0), 1)
  end;
  needed_base := greatest(
    target_base - coalesce(p_stock_after, 0),
    coalesce(p_moved_quantity, 0),
    1
  );
  factor := greatest(coalesce(nullif(p_conversion_factor, 0), 1), 0.0001);
  return ceil(needed_base / factor);
end;
$$;

create or replace function public.get_requisition_low_stock_impacts(
  p_requisition_id uuid,
  p_record_suggested boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requisition public.requisitions;
  impacts jsonb := '[]'::jsonb;
  impact_row record;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para consultar sugerencias de compra.';
  end if;

  select * into requisition
  from public.requisitions
  where id = p_requisition_id;

  if requisition.id is null then
    raise exception 'Requisicion no encontrada.';
  end if;

  if requisition.status <> 'completed' then
    raise exception 'La requisicion debe estar completada para evaluar stock minimo.';
  end if;

  if coalesce(requisition.is_test, false) then
    return '[]'::jsonb;
  end if;

  for impact_row in
    select
      ri.item_id,
      coalesce(ri.item_name, ii.name) as item_name,
      ii.sku,
      coalesce(ai.quantity, 0) as stock_after,
      coalesce(ai.minimum_quantity, 0) as minimum_stock,
      coalesce(ii.base_unit, ri.unit) as unit,
      ii.purchase_unit,
      ii.supplier,
      coalesce(ii.conversion_factor, 1) as conversion_factor,
      coalesce(ii.purchase_price, ii.cost_per_base_unit, 0) as purchase_price,
      coalesce(
        ri.converted_approved_quantity,
        ri.converted_requested_quantity,
        ri.approved_quantity,
        ri.requested_quantity,
        0
      ) as moved_quantity
    from public.requisition_items ri
    join public.inventory_items ii on ii.id = ri.item_id
    left join public.area_inventory ai
      on ai.item_id = ri.item_id
     and ai.area_id = requisition.from_area_id
    where ri.requisition_id = p_requisition_id
      and (
        coalesce(ai.quantity, 0) <= 0
        or (
          coalesce(ai.minimum_quantity, 0) > 0
          and coalesce(ai.quantity, 0) <= coalesce(ai.minimum_quantity, 0)
        )
      )
  loop
    impacts := impacts || jsonb_build_array(jsonb_build_object(
      'item_id', impact_row.item_id,
      'item_name', impact_row.item_name,
      'sku', impact_row.sku,
      'stock_after', impact_row.stock_after,
      'minimum_stock', impact_row.minimum_stock,
      'unit', impact_row.unit,
      'purchase_unit', coalesce(nullif(trim(impact_row.purchase_unit), ''), impact_row.unit),
      'supplier', impact_row.supplier,
      'conversion_factor', impact_row.conversion_factor,
      'purchase_price', impact_row.purchase_price,
      'moved_quantity', impact_row.moved_quantity,
      'suggested_quantity', public.suggest_purchase_quantity(
        impact_row.stock_after,
        impact_row.minimum_stock,
        impact_row.moved_quantity,
        impact_row.conversion_factor
      )
    ));

    if p_record_suggested then
      insert into public.requisition_low_stock_suggestion_logs (
        requisition_id,
        item_id,
        stock_after,
        minimum_stock,
        suggested_quantity,
        user_id,
        action
      ) values (
        p_requisition_id,
        impact_row.item_id,
        impact_row.stock_after,
        impact_row.minimum_stock,
        public.suggest_purchase_quantity(
          impact_row.stock_after,
          impact_row.minimum_stock,
          impact_row.moved_quantity,
          impact_row.conversion_factor
        ),
        auth.uid(),
        'suggested'
      );
    end if;
  end loop;

  return impacts;
end;
$$;

create or replace function public.build_purchase_order_line(
  p_item_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item public.inventory_items;
  qty numeric;
  factor numeric;
  unit_cost numeric;
begin
  select * into item from public.inventory_items where id = p_item_id;
  if item.id is null then
    raise exception 'Producto no encontrado.';
  end if;

  qty := greatest(coalesce(p_quantity, 0), 0.001);
  factor := greatest(coalesce(nullif(item.conversion_factor, 0), 1), 0.0001);
  unit_cost := coalesce(item.purchase_price, item.cost_per_base_unit, 0);

  return jsonb_build_object(
    'id', item.id::text,
    'producto_id', item.id::text,
    'inventory_item_id', item.id::text,
    'nombre', item.name,
    'item_name', item.name,
    'sku', item.sku,
    'codigo', item.sku,
    'barcode', coalesce(item.barcode, ''),
    'cantidad_compra', qty,
    'cantidadComprar', qty,
    'unidad_compra', coalesce(nullif(trim(item.purchase_unit), ''), item.base_unit),
    'unidadCompra', coalesce(nullif(trim(item.purchase_unit), ''), item.base_unit),
    'unit', coalesce(nullif(trim(item.purchase_unit), ''), item.base_unit),
    'precio_unitario_compra', unit_cost,
    'costoUnitario', unit_cost,
    'estimated_cost', unit_cost,
    'subtotal', qty * unit_cost,
    'factor_conversion', factor,
    'unidad_base', item.base_unit,
    'cantidad_base_total', qty * factor,
    'proveedor', coalesce(item.supplier, ''),
    'image_url', coalesce(item.image_url, ''),
    'source', 'requisition_low_stock'
  );
end;
$$;

create or replace function public.merge_purchase_order_items(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  merged jsonb := coalesce(p_existing, '[]'::jsonb);
  incoming_line jsonb;
  existing_line jsonb;
  product_key text;
  updated_qty numeric;
  idx int;
  found boolean;
begin
  for incoming_line in select * from jsonb_array_elements(coalesce(p_incoming, '[]'::jsonb))
  loop
    product_key := coalesce(
      nullif(incoming_line ->> 'producto_id', ''),
      nullif(incoming_line ->> 'inventory_item_id', ''),
      nullif(incoming_line ->> 'id', '')
    );
    found := false;

    for idx in 0 .. jsonb_array_length(merged) - 1
    loop
      existing_line := merged -> idx;
      if coalesce(
        nullif(existing_line ->> 'producto_id', ''),
        nullif(existing_line ->> 'inventory_item_id', ''),
        nullif(existing_line ->> 'id', '')
      ) = product_key then
        updated_qty := coalesce((existing_line ->> 'cantidadComprar')::numeric, 0)
          + coalesce((incoming_line ->> 'cantidadComprar')::numeric, 0);
        merged := jsonb_set(
          merged,
          array[idx::text],
          existing_line
            || jsonb_build_object(
              'cantidad_compra', updated_qty,
              'cantidadComprar', updated_qty,
              'subtotal', updated_qty * coalesce((existing_line ->> 'costoUnitario')::numeric, 0),
              'cantidad_base_total', updated_qty * coalesce((existing_line ->> 'factor_conversion')::numeric, 1)
            ),
          true
        );
        found := true;
        exit;
      end if;
    end loop;

    if not found then
      merged := merged || jsonb_build_array(incoming_line);
    end if;
  end loop;

  return merged;
end;
$$;

create or replace function public.get_or_create_today_purchase_order_draft()
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_profile_role();
  today_date date := public.operational_today_date();
  today_text text := to_char(today_date, 'YYYY-MM-DD');
  today_suffix text := to_char(today_date, 'YYYYMMDD');
  existing_order public.purchase_orders;
  next_count int;
  order_id text;
  order_number text;
  initial_status text;
  order_payload jsonb;
  actor_name text;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para operar ordenes de compra.';
  end if;

  select po.*
  into existing_order
  from public.purchase_orders po
  where coalesce(po.is_test, false) = false
    and po.status in ('borrador', 'pendiente_aprobacion')
    and (
      nullif(trim(po.data ->> 'fechaEmision'), '') = today_text
      or (po.created_at at time zone 'America/Guatemala')::date = today_date
    )
  order by po.created_at desc
  limit 1;

  if existing_order.id is not null then
    return existing_order;
  end if;

  select coalesce(full_name, username, email, 'Usuario')
  into actor_name
  from public.profiles
  where id = auth.uid();

  select count(*) + 1
  into next_count
  from public.purchase_orders
  where order_number like '%-' || today_suffix;

  order_id := (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  order_number := 'OC-' || lpad(next_count::text, 4, '0') || '-' || today_suffix;
  initial_status := case
    when actor_role in ('gerente', 'encargado_almacen') then 'pendiente_aprobacion'
    else 'borrador'
  end;

  order_payload := jsonb_build_object(
    'id', order_id,
    'numeroOrden', order_number,
    'fechaEmision', today_text,
    'fechaEsperadaEntrega', to_char(today_date + 3, 'YYYY-MM-DD'),
    'status', initial_status,
    'creadoPorId', auth.uid()::text,
    'creadoPorRol', actor_role,
    'proveedorId', null,
    'proveedor', jsonb_build_object(
      'nombre', 'Por definir',
      'contacto', '',
      'correo', '',
      'whatsapp', '',
      'encargado', ''
    ),
    'metodoCompra', 'manual',
    'requester', actor_name,
    'approver', '',
    'prioridad', 'normal',
    'lugar', 'almacen',
    'items', '[]'::jsonb,
    'creado', to_char(now() at time zone 'America/Guatemala', 'YYYY-MM-DD HH24:MI:SS'),
    'recepcion', null,
    'is_test', false,
    'source', 'requisition_low_stock'
  );

  insert into public.purchase_orders (
    id, order_number, status, data, created_by, created_by_role, is_test
  ) values (
    order_id,
    order_number,
    initial_status,
    order_payload,
    auth.uid(),
    actor_role,
    false
  )
  returning * into existing_order;

  return existing_order;
end;
$$;

create or replace function public.add_low_stock_items_to_today_purchase_order(
  p_requisition_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_order public.purchase_orders;
  incoming_items jsonb := '[]'::jsonb;
  line jsonb;
  merged_items jsonb;
  updated_payload jsonb;
  item_id uuid;
  qty numeric;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para agregar productos a ordenes de compra.';
  end if;

  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes seleccionar al menos un producto.';
  end if;

  draft_order := public.get_or_create_today_purchase_order_draft();

  for line in select * from jsonb_array_elements(p_items)
  loop
    item_id := nullif(line ->> 'item_id', '')::uuid;
    qty := coalesce((line ->> 'suggested_quantity')::numeric, (line ->> 'quantity')::numeric);
    if item_id is null or qty is null or qty <= 0 then
      raise exception 'Cada producto debe incluir item_id y cantidad valida.';
    end if;
    incoming_items := incoming_items || jsonb_build_array(
      public.build_purchase_order_line(item_id, qty)
    );
  end loop;

  merged_items := public.merge_purchase_order_items(draft_order.data -> 'items', incoming_items);
  updated_payload := jsonb_set(draft_order.data, '{items}', merged_items, true);

  update public.purchase_orders
  set
    data = updated_payload,
    updated_at = now()
  where id = draft_order.id
  returning * into draft_order;

  for line in select * from jsonb_array_elements(p_items)
  loop
    insert into public.requisition_low_stock_suggestion_logs (
      requisition_id,
      item_id,
      stock_after,
      minimum_stock,
      suggested_quantity,
      user_id,
      action,
      purchase_order_id
    ) values (
      p_requisition_id,
      nullif(line ->> 'item_id', '')::uuid,
      nullif(line ->> 'stock_after', '')::numeric,
      nullif(line ->> 'minimum_stock', '')::numeric,
      coalesce((line ->> 'suggested_quantity')::numeric, (line ->> 'quantity')::numeric),
      auth.uid(),
      'added_to_po',
      draft_order.id
    );
  end loop;

  return jsonb_build_object(
    'purchase_order_id', draft_order.id,
    'order_number', draft_order.order_number,
    'status', draft_order.status,
    'items_count', jsonb_array_length(merged_items)
  );
end;
$$;

create or replace function public.ignore_low_stock_purchase_suggestion(
  p_requisition_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
begin
  if not public.can_operate_purchase_orders() then
    raise exception 'No tienes permiso para registrar sugerencias omitidas.';
  end if;

  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes indicar los productos omitidos.';
  end if;

  for line in select * from jsonb_array_elements(p_items)
  loop
    insert into public.requisition_low_stock_suggestion_logs (
      requisition_id,
      item_id,
      stock_after,
      minimum_stock,
      suggested_quantity,
      user_id,
      action,
      notes
    ) values (
      p_requisition_id,
      nullif(line ->> 'item_id', '')::uuid,
      nullif(line ->> 'stock_after', '')::numeric,
      nullif(line ->> 'minimum_stock', '')::numeric,
      coalesce((line ->> 'suggested_quantity')::numeric, (line ->> 'quantity')::numeric),
      auth.uid(),
      'ignored',
      nullif(trim(p_notes), '')
    );
  end loop;
end;
$$;

revoke all on function public.get_requisition_low_stock_impacts(uuid, boolean) from public;
grant execute on function public.get_requisition_low_stock_impacts(uuid, boolean) to authenticated;

revoke all on function public.add_low_stock_items_to_today_purchase_order(uuid, jsonb) from public;
grant execute on function public.add_low_stock_items_to_today_purchase_order(uuid, jsonb) to authenticated;

revoke all on function public.ignore_low_stock_purchase_suggestion(uuid, jsonb, text) from public;
grant execute on function public.ignore_low_stock_purchase_suggestion(uuid, jsonb, text) to authenticated;

revoke all on function public.get_or_create_today_purchase_order_draft() from public;
grant execute on function public.get_or_create_today_purchase_order_draft() to authenticated;
