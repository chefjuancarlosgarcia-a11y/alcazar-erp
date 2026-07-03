-- Bakery / Pastry Production Center MVP
-- Apply after 155_attendance_mark_permission.sql
--
-- NOTE: Tables use bakery_* prefix to avoid collision with existing
-- public.production_batches (internal production / kardex from 038).

-- ---------------------------------------------------------------------------
-- Role: supervisor_panaderia
-- ---------------------------------------------------------------------------
insert into public.user_roles (role_key, role_name, description, category, is_system, is_active)
values (
  'supervisor_panaderia',
  'Supervisor Panadería',
  'Opera producción de panadería y pastelería: lotes, diario, masas y merma.',
  'produccion',
  true,
  true
)
on conflict (role_key) do update
set role_name = excluded.role_name,
    description = excluded.description,
    category = excluded.category,
    is_active = true;

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_access_bakery_module()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'gerente', 'supervisor_panaderia'
      )
  );
$$;

create or replace function public.can_manage_bakery_plans()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'gerente'
      )
  );
$$;

create or replace function public.can_operate_bakery_production()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_access_bakery_module();
$$;

create or replace function public.bakery_slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(
    left(
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(nullif(trim(p_text), ''), 'producto')), 'áéíóúñ ', 'aeioun_'),
          '[^a-z0-9]', '', 'g'
        ),
        '^$', 'producto'
      ),
      24
    )
  );
$$;

revoke all on function
  public.can_access_bakery_module(),
  public.can_manage_bakery_plans(),
  public.can_operate_bakery_production(),
  public.bakery_slugify(text)
from public;
grant execute on function
  public.can_access_bakery_module(),
  public.can_manage_bakery_plans(),
  public.can_operate_bakery_production(),
  public.bakery_slugify(text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for bakery evidence photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bakery-evidence',
  'bakery-evidence',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bakery_evidence_public_read" on storage.objects;
create policy "bakery_evidence_public_read"
  on storage.objects for select to public
  using (bucket_id = 'bakery-evidence');

drop policy if exists "bakery_evidence_authenticated_insert" on storage.objects;
create policy "bakery_evidence_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'bakery-evidence'
    and public.can_operate_bakery_production()
  );

drop policy if exists "bakery_evidence_authenticated_update" on storage.objects;
create policy "bakery_evidence_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'bakery-evidence' and public.can_operate_bakery_production())
  with check (bucket_id = 'bakery-evidence' and public.can_operate_bakery_production());

