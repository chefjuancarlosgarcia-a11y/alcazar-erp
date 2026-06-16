-- Catering quotes operations: custom templates, quantity units, IVA incluido, terms, company settings.
-- Apply after 087_catering_quotes.sql.

-- ---------------------------------------------------------------------------
-- Schema extensions
-- ---------------------------------------------------------------------------

alter table public.catering_quotes
  add column if not exists terms text;

comment on column public.catering_quotes.terms is
  'Terminos y condiciones legales/comerciales de la cotizacion.';

alter table public.catering_quote_items
  add column if not exists quantity_unit text not null default 'unidades'
    check (quantity_unit in (
      'personas',
      'platos',
      'pizzas',
      'unidades',
      'horas',
      'servicios'
    ));

comment on column public.catering_quote_items.quantity_unit is
  'Unidad de medida de la cantidad (personas, pizzas, horas, etc.).';

-- ---------------------------------------------------------------------------
-- Custom templates
-- ---------------------------------------------------------------------------

create table if not exists public.catering_quote_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text not null default 'general',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catering_quote_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.catering_quote_templates(id) on delete cascade,
  item_type text not null default 'other' check (item_type in (
    'food', 'beverage', 'staff', 'equipment', 'transport', 'other'
  )),
  description text not null,
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  quantity_unit text not null default 'unidades' check (quantity_unit in (
    'personas', 'platos', 'pizzas', 'unidades', 'horas', 'servicios'
  )),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  sort_order integer not null default 0
);

create index if not exists catering_quote_templates_active_idx
  on public.catering_quote_templates (is_active, category, name);

create index if not exists catering_quote_template_items_template_idx
  on public.catering_quote_template_items (template_id, sort_order asc);

alter table public.catering_quote_templates enable row level security;
alter table public.catering_quote_template_items enable row level security;

grant select, insert, update, delete on public.catering_quote_templates to authenticated;
grant select, insert, update, delete on public.catering_quote_template_items to authenticated;
grant all on public.catering_quote_templates to service_role;
grant all on public.catering_quote_template_items to service_role;

drop policy if exists "catering_quote_templates_select" on public.catering_quote_templates;
create policy "catering_quote_templates_select"
  on public.catering_quote_templates for select to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_quote_templates_insert" on public.catering_quote_templates;
create policy "catering_quote_templates_insert"
  on public.catering_quote_templates for insert to authenticated
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quote_templates_update" on public.catering_quote_templates;
create policy "catering_quote_templates_update"
  on public.catering_quote_templates for update to authenticated
  using (public.can_manage_catering_requests())
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quote_templates_delete" on public.catering_quote_templates;
create policy "catering_quote_templates_delete"
  on public.catering_quote_templates for delete to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_quote_template_items_select" on public.catering_quote_template_items;
create policy "catering_quote_template_items_select"
  on public.catering_quote_template_items for select to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_quote_template_items_insert" on public.catering_quote_template_items;
create policy "catering_quote_template_items_insert"
  on public.catering_quote_template_items for insert to authenticated
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quote_template_items_update" on public.catering_quote_template_items;
create policy "catering_quote_template_items_update"
  on public.catering_quote_template_items for update to authenticated
  using (public.can_manage_catering_requests())
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quote_template_items_delete" on public.catering_quote_template_items;
create policy "catering_quote_template_items_delete"
  on public.catering_quote_template_items for delete to authenticated
  using (public.can_manage_catering_requests());

-- ---------------------------------------------------------------------------
-- Totals: IVA incluido (precios unitarios ya incluyen IVA)
-- TAX_RATE = 0.12 se conserva en catering_tax_rate() para uso futuro interno.
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
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select value from jsonb_array_elements(p_items) as value loop
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

comment on function public.catering_quote_totals(jsonb, numeric, numeric) is
  'IVA incluido en precios unitarios. total = subtotal - descuento. tax_amount siempre 0.';

-- ---------------------------------------------------------------------------
-- Default terms + company quote settings (app_settings)
-- ---------------------------------------------------------------------------

create or replace function public.catering_default_quote_terms()
returns text
language sql
immutable
set search_path = ''
as $$
  select $terms$
