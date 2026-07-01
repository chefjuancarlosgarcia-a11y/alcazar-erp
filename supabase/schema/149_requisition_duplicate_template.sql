-- Requisition generation engine: duplicate, template, and future sources.
-- Apply after 148_inventory_unit_change_guardrails.sql.
--
-- Architecture
-- ------------
-- create_draft_requisition_with_current_config() is the single engine that:
--   - creates a new draft requisition header
--   - resolves current unit/conversion/stock snapshots per line
--   - skips problematic products and returns warnings
--
-- duplicate_requisition_with_current_units() is the public entry point for
-- requisition -> requisition flows (duplicate / template from an existing REQ).
--
-- Future entry points (separate migrations, same engine):
--   generate_requisition_from_template(p_template_id)     -> requisition_templates
--   generate_requisition_from_recurrence_rule(p_rule_id)  -> requisition_recurrence_rules
--   generate_requisition_from_low_stock(p_area_id, ...)   -> minimum stock replenishment
--   generate_requisition_from_ai_suggestion(p_payload)      -> AI recommendations
--
-- Planned tables (not created here):
--   requisition_templates, requisition_template_items
--   requisition_recurrence_rules, requisition_recurrence_rule_items

-- ---------------------------------------------------------------------------
-- Provenance columns (manual + automated generation)
-- ---------------------------------------------------------------------------

alter table public.requisitions
  add column if not exists creation_source text not null default 'manual',
  add column if not exists source_requisition_id uuid references public.requisitions(id) on delete set null,
  add column if not exists source_template_id uuid,
  add column if not exists source_rule_id uuid,
  add column if not exists generation_mode text,
  add column if not exists generated_at timestamptz,
  add column if not exists generated_by uuid references public.profiles(id) on delete set null;

comment on column public.requisitions.source_template_id is
  'Future FK to requisition_templates.id when the catalog template module ships.';

comment on column public.requisitions.source_rule_id is
  'Future FK to requisition_recurrence_rules.id for scheduled generation.';

alter table public.requisitions
  drop constraint if exists requisitions_creation_source_check;

alter table public.requisitions
  add constraint requisitions_creation_source_check
    check (creation_source in (
      'manual',
      'duplicate_full',
      'duplicate_pending',
      'template_requisition'
      -- future values via migration:
      -- 'template_catalog', 'recurring_rule', 'low_stock_replenishment', 'ai_recommendation'
    ));

alter table public.requisitions
  drop constraint if exists requisitions_generation_mode_check;

alter table public.requisitions
  add constraint requisitions_generation_mode_check
    check (
      generation_mode is null
      or generation_mode in (
        'full_duplicate',
        'pending_only',
        'template',
        'scheduled',
        'low_stock',
        'ai_suggested'
      )
    );

create index if not exists requisitions_source_requisition_idx
  on public.requisitions (source_requisition_id)
  where source_requisition_id is not null;

create index if not exists requisitions_source_template_idx
  on public.requisitions (source_template_id)
  where source_template_id is not null;

create index if not exists requisitions_source_rule_idx
  on public.requisitions (source_rule_id)
  where source_rule_id is not null;

create index if not exists requisitions_creation_source_idx
  on public.requisitions (creation_source, created_at desc);

-- ---------------------------------------------------------------------------
-- Engine: build draft requisition with current inventory configuration
-- ---------------------------------------------------------------------------