-- ---------------------------------------------------------------------------
-- Module 1: Plan Maestro
-- ---------------------------------------------------------------------------
create table if not exists public.bakery_production_plan_items (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  product_name text not null,
  planned_quantity numeric not null check (planned_quantity > 0),
  unit text not null default 'Unidad',
  required_date date not null,
  destination_area_id text references public.areas(id) on delete set null,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  notes text,
  requested_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'delivered', 'partial', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bakery_plan_required_date_idx
  on public.bakery_production_plan_items (required_date, status);
create index if not exists bakery_plan_assigned_idx
  on public.bakery_production_plan_items (assigned_to, required_date);

-- ---------------------------------------------------------------------------
-- Module 2: Production batches
-- ---------------------------------------------------------------------------
create table if not exists public.bakery_production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  plan_item_id uuid references public.bakery_production_plan_items(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  product_name text not null,
  planned_quantity numeric not null check (planned_quantity > 0),
  actual_quantity numeric check (actual_quantity is null or actual_quantity >= 0),
  unit text not null default 'Unidad',
  responsible_user_id uuid references public.profiles(id) on delete set null,
  destination_area_id text references public.areas(id) on delete set null,
  recipe_id uuid references public.standard_recipes(id) on delete set null,
  status text not null default 'created'
    check (status in ('created', 'in_progress', 'delivered', 'partial', 'cancelled')),
  started_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bakery_batches_status_idx
  on public.bakery_production_batches (status, created_at desc);
create index if not exists bakery_batches_plan_idx
  on public.bakery_production_batches (plan_item_id);

-- ---------------------------------------------------------------------------
-- Module 3: Baker diary
-- ---------------------------------------------------------------------------
create table if not exists public.bakery_production_diary_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bakery_production_batches(id) on delete cascade,
  start_time timestamptz,
  end_time timestamptz,
  ambient_temperature numeric,
  planned_quantity numeric,
  actual_quantity numeric check (actual_quantity is null or actual_quantity >= 0),
  recipe_id uuid references public.standard_recipes(id) on delete set null,
  process_notes text,
  quality_result text check (quality_result is null or quality_result in ('good', 'acceptable', 'failed')),
  issues_detected text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists bakery_diary_batch_unique_idx
  on public.bakery_production_diary_entries (batch_id);

-- ---------------------------------------------------------------------------
-- Module 4: Batch photos
-- ---------------------------------------------------------------------------
create table if not exists public.bakery_production_batch_photos (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bakery_production_batches(id) on delete cascade,
  photo_url text not null,
  photo_type text not null check (photo_type in ('production', 'delivery', 'waste')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bakery_batch_photos_batch_idx
  on public.bakery_production_batch_photos (batch_id, photo_type);

-- ---------------------------------------------------------------------------
-- Module 5: Dough batches
-- ---------------------------------------------------------------------------
create table if not exists public.bakery_dough_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  dough_type text not null,
  recipe_id uuid references public.standard_recipes(id) on delete set null,
  quantity_units numeric not null check (quantity_units > 0),
  unit_weight numeric check (unit_weight is null or unit_weight > 0),
  total_weight numeric check (total_weight is null or total_weight >= 0),
  mixed_at timestamptz not null default now(),
  cold_room_started_at timestamptz,
  status text not null default 'mixed'
    check (status in ('mixed', 'resting', 'balled', 'cold_room', 'ready', 'used', 'discarded')),
  responsible_user_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bakery_dough_status_idx
  on public.bakery_dough_batches (status, cold_room_started_at);

-- ---------------------------------------------------------------------------
-- Module 6: Waste records
-- ---------------------------------------------------------------------------
create table if not exists public.bakery_waste_records (
  id uuid primary key default gen_random_uuid(),
  related_batch_id uuid references public.bakery_production_batches(id) on delete set null,
  related_dough_batch_id uuid references public.bakery_dough_batches(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  product_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null default 'Unidad',
  waste_reason text not null check (waste_reason in (
    'burned', 'overfermented', 'expired', 'dropped', 'recipe_error',
    'poor_quality', 'overproduction', 'other'
  )),
  notes text,
  photo_url text not null,
  reported_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bakery_waste_created_idx
  on public.bakery_waste_records (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists set_bakery_plan_items_updated_at on public.bakery_production_plan_items;
create trigger set_bakery_plan_items_updated_at
  before update on public.bakery_production_plan_items
  for each row execute procedure public.set_inventory_updated_at();

drop trigger if exists set_bakery_batches_updated_at on public.bakery_production_batches;
create trigger set_bakery_batches_updated_at
  before update on public.bakery_production_batches
  for each row execute procedure public.set_inventory_updated_at();

drop trigger if exists set_bakery_diary_updated_at on public.bakery_production_diary_entries;
create trigger set_bakery_diary_updated_at
  before update on public.bakery_production_diary_entries
  for each row execute procedure public.set_inventory_updated_at();

drop trigger if exists set_bakery_dough_updated_at on public.bakery_dough_batches;
create trigger set_bakery_dough_updated_at
  before update on public.bakery_dough_batches
  for each row execute procedure public.set_inventory_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.bakery_production_plan_items enable row level security;
alter table public.bakery_production_batches enable row level security;
alter table public.bakery_production_diary_entries enable row level security;
alter table public.bakery_production_batch_photos enable row level security;
alter table public.bakery_dough_batches enable row level security;
alter table public.bakery_waste_records enable row level security;

grant select, insert, update on public.bakery_production_plan_items to authenticated;
grant select, insert, update on public.bakery_production_batches to authenticated;
grant select, insert, update on public.bakery_production_diary_entries to authenticated;
grant select, insert on public.bakery_production_batch_photos to authenticated;
grant select, insert, update on public.bakery_dough_batches to authenticated;
grant select, insert on public.bakery_waste_records to authenticated;

drop policy if exists "bakery_plan_select" on public.bakery_production_plan_items;
create policy "bakery_plan_select"
  on public.bakery_production_plan_items for select to authenticated
  using (public.can_access_bakery_module());

drop policy if exists "bakery_plan_insert" on public.bakery_production_plan_items;
create policy "bakery_plan_insert"
  on public.bakery_production_plan_items for insert to authenticated
  with check (public.can_manage_bakery_plans());

drop policy if exists "bakery_plan_update" on public.bakery_production_plan_items;
create policy "bakery_plan_update"
  on public.bakery_production_plan_items for update to authenticated
  using (public.can_manage_bakery_plans())
  with check (public.can_manage_bakery_plans());

drop policy if exists "bakery_batches_select" on public.bakery_production_batches;
create policy "bakery_batches_select"
  on public.bakery_production_batches for select to authenticated
  using (public.can_access_bakery_module());

drop policy if exists "bakery_batches_write" on public.bakery_production_batches;
create policy "bakery_batches_write"
  on public.bakery_production_batches for insert to authenticated
  with check (public.can_operate_bakery_production());

drop policy if exists "bakery_batches_update" on public.bakery_production_batches;
create policy "bakery_batches_update"
  on public.bakery_production_batches for update to authenticated
  using (public.can_operate_bakery_production())
  with check (public.can_operate_bakery_production());

drop policy if exists "bakery_diary_all" on public.bakery_production_diary_entries;
create policy "bakery_diary_all"
  on public.bakery_production_diary_entries for all to authenticated
  using (public.can_operate_bakery_production())
  with check (public.can_operate_bakery_production());

drop policy if exists "bakery_photos_all" on public.bakery_production_batch_photos;
create policy "bakery_photos_all"
  on public.bakery_production_batch_photos for all to authenticated
  using (public.can_operate_bakery_production())
  with check (public.can_operate_bakery_production());

drop policy if exists "bakery_dough_all" on public.bakery_dough_batches;
create policy "bakery_dough_all"
  on public.bakery_dough_batches for all to authenticated
  using (public.can_operate_bakery_production())
  with check (public.can_operate_bakery_production());

drop policy if exists "bakery_waste_all" on public.bakery_waste_records;
create policy "bakery_waste_all"
  on public.bakery_waste_records for all to authenticated
  using (public.can_operate_bakery_production())
  with check (public.can_operate_bakery_production());

-- ---------------------------------------------------------------------------
-- Batch code generators
-- ---------------------------------------------------------------------------
create or replace function public.next_bakery_production_batch_code(p_product_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := public.bakery_slugify(p_product_name);
  v_day text := to_char(now() at time zone 'America/Guatemala', 'YYYYMMDD');
  v_prefix text := v_slug || '-' || v_day || '-';
  v_next integer;
begin
  select coalesce(max((substring(batch_code from '([0-9]+)$'))::integer), 0) + 1
  into v_next
  from public.bakery_production_batches
  where batch_code like v_prefix || '%';

  return v_prefix || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function public.next_bakery_dough_batch_code(p_dough_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := 'MASA-' || public.bakery_slugify(p_dough_type);
  v_day text := to_char(now() at time zone 'America/Guatemala', 'YYYYMMDD');
  v_prefix text := v_slug || '-' || v_day || '-';
  v_next integer;
begin
  select coalesce(max((substring(batch_code from '([0-9]+)$'))::integer), 0) + 1
  into v_next
  from public.bakery_dough_batches
  where batch_code like v_prefix || '%';

  return v_prefix || lpad(v_next::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: start production from plan (creates batch automatically)
-- ---------------------------------------------------------------------------
create or replace function public.start_bakery_production_from_plan(p_plan_item_id uuid)
returns public.bakery_production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bakery_production_plan_items;
  v_batch public.bakery_production_batches;
  v_recipe_id uuid;
begin
  if not public.can_operate_bakery_production() then
    raise exception 'PERMISSION_DENIED: no autorizado para operar producción de panadería.';
  end if;

  select * into v_plan
  from public.bakery_production_plan_items
  where id = p_plan_item_id
  for update;

  if v_plan.id is null then
    raise exception 'El ítem del plan no existe.';
  end if;
  if v_plan.status not in ('planned', 'in_progress', 'partial') then
    raise exception 'Este ítem del plan no puede iniciar producción (estado: %).', v_plan.status;
  end if;
  if nullif(trim(v_plan.product_name), '') is null then
    raise exception 'No se puede crear lote sin producto.';
  end if;

  if exists (
    select 1 from public.bakery_production_batches b
    where b.plan_item_id = v_plan.id
      and b.status in ('created', 'in_progress')
  ) then
    raise exception 'Ya existe un lote activo para este ítem del plan.';
  end if;

  select sr.id into v_recipe_id
  from public.standard_recipes sr
  where sr.active = true
    and sr.production_area_id in ('panaderia', 'reposteria')
    and lower(trim(sr.name)) = lower(trim(v_plan.product_name))
  order by sr.updated_at desc
  limit 1;

  insert into public.bakery_production_batches (
    batch_code, plan_item_id, inventory_item_id, product_name,
    planned_quantity, unit, responsible_user_id, destination_area_id,
    recipe_id, status, started_at
  )
  values (
    public.next_bakery_production_batch_code(v_plan.product_name),
    v_plan.id,
    v_plan.inventory_item_id,
    v_plan.product_name,
    v_plan.planned_quantity,
    v_plan.unit,
    coalesce(v_plan.assigned_to, auth.uid()),
    v_plan.destination_area_id,
    v_recipe_id,
    'in_progress',
    now()
  )
  returning * into v_batch;

  update public.bakery_production_plan_items
  set status = 'in_progress', updated_at = now()
  where id = v_plan.id;

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: save / update diary entry
-- ---------------------------------------------------------------------------
create or replace function public.save_bakery_diary_entry(p_payload jsonb)
returns public.bakery_production_diary_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.bakery_production_batches;
  v_entry public.bakery_production_diary_entries;
  v_actual numeric := nullif(p_payload ->> 'actual_quantity', '')::numeric;
begin
  if not public.can_operate_bakery_production() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select * into v_batch
  from public.bakery_production_batches
  where id = (p_payload ->> 'batch_id')::uuid
  for update;

  if v_batch.id is null then
    raise exception 'Lote de producción no encontrado.';
  end if;
  if v_batch.status not in ('created', 'in_progress') then
    raise exception 'El lote no está en producción.';
  end if;
  if v_actual is null then
    raise exception 'Indica la cantidad real producida.';
  end if;

  insert into public.bakery_production_diary_entries (
    batch_id, start_time, end_time, ambient_temperature,
    planned_quantity, actual_quantity, recipe_id,
    process_notes, quality_result, issues_detected, created_by
  )
  values (
    v_batch.id,
    nullif(p_payload ->> 'start_time', '')::timestamptz,
    nullif(p_payload ->> 'end_time', '')::timestamptz,
    nullif(p_payload ->> 'ambient_temperature', '')::numeric,
    coalesce(nullif(p_payload ->> 'planned_quantity', '')::numeric, v_batch.planned_quantity),
    v_actual,
    coalesce(nullif(p_payload ->> 'recipe_id', '')::uuid, v_batch.recipe_id),
    nullif(trim(p_payload ->> 'process_notes'), ''),
    nullif(trim(p_payload ->> 'quality_result'), ''),
    nullif(trim(p_payload ->> 'issues_detected'), ''),
    auth.uid()
  )
  on conflict (batch_id) do update
  set
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    ambient_temperature = excluded.ambient_temperature,
    planned_quantity = excluded.planned_quantity,
    actual_quantity = excluded.actual_quantity,
    recipe_id = excluded.recipe_id,
    process_notes = excluded.process_notes,
    quality_result = excluded.quality_result,
    issues_detected = excluded.issues_detected,
    updated_at = now()
  returning * into v_entry;

  update public.bakery_production_batches
  set
    actual_quantity = v_actual,
    status = 'in_progress',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = v_batch.id;

  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: deliver batch (photo required)
-- TODO(inventory): when destination_area_id + inventory_item_id are set,
-- insert production_output into inventory_movements and area_inventory.
-- ---------------------------------------------------------------------------
create or replace function public.deliver_bakery_production_batch(
  p_batch_id uuid,
  p_delivered_quantity numeric,
  p_quality_result text,
  p_photo_url text,
  p_notes text default null
)
returns public.bakery_production_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.bakery_production_batches;
  v_plan public.bakery_production_plan_items;
  v_diary public.bakery_production_diary_entries;
  v_quality text := lower(trim(coalesce(p_quality_result, '')));
  v_qty numeric := coalesce(p_delivered_quantity, 0);
  v_new_status text;
  v_plan_status text;
begin
  if not public.can_operate_bakery_production() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if nullif(trim(coalesce(p_photo_url, '')), '') is null then
    raise exception 'Se requiere foto de entrega para cerrar el lote.';
  end if;
  if v_qty <= 0 then
    raise exception 'La cantidad entregada debe ser mayor que cero.';
  end if;
  if v_quality not in ('good', 'acceptable', 'failed') then
    raise exception 'Indica un resultado de calidad válido.';
  end if;

  select * into v_batch
  from public.bakery_production_batches
  where id = p_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Lote no encontrado.';
  end if;
  if v_batch.status not in ('created', 'in_progress') then
    raise exception 'El lote ya fue entregado o cancelado.';
  end if;

  select * into v_diary
  from public.bakery_production_diary_entries
  where batch_id = v_batch.id;

  if v_diary.id is null or v_diary.actual_quantity is null then
    raise exception 'Completa el diario del panadero con cantidad real antes de entregar.';
  end if;

  insert into public.bakery_production_batch_photos (
    batch_id, photo_url, photo_type, uploaded_by
  )
  values (v_batch.id, trim(p_photo_url), 'delivery', auth.uid());

  v_new_status := case
    when v_qty >= v_batch.planned_quantity then 'delivered'
    else 'partial'
  end;

  update public.bakery_production_batches
  set
    actual_quantity = v_qty,
    status = v_new_status,
    delivered_at = now(),
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where id = v_batch.id
  returning * into v_batch;

  if v_batch.plan_item_id is not null then
    select * into v_plan from public.bakery_production_plan_items where id = v_batch.plan_item_id;
    v_plan_status := case
      when v_new_status = 'delivered' then 'delivered'
      else 'partial'
    end;
    update public.bakery_production_plan_items
    set status = v_plan_status, updated_at = now()
    where id = v_batch.plan_item_id;
  end if;

  -- TODO(inventory): optional inventory_movements production_output here
  -- when v_batch.inventory_item_id and v_batch.destination_area_id are present.

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: dough batch lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.create_bakery_dough_batch(p_payload jsonb)
returns public.bakery_dough_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bakery_dough_batches;
  v_dough_type text := nullif(trim(p_payload ->> 'dough_type'), '');
  v_units numeric := nullif(p_payload ->> 'quantity_units', '')::numeric;
begin
  if not public.can_operate_bakery_production() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_dough_type is null then
    raise exception 'Indica el tipo de masa.';
  end if;
  if coalesce(v_units, 0) <= 0 then
    raise exception 'La cantidad de unidades debe ser mayor que cero.';
  end if;

  insert into public.bakery_dough_batches (
    batch_code, dough_type, recipe_id, quantity_units, unit_weight, total_weight,
    mixed_at, status, responsible_user_id, notes
  )
  values (
    public.next_bakery_dough_batch_code(v_dough_type),
    v_dough_type,
    nullif(p_payload ->> 'recipe_id', '')::uuid,
    v_units,
    nullif(p_payload ->> 'unit_weight', '')::numeric,
    nullif(p_payload ->> 'total_weight', '')::numeric,
    coalesce(nullif(p_payload ->> 'mixed_at', '')::timestamptz, now()),
    coalesce(nullif(trim(p_payload ->> 'status'), ''), 'mixed'),
    coalesce(nullif(p_payload ->> 'responsible_user_id', '')::uuid, auth.uid()),
    nullif(trim(p_payload ->> 'notes'), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_bakery_dough_batch_status(
  p_dough_batch_id uuid,
  p_status text,
  p_notes text default null
)
returns public.bakery_dough_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bakery_dough_batches;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if not public.can_operate_bakery_production() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_status not in ('mixed', 'resting', 'balled', 'cold_room', 'ready', 'used', 'discarded') then
    raise exception 'Estado de masa no válido.';
  end if;

  select * into v_row from public.bakery_dough_batches where id = p_dough_batch_id for update;
  if v_row.id is null then raise exception 'Lote de masa no encontrado.'; end if;

  update public.bakery_dough_batches
  set
    status = v_status,
    cold_room_started_at = case
      when v_status = 'cold_room' and cold_room_started_at is null then now()
      else cold_room_started_at
    end,
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where id = p_dough_batch_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: waste record (photo required)
-- ---------------------------------------------------------------------------
create or replace function public.register_bakery_waste(p_payload jsonb)
returns public.bakery_waste_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bakery_waste_records;
  v_reason text := lower(trim(coalesce(p_payload ->> 'waste_reason', '')));
  v_photo text := nullif(trim(p_payload ->> 'photo_url'), '');
  v_qty numeric := nullif(p_payload ->> 'quantity', '')::numeric;
  v_name text := nullif(trim(p_payload ->> 'product_name'), '');
begin
  if not public.can_operate_bakery_production() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_photo is null then
    raise exception 'Se requiere foto para registrar merma.';
  end if;
  if v_reason not in (
    'burned', 'overfermented', 'expired', 'dropped', 'recipe_error',
    'poor_quality', 'overproduction', 'other'
  ) then
    raise exception 'Indica un motivo de merma válido.';
  end if;
  if coalesce(v_qty, 0) <= 0 then
    raise exception 'La cantidad de merma debe ser mayor que cero.';
  end if;
  if v_name is null then
    raise exception 'Indica el producto o masa afectada.';
  end if;

  insert into public.bakery_waste_records (
    related_batch_id, related_dough_batch_id, inventory_item_id,
    product_name, quantity, unit, waste_reason, notes, photo_url, reported_by
  )
  values (
    nullif(p_payload ->> 'related_batch_id', '')::uuid,
    nullif(p_payload ->> 'related_dough_batch_id', '')::uuid,
    nullif(p_payload ->> 'inventory_item_id', '')::uuid,
    v_name,
    v_qty,
    coalesce(nullif(trim(p_payload ->> 'unit'), ''), 'Unidad'),
    v_reason,
    nullif(trim(p_payload ->> 'notes'), ''),
    v_photo,
    auth.uid()
  )
  returning * into v_row;

  if v_row.related_batch_id is not null then
    insert into public.bakery_production_batch_photos (
      batch_id, photo_url, photo_type, uploaded_by
    )
    values (v_row.related_batch_id, v_photo, 'waste', auth.uid());
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: supervisor dashboard summary
-- ---------------------------------------------------------------------------
create or replace function public.get_bakery_supervisor_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Guatemala')::date;
  v_week_start date := v_today - extract(dow from v_today)::integer;
begin
  if not public.can_access_bakery_module() then
    raise exception 'PERMISSION_DENIED';
  end if;

  return jsonb_build_object(
    'today_plan', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.priority desc, p.required_date), '[]'::jsonb)
      from public.bakery_production_plan_items p
      where p.required_date = v_today
        and p.status in ('planned', 'in_progress', 'partial')
    ),
    'overdue_plan', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.required_date), '[]'::jsonb)
      from public.bakery_production_plan_items p
      where p.required_date < v_today
        and p.status in ('planned', 'in_progress', 'partial')
    ),
    'batches_in_progress', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.started_at desc nulls last), '[]'::jsonb)
      from public.bakery_production_batches b
      where b.status in ('created', 'in_progress')
    ),
    'batches_pending_delivery', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.started_at desc nulls last), '[]'::jsonb)
      from public.bakery_production_batches b
      where b.status = 'in_progress'
        and exists (
          select 1 from public.bakery_production_diary_entries d
          where d.batch_id = b.id and d.actual_quantity is not null
        )
    ),
    'cold_room_dough', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'batch_code', d.batch_code,
          'dough_type', d.dough_type,
          'status', d.status,
          'cold_room_started_at', d.cold_room_started_at,
          'hours_in_cold', round(extract(epoch from (now() - d.cold_room_started_at)) / 3600.0, 1),
          'quantity_units', d.quantity_units
        ) order by d.cold_room_started_at
      ), '[]'::jsonb)
      from public.bakery_dough_batches d
      where d.status in ('cold_room', 'ready')
    ),
    'recent_waste', (
      select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at desc), '[]'::jsonb)
      from (
        select * from public.bakery_waste_records
        order by created_at desc
        limit 10
      ) w
    ),
    'weekly_delivered', (
      select coalesce(sum(b.actual_quantity), 0)
      from public.bakery_production_batches b
      where b.status in ('delivered', 'partial')
        and b.delivered_at >= v_week_start::timestamptz
    )
  );
end;
$$;

revoke all on function
  public.next_bakery_production_batch_code(text),
  public.next_bakery_dough_batch_code(text),
  public.start_bakery_production_from_plan(uuid),
  public.save_bakery_diary_entry(jsonb),
  public.deliver_bakery_production_batch(uuid, numeric, text, text, text),
  public.create_bakery_dough_batch(jsonb),
  public.update_bakery_dough_batch_status(uuid, text, text),
  public.register_bakery_waste(jsonb),
  public.get_bakery_supervisor_dashboard()
from public;

grant execute on function
  public.next_bakery_production_batch_code(text),
  public.next_bakery_dough_batch_code(text),
  public.start_bakery_production_from_plan(uuid),
  public.save_bakery_diary_entry(jsonb),
  public.deliver_bakery_production_batch(uuid, numeric, text, text, text),
  public.create_bakery_dough_batch(jsonb),
  public.update_bakery_dough_batch_status(uuid, text, text),
  public.register_bakery_waste(jsonb),
  public.get_bakery_supervisor_dashboard()
to authenticated;