- Cotizacion valida hasta la fecha indicada.
- Reserva sujeta a disponibilidad de fecha y equipo.
- Para confirmar el evento se requiere anticipo.
- Cambios en menu, cantidad o locacion estan sujetos a disponibilidad y pueden ajustar el total.
- Precios incluyen IVA.
- Transporte fuera de Quetzaltenanga (Xela) puede tener costo adicional.
$terms$;
$$;

create or replace function public.catering_default_quote_settings()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'commercialName', 'Pizzeria El Gran Alcazar',
    'logoUrl', '',
    'address', '',
    'phone', '',
    'whatsapp', '',
    'email', '',
    'website', '',
    'nit', '',
    'headerText', 'Cotización de Catering',
    'defaultTerms', public.catering_default_quote_terms(),
    'pricesIncludeVat', true
  );
$$;

create or replace function public.get_catering_quote_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar configuracion de cotizaciones.';
  end if;

  select setting.value into v_value
  from public.app_settings setting
  where setting.key = 'catering_quote_settings';

  return public.catering_default_quote_settings() || coalesce(v_value, '{}'::jsonb);
end;
$$;

create or replace function public.can_edit_catering_quote_settings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in (
        'admin', 'gerente_general', 'gerente', 'gerente_operaciones'
      )
  );
$$;

create or replace function public.save_catering_quote_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current jsonb := public.get_catering_quote_settings();
  v_next jsonb;
begin
  if not public.can_edit_catering_quote_settings() then
    raise exception 'No tienes permiso para editar configuracion de cotizaciones.';
  end if;

  v_next := v_current || coalesce(p_settings, '{}'::jsonb);

  insert into public.app_settings (key, value)
  values ('catering_quote_settings', v_next)
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return public.get_catering_quote_settings();
end;
$$;

insert into public.app_settings (key, value)
values ('catering_quote_settings', public.catering_default_quote_settings())
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Template helpers
-- ---------------------------------------------------------------------------

create or replace function public.catering_quote_template_detail(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template public.catering_quote_templates;
  v_items jsonb := '[]'::jsonb;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar plantillas.';
  end if;

  select * into v_template from public.catering_quote_templates where id = p_template_id;
  if not found then
    raise exception 'Plantilla no encontrada.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order asc, item.id asc), '[]'::jsonb)
  into v_items
  from public.catering_quote_template_items item
  where item.template_id = p_template_id;

  return jsonb_build_object('template', to_jsonb(v_template), 'items', v_items);
end;
$$;

create or replace function public.list_catering_quote_templates(p_include_inactive boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar plantillas.';
  end if;

  select coalesce(jsonb_agg(row_data order by name asc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', template.id,
      'name', template.name,
      'description', template.description,
      'category', template.category,
      'is_active', template.is_active,
      'item_count', (
        select count(*) from public.catering_quote_template_items item where item.template_id = template.id
      ),
      'created_at', template.created_at,
      'updated_at', template.updated_at
    ) as row_data,
    template.name
    from public.catering_quote_templates template
    where p_include_inactive or template.is_active
  ) listed;

  return jsonb_build_object('rows', v_rows);
end;
$$;

create or replace function public.upsert_catering_quote_template(
  p_template_id uuid,
  p_name text,
  p_description text default null,
  p_category text default 'general',
  p_is_active boolean default true,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.catering_quote_templates;
  v_item jsonb;
  v_sort integer := 0;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para guardar plantillas.';
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'El nombre de la plantilla es obligatorio.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La plantilla debe incluir al menos una linea.';
  end if;

  if p_template_id is null then
    insert into public.catering_quote_templates (name, description, category, is_active, created_by)
    values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(nullif(trim(p_category), ''), 'general'), coalesce(p_is_active, true), auth.uid())
    returning * into v_template;
  else
    update public.catering_quote_templates
    set
      name = trim(p_name),
      description = nullif(trim(coalesce(p_description, '')), ''),
      category = coalesce(nullif(trim(p_category), ''), 'general'),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where id = p_template_id
    returning * into v_template;

    if not found then
      raise exception 'Plantilla no encontrada.';
    end if;

    delete from public.catering_quote_template_items where template_id = p_template_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) as value loop
    v_sort := v_sort + 1;
    insert into public.catering_quote_template_items (
      template_id, item_type, description, quantity, quantity_unit, unit_price, sort_order
    )
    values (
      v_template.id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(trim(v_item ->> 'quantity_unit'), ''), 'unidades'),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort)
    );
  end loop;

  return public.catering_quote_template_detail(v_template.id);