create or replace function public.create_draft_requisition_with_current_config(
  p_header jsonb,
  p_items jsonb,
  p_provenance jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester public.profiles;
  requester_id uuid := coalesce(
    nullif(p_header ->> 'requested_by_profile_id', '')::uuid,
    auth.uid()
  );
  from_id text := nullif(trim(p_header ->> 'from_area_id'), '');
  to_id text := nullif(trim(p_header ->> 'to_area_id'), '');
  priority text := coalesce(nullif(trim(p_header ->> 'priority'), ''), 'normal');
  header_notes text := nullif(trim(p_header ->> 'notes'), '');
  trace_message text := nullif(trim(p_provenance ->> 'trace_message'), '');
  is_test_flow boolean := coalesce((p_header ->> 'is_test')::boolean, false);
  creation_source text := coalesce(nullif(trim(p_provenance ->> 'creation_source'), ''), 'manual');
  generation_mode text := nullif(trim(p_provenance ->> 'generation_mode'), '');
  source_requisition_id uuid := nullif(p_provenance ->> 'source_requisition_id', '')::uuid;
  source_template_id uuid := nullif(p_provenance ->> 'source_template_id', '')::uuid;
  source_rule_id uuid := nullif(p_provenance ->> 'source_rule_id', '')::uuid;
  combined_notes text := header_notes;
  created public.requisitions;
  row_data jsonb;
  catalog_item public.inventory_items;
  requested_qty numeric;
  requested_unit text;
  conversion_factor numeric;
  converted_qty numeric;
  source_stock numeric;
  source_minimum numeric;
  availability text;
  items_copied integer := 0;
  items_skipped integer := 0;
  warnings jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Debes indicar al menos un producto para generar la requisicion.';
  end if;

  if is_test_flow and not public.can_create_test_flow() then
    raise exception 'Solo Administracion puede crear pruebas de flujo.';
  end if;

  perform public.assert_requisition_request_permissions(from_id, to_id, requester_id);

  select * into requester
  from public.profiles
  where id = requester_id
    and status = 'active';

  if requester.id is null then
    raise exception 'Selecciona quien esta haciendo la requisicion.';
  end if;

  if trace_message is not null then
    combined_notes := case
      when combined_notes is null then trace_message
      else combined_notes || E'\n\n' || trace_message
    end;
  end if;

  insert into public.requisitions (
    requisition_number,
    requested_by,
    requested_by_profile_id,
    requested_by_name,
    requested_by_role,
    from_area_id,
    to_area_id,
    priority,
    notes,
    status,
    is_test,
    creation_source,
    source_requisition_id,
    source_template_id,
    source_rule_id,
    generation_mode,
    generated_at,
    generated_by
  )
  values (
    public.next_requisition_number(),
    auth.uid(),
    requester.id,
    coalesce(requester.full_name, requester.username),
    requester.role,
    from_id,
    to_id,
    priority,
    combined_notes,
    'draft',
    is_test_flow,
    creation_source,
    source_requisition_id,
    source_template_id,
    source_rule_id,
    generation_mode,
    now(),
    auth.uid()
  )
  returning * into created;

  for row_data in select value from jsonb_array_elements(p_items)
  loop
    select * into catalog_item
    from public.inventory_items
    where id = nullif(row_data ->> 'item_id', '')::uuid;

    if catalog_item.id is null or coalesce(catalog_item.active, false) = false then
      items_skipped := items_skipped + 1;
      warnings := warnings || jsonb_build_array(jsonb_build_object(
        'item_id', nullif(row_data ->> 'item_id', '')::uuid,
        'item_name', coalesce(row_data ->> 'item_name', catalog_item.name, 'Producto'),
        'reason', 'producto_inactivo',
        'message', coalesce(row_data ->> 'item_name', catalog_item.name, 'Producto') || ' esta inactivo o ya no existe.'
      ));
      continue;
    end if;

    requested_qty := coalesce(nullif(row_data ->> 'requested_quantity', '')::numeric, 0);

    if requested_qty <= 0 then
      items_skipped := items_skipped + 1;
      warnings := warnings || jsonb_build_array(jsonb_build_object(
        'item_id', catalog_item.id,
        'item_name', catalog_item.name,
        'reason', 'sin_cantidad_pendiente',
        'message', catalog_item.name || ' no tiene cantidad valida para copiar.'
      ));
      continue;
    end if;

    requested_unit := coalesce(
      nullif(trim(row_data ->> 'requested_unit'), ''),
      nullif(trim(catalog_item.default_requisition_unit), ''),
      catalog_item.base_unit
    );

    if not public.has_item_requisition_unit_conversion(catalog_item.id, requested_unit) then
      items_skipped := items_skipped + 1;
      warnings := warnings || jsonb_build_array(jsonb_build_object(
        'item_id', catalog_item.id,
        'item_name', catalog_item.name,
        'reason', 'sin_conversion',
        'message', 'No existe conversion configurada para ' || catalog_item.name || ' en la unidad ' || requested_unit || '.'
      ));
      continue;
    end if;

    conversion_factor := public.resolve_item_requisition_unit_factor(catalog_item.id, requested_unit);
    converted_qty := requested_qty * conversion_factor;

    select quantity, minimum_quantity
    into source_stock, source_minimum
    from public.area_inventory
    where item_id = catalog_item.id
      and area_id = from_id;

    source_stock := coalesce(source_stock, 0);
    source_minimum := coalesce(source_minimum, 0);
    availability := case
      when source_stock <= 0 then 'Sin stock'
      when source_stock < converted_qty then 'Parcial'
      else 'Disponible'
    end;

    insert into public.requisition_items (
      requisition_id,
      item_id,
      item_name,
      unit,
      requested_quantity,
      approved_quantity,
      requested_unit,
      conversion_factor,
      converted_requested_quantity,
      availability_status,
      stock_available_at_request,
      stock_minimum_at_request,
      conversion_warning,
      notes,
      is_test,
      inventory_base_unit_at_request
    ) values (
      created.id,
      catalog_item.id,
      catalog_item.name,
      requested_unit,
      requested_qty,
      null,
      requested_unit,
      conversion_factor,
      converted_qty,
      availability,
      source_stock,
      source_minimum,
      false,
      nullif(trim(row_data ->> 'notes'), ''),
      is_test_flow,
      catalog_item.base_unit
    );

    items_copied := items_copied + 1;
  end loop;

  if items_copied = 0 then
    delete from public.requisitions where id = created.id;
    raise exception 'No se pudo copiar ningun producto. Revisa los productos inactivos o sin conversion valida.';
  end if;

  return jsonb_build_object(
    'new_requisition_id', created.id,
    'requisition_number', created.requisition_number,
    'items_copied', items_copied,
    'items_skipped', items_skipped,
    'warnings', warnings,
    'creation_source', creation_source,
    'generation_mode', generation_mode,
    'source_requisition_id', source_requisition_id,
    'source_template_id', source_template_id,
    'source_rule_id', source_rule_id
  );
end;
$$;

revoke all on function public.create_draft_requisition_with_current_config(jsonb, jsonb, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Helper: line specs from an existing requisition (duplicate / template flows)
-- ---------------------------------------------------------------------------

create or replace function public._requisition_line_specs_from_source(
  p_requisition_id uuid,
  p_quantity_mode text default 'source_requested'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  detail public.requisition_items;
  quantity_mode text := lower(nullif(trim(p_quantity_mode), ''));
  specs jsonb := '[]'::jsonb;
  requested_qty numeric;
begin
  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  if quantity_mode not in ('source_requested', 'pending_only') then
    raise exception 'Modo de cantidad invalido.';
  end if;

  for detail in
    select *
    from public.requisition_items
    where requisition_id = p_requisition_id
    order by created_at asc
  loop
    if quantity_mode = 'pending_only' then
      requested_qty := greatest(
        coalesce(detail.requested_quantity, 0) - coalesce(detail.delivered_quantity, 0),
        0
      );
    else
      requested_qty := coalesce(detail.requested_quantity, 0);
    end if;

    if requested_qty <= 0 then
      continue;
    end if;

    specs := specs || jsonb_build_array(jsonb_build_object(
      'item_id', detail.item_id,
      'item_name', detail.item_name,
      'requested_quantity', requested_qty,
      'notes', detail.notes
    ));
  end loop;

  return specs;
end;
$$;

revoke all on function public._requisition_line_specs_from_source(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Public API: duplicate / template from an existing requisition
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_requisition_with_current_units(
  p_requisition_id uuid,
  p_mode text default 'full_duplicate'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.requisitions;
  detail public.requisition_items;
  mode text := lower(nullif(trim(p_mode), ''));
  quantity_mode text;
  creation_source text;
  generation_mode text;
  trace_message text;
  line_specs jsonb;
  result jsonb;
  pre_warnings jsonb := '[]'::jsonb;
  pre_skipped integer := 0;
  pending_qty numeric;
begin
  if p_requisition_id is null then
    raise exception 'Requisicion invalida.';
  end if;

  if mode not in ('full_duplicate', 'pending_only', 'template') then
    raise exception 'Modo de duplicacion invalido.';
  end if;

  select * into source
  from public.requisitions
  where id = p_requisition_id;

  if source.id is null then
    raise exception 'Requisicion no encontrada.';
  end if;

  if coalesce(source.is_test, false) and not public.can_create_test_flow() then
    raise exception 'Solo Administracion puede duplicar pruebas de flujo.';
  end if;

  if mode = 'full_duplicate'
     and source.status not in ('draft', 'pending', 'approved', 'partially_fulfilled', 'pending_fulfillment') then
    raise exception 'Esta requisicion no puede duplicarse completa en su estado actual.';
  end if;

  if mode = 'pending_only'
     and source.status not in ('partially_fulfilled', 'pending_fulfillment') then
    raise exception 'Solo requisiciones parcialmente surtidas pueden duplicarse con cantidades pendientes.';
  end if;

  if mode = 'template'
     and source.status not in ('completed', 'partially_fulfilled', 'pending_fulfillment', 'cancelled') then
    raise exception 'Esta requisicion no puede usarse como plantilla en su estado actual.';
  end if;

  quantity_mode := case when mode = 'pending_only' then 'pending_only' else 'source_requested' end;

  if mode = 'pending_only' then
    for detail in
      select *
      from public.requisition_items
      where requisition_id = source.id
      order by created_at asc
    loop
      pending_qty := greatest(
        coalesce(detail.requested_quantity, 0) - coalesce(detail.delivered_quantity, 0),
        0
      );
      if pending_qty <= 0 then
        pre_skipped := pre_skipped + 1;
        pre_warnings := pre_warnings || jsonb_build_array(jsonb_build_object(
          'item_id', detail.item_id,
          'item_name', detail.item_name,
          'reason', 'sin_cantidad_pendiente',
          'message', coalesce(detail.item_name, 'Producto') || ' no tiene cantidad pendiente para copiar.'
        ));
      end if;
    end loop;
  end if;

  line_specs := public._requisition_line_specs_from_source(source.id, quantity_mode);

  if jsonb_array_length(coalesce(line_specs, '[]'::jsonb)) = 0 then
    raise exception 'No hay productos con cantidad valida para generar la nueva requisicion.';
  end if;

  if mode = 'template' then
    creation_source := 'template_requisition';
    generation_mode := 'template';
    trace_message := 'Nueva requisicion creada usando ' || source.requisition_number || ' como plantilla.';
  elsif mode = 'pending_only' then
    creation_source := 'duplicate_pending';
    generation_mode := 'pending_only';
    trace_message := 'Duplicada desde ' || source.requisition_number || ' con cantidades pendientes y configuracion actual del inventario.';
  else
    creation_source := 'duplicate_full';
    generation_mode := 'full_duplicate';
    trace_message := 'Duplicada desde ' || source.requisition_number || ' con configuracion actual del inventario.';
  end if;

  result := public.create_draft_requisition_with_current_config(
    jsonb_build_object(
      'from_area_id', source.from_area_id,
      'to_area_id', source.to_area_id,
      'priority', source.priority,
      'notes', source.notes,
      'is_test', coalesce(source.is_test, false)
    ),
    line_specs,
    jsonb_build_object(
      'creation_source', creation_source,
      'generation_mode', generation_mode,
      'source_requisition_id', source.id,
      'trace_message', trace_message
    )
  );

  return result
    || jsonb_build_object(
      'duplication_mode', generation_mode,
      'source_requisition_number', source.requisition_number,
      'items_skipped', coalesce((result ->> 'items_skipped')::integer, 0) + pre_skipped,
      'warnings', coalesce(result -> 'warnings', '[]'::jsonb) || pre_warnings
    );
end;
$$;

revoke all on function public.duplicate_requisition_with_current_units(uuid, text) from public;
grant execute on function public.duplicate_requisition_with_current_units(uuid, text) to authenticated;