end;
$$;

create or replace function public.duplicate_catering_quote_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.catering_quote_templates;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_source from public.catering_quote_templates where id = p_template_id;
  if not found then
    raise exception 'Plantilla no encontrada.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type', item.item_type,
    'description', item.description,
    'quantity', item.quantity,
    'quantity_unit', item.quantity_unit,
    'unit_price', item.unit_price,
    'sort_order', item.sort_order
  ) order by item.sort_order asc), '[]'::jsonb)
  into v_items
  from public.catering_quote_template_items item
  where item.template_id = p_template_id;

  return public.upsert_catering_quote_template(
    null,
    v_source.name || ' (copia)',
    v_source.description,
    v_source.category,
    true,
    v_items
  );
end;
$$;

create or replace function public.delete_catering_quote_template(p_template_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para eliminar plantillas.';
  end if;

  delete from public.catering_quote_templates where id = p_template_id;
  return found;
end;
$$;

create or replace function public.save_catering_quote_as_template(
  p_quote_id uuid,
  p_name text,
  p_description text default null,
  p_category text default 'general'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type', item.item_type,
    'description', item.description,
    'quantity', item.quantity,
    'quantity_unit', item.quantity_unit,
    'unit_price', item.unit_price,
    'sort_order', item.sort_order
  ) order by item.sort_order asc), '[]'::jsonb)
  into v_items
  from public.catering_quote_items item
  where item.quote_id = p_quote_id;

  if v_items = '[]'::jsonb then
    raise exception 'La cotizacion no tiene lineas para guardar como plantilla.';
  end if;

  return public.upsert_catering_quote_template(null, p_name, p_description, p_category, true, v_items);
end;
$$;

-- Seed built-in templates (only if table empty)
do $$
declare
  v_template_id uuid;
begin
  if exists (select 1 from public.catering_quote_templates limit 1) then
    return;
  end if;

  insert into public.catering_quote_templates (name, description, category, is_active)
  values ('Pizza Party', 'Paquete pizza para fiestas', 'social', true)
  returning id into v_template_id;
  insert into public.catering_quote_template_items (template_id, item_type, description, quantity, quantity_unit, unit_price, sort_order) values
    (v_template_id, 'food', 'Pizza mediana surtida', 10, 'pizzas', 85, 1),
    (v_template_id, 'food', 'Pizza grande premium', 5, 'pizzas', 120, 2),
    (v_template_id, 'beverage', 'Refresco 2L', 8, 'unidades', 18, 3),
    (v_template_id, 'equipment', 'Servicio de mesas y sillas', 1, 'servicios', 350, 4);

  insert into public.catering_quote_templates (name, description, category, is_active)
  values ('Evento Corporativo', 'Menu ejecutivo y coffee break', 'corporativo', true)
  returning id into v_template_id;
  insert into public.catering_quote_template_items (template_id, item_type, description, quantity, quantity_unit, unit_price, sort_order) values
    (v_template_id, 'food', 'Menu ejecutivo (entrada, plato fuerte, postre)', 50, 'personas', 95, 1),
    (v_template_id, 'beverage', 'Coffee break (cafe, te, pasteles)', 50, 'personas', 35, 2),
    (v_template_id, 'staff', 'Mesero / servicio', 4, 'horas', 250, 3),
    (v_template_id, 'equipment', 'Montaje salon y vajilla', 1, 'servicios', 800, 4);

  insert into public.catering_quote_templates (name, description, category, is_active)
  values ('Boda', 'Banquete nupcial completo', 'social', true)
  returning id into v_template_id;
  insert into public.catering_quote_template_items (template_id, item_type, description, quantity, quantity_unit, unit_price, sort_order) values
    (v_template_id, 'food', 'Banquete nupcial por persona', 120, 'personas', 185, 1),
    (v_template_id, 'beverage', 'Barra de bebidas por persona', 120, 'personas', 45, 2),
    (v_template_id, 'staff', 'Brigada de servicio', 8, 'horas', 300, 3),
    (v_template_id, 'equipment', 'Montaje y decoracion basica', 1, 'servicios', 2500, 4),
    (v_template_id, 'transport', 'Traslado de equipo', 1, 'servicios', 600, 5);

  insert into public.catering_quote_templates (name, description, category, is_active)
  values ('Cumpleaños', 'Buffet y pastel', 'social', true)
  returning id into v_template_id;
  insert into public.catering_quote_template_items (template_id, item_type, description, quantity, quantity_unit, unit_price, sort_order) values
    (v_template_id, 'food', 'Buffet infantil / familiar', 30, 'personas', 75, 1),
    (v_template_id, 'food', 'Pastel personalizado', 1, 'unidades', 450, 2),
    (v_template_id, 'beverage', 'Bebidas surtidas', 30, 'personas', 15, 3),
    (v_template_id, 'equipment', 'Decoracion tematica basica', 1, 'servicios', 500, 4);

  insert into public.catering_quote_templates (name, description, category, is_active)
  values ('Coffee Break', 'Estacion de cafe y bocadillos', 'corporativo', true)
  returning id into v_template_id;
  insert into public.catering_quote_template_items (template_id, item_type, description, quantity, quantity_unit, unit_price, sort_order) values
    (v_template_id, 'food', 'Canapes y bocadillos', 25, 'personas', 28, 1),
    (v_template_id, 'beverage', 'Cafe, te y jugos', 25, 'personas', 18, 2),
    (v_template_id, 'equipment', 'Estacion de coffee break', 1, 'servicios', 300, 3);
end;
$$;

-- ---------------------------------------------------------------------------
-- Quote RPCs (terms + quantity_unit)
-- ---------------------------------------------------------------------------

drop function if exists public.create_catering_quote(uuid, jsonb, numeric, date, text);

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
      quote_id, item_type, description, quantity, quantity_unit, unit_price, total_price, sort_order
    )
    values (
      v_quote.id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(trim(v_item ->> 'quantity_unit'), ''), 'unidades'),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      round(coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1) * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0), 2),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort)
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

drop function if exists public.update_catering_quote(uuid, jsonb, numeric, date, text);

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
      quote_id, item_type, description, quantity, quantity_unit, unit_price, total_price, sort_order
    )
    values (
      p_quote_id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(trim(v_item ->> 'quantity_unit'), ''), 'unidades'),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      round(coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1) * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0), 2),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort)
    );
  end loop;

  return public.get_catering_quote_detail(p_quote_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.catering_default_quote_terms() from public;
revoke all on function public.catering_default_quote_settings() from public;
revoke all on function public.get_catering_quote_settings() from public;
revoke all on function public.can_edit_catering_quote_settings() from public;
revoke all on function public.save_catering_quote_settings(jsonb) from public;
revoke all on function public.catering_quote_template_detail(uuid) from public;
revoke all on function public.list_catering_quote_templates(boolean) from public;
revoke all on function public.upsert_catering_quote_template(uuid, text, text, text, boolean, jsonb) from public;
revoke all on function public.duplicate_catering_quote_template(uuid) from public;
revoke all on function public.delete_catering_quote_template(uuid) from public;
revoke all on function public.save_catering_quote_as_template(uuid, text, text, text) from public;
revoke all on function public.create_catering_quote(uuid, jsonb, numeric, date, text, text) from public;
revoke all on function public.update_catering_quote(uuid, jsonb, numeric, date, text, text) from public;

grant execute on function public.catering_default_quote_terms() to authenticated;
grant execute on function public.catering_default_quote_settings() to authenticated;
grant execute on function public.get_catering_quote_settings() to authenticated;
grant execute on function public.can_edit_catering_quote_settings() to authenticated;
grant execute on function public.save_catering_quote_settings(jsonb) to authenticated;
grant execute on function public.catering_quote_template_detail(uuid) to authenticated;
grant execute on function public.list_catering_quote_templates(boolean) to authenticated;
grant execute on function public.upsert_catering_quote_template(uuid, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.duplicate_catering_quote_template(uuid) to authenticated;
grant execute on function public.delete_catering_quote_template(uuid) to authenticated;
grant execute on function public.save_catering_quote_as_template(uuid, text, text, text) to authenticated;
grant execute on function public.create_catering_quote(uuid, jsonb, numeric, date, text, text) to authenticated;
grant execute on function public.update_catering_quote(uuid, jsonb, numeric, date, text, text) to authenticated;
