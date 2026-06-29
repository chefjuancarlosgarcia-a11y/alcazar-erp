-- Safe inventory duplicate merge: audit, ignore list, barcode aliases, merge RPC.
-- Apply after 137_inventory_barcodes.sql.

alter table public.inventory_items
  add column if not exists merged_into_item_id uuid references public.inventory_items(id),
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references public.profiles(id);

create index if not exists inventory_items_merged_into_idx
  on public.inventory_items (merged_into_item_id)
  where merged_into_item_id is not null;

comment on column public.inventory_items.merged_into_item_id is
  'If set, this catalog row was merged into the master item and must not be used operationally.';

create table if not exists public.inventory_item_barcode_aliases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  barcode text not null,
  barcode_type text,
  source_item_id uuid references public.inventory_items(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create unique index if not exists inventory_item_barcode_aliases_barcode_unique
  on public.inventory_item_barcode_aliases (lower(trim(barcode)))
  where trim(barcode) <> '';

create index if not exists inventory_item_barcode_aliases_item_idx
  on public.inventory_item_barcode_aliases (item_id);

alter table public.inventory_item_barcode_aliases enable row level security;

grant select on public.inventory_item_barcode_aliases to authenticated;
grant all on public.inventory_item_barcode_aliases to service_role;

drop policy if exists "inventory_item_barcode_aliases_read" on public.inventory_item_barcode_aliases;
create policy "inventory_item_barcode_aliases_read"
  on public.inventory_item_barcode_aliases for select to authenticated
  using (true);

drop policy if exists "inventory_item_barcode_aliases_manage" on public.inventory_item_barcode_aliases;
create policy "inventory_item_barcode_aliases_manage"
  on public.inventory_item_barcode_aliases for all to authenticated
  using (public.is_inventory_manager())
  with check (public.is_inventory_manager());

create table if not exists public.inventory_item_merge_audit (
  id uuid primary key default gen_random_uuid(),
  master_item_id uuid not null references public.inventory_items(id),
  duplicate_item_id uuid not null references public.inventory_items(id),
  merged_by uuid references public.profiles(id),
  merged_at timestamptz not null default now(),
  snapshot_master_before jsonb not null default '{}'::jsonb,
  snapshot_duplicate_before jsonb not null default '{}'::jsonb,
  affected_tables jsonb not null default '{}'::jsonb,
  notes text
);

create index if not exists inventory_item_merge_audit_master_idx
  on public.inventory_item_merge_audit (master_item_id, merged_at desc);

create index if not exists inventory_item_merge_audit_duplicate_idx
  on public.inventory_item_merge_audit (duplicate_item_id);

alter table public.inventory_item_merge_audit enable row level security;

grant select on public.inventory_item_merge_audit to authenticated;
grant all on public.inventory_item_merge_audit to service_role;

drop policy if exists "inventory_item_merge_audit_read" on public.inventory_item_merge_audit;
create policy "inventory_item_merge_audit_read"
  on public.inventory_item_merge_audit for select to authenticated
  using (public.is_inventory_manager());

create table if not exists public.inventory_duplicate_ignore (
  id uuid primary key default gen_random_uuid(),
  item_a_id uuid not null references public.inventory_items(id) on delete cascade,
  item_b_id uuid not null references public.inventory_items(id) on delete cascade,
  ignored_by uuid references public.profiles(id),
  ignored_at timestamptz not null default now(),
  reason text,
  check (item_a_id <> item_b_id)
);

create unique index if not exists inventory_duplicate_ignore_pair_unique
  on public.inventory_duplicate_ignore (item_a_id, item_b_id);

alter table public.inventory_duplicate_ignore enable row level security;

grant select, insert, delete on public.inventory_duplicate_ignore to authenticated;
grant all on public.inventory_duplicate_ignore to service_role;

drop policy if exists "inventory_duplicate_ignore_read" on public.inventory_duplicate_ignore;
create policy "inventory_duplicate_ignore_read"
  on public.inventory_duplicate_ignore for select to authenticated
  using (public.is_inventory_manager());

drop policy if exists "inventory_duplicate_ignore_write" on public.inventory_duplicate_ignore;
create policy "inventory_duplicate_ignore_write"
  on public.inventory_duplicate_ignore for insert to authenticated
  with check (public.is_inventory_manager());

drop policy if exists "inventory_duplicate_ignore_delete" on public.inventory_duplicate_ignore;
create policy "inventory_duplicate_ignore_delete"
  on public.inventory_duplicate_ignore for delete to authenticated
  using (public.is_inventory_manager());

create or replace function public.canonical_duplicate_pair(p_a uuid, p_b uuid)
returns table(item_a_id uuid, item_b_id uuid)
language sql
immutable
set search_path = ''
as $$
  select least(p_a, p_b), greatest(p_a, p_b);
$$;

create or replace function public.is_duplicate_pair_ignored(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.inventory_duplicate_ignore ign
    cross join public.canonical_duplicate_pair(p_a, p_b) pair
    where ign.item_a_id = pair.item_a_id
      and ign.item_b_id = pair.item_b_id
  );
$$;

revoke all on function public.is_duplicate_pair_ignored(uuid, uuid) from public;
grant execute on function public.is_duplicate_pair_ignored(uuid, uuid) to authenticated;

create or replace function public.ignore_inventory_duplicate_pair(
  p_item_a_id uuid,
  p_item_b_id uuid,
  p_reason text default null
)
returns public.inventory_duplicate_ignore
language plpgsql
security definer
set search_path = ''
as $$
declare
  pair record;
  inserted public.inventory_duplicate_ignore;
begin
  if not public.is_inventory_manager() then
    raise exception 'No tienes permiso para ignorar pares de duplicados.';
  end if;

  if p_item_a_id is null or p_item_b_id is null or p_item_a_id = p_item_b_id then
    raise exception 'Par de productos inválido.';
  end if;

  select * into pair from public.canonical_duplicate_pair(p_item_a_id, p_item_b_id);

  insert into public.inventory_duplicate_ignore (item_a_id, item_b_id, ignored_by, reason)
  values (pair.item_a_id, pair.item_b_id, auth.uid(), nullif(trim(p_reason), ''))
  on conflict (item_a_id, item_b_id) do update
    set ignored_by = auth.uid(),
        ignored_at = now(),
        reason = coalesce(excluded.reason, public.inventory_duplicate_ignore.reason)
  returning * into inserted;

  return inserted;
end;
$$;

revoke all on function public.ignore_inventory_duplicate_pair(uuid, uuid, text) from public;
grant execute on function public.ignore_inventory_duplicate_pair(uuid, uuid, text) to authenticated;

create or replace function public.get_inventory_item_usage(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb := '{}'::jsonb;
  v_count integer;
begin
  if p_item_id is null then
    return result;
  end if;

  select count(*) into v_count from public.requisition_items where item_id = p_item_id;
  result := result || jsonb_build_object('requisition_items', v_count);

  select count(*) into v_count from public.recipe_ingredients where inventory_item_id = p_item_id;
  result := result || jsonb_build_object('recipe_ingredients', v_count);

  select count(*) into v_count
  from public.standard_recipes
  where output_inventory_item_id = p_item_id;
  result := result || jsonb_build_object('standard_recipes_output', v_count);

  select count(*) into v_count from public.inventory_movements where item_id = p_item_id;
  result := result || jsonb_build_object('inventory_movements', v_count);

  select count(*) into v_count
  from public.purchase_orders po
  where exists (
    select 1
    from jsonb_array_elements(coalesce(po.data -> 'items', '[]'::jsonb)) elem
    where coalesce(elem ->> 'producto_id', elem ->> 'inventory_item_id', elem ->> 'id') = p_item_id::text
  );
  result := result || jsonb_build_object('purchase_orders', v_count);

  select count(*) into v_count
  from public.production_batch_inputs
  where inventory_item_id = p_item_id;
  result := result || jsonb_build_object('production_batch_inputs', v_count);

  select count(*) into v_count
  from public.production_batch_outputs
  where inventory_item_id = p_item_id;
  result := result || jsonb_build_object('production_batch_outputs', v_count);

  select count(*) into v_count
  from public.production_batches
  where output_inventory_item_id = p_item_id;
  result := result || jsonb_build_object('production_batches', v_count);

  return result;
end;
$$;

revoke all on function public.get_inventory_item_usage(uuid) from public;
grant execute on function public.get_inventory_item_usage(uuid) to authenticated;

create or replace function public.merge_inventory_items(
  p_master_item_id uuid,
  p_duplicate_item_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  master_row public.inventory_items;
  duplicate_row public.inventory_items;
  affected jsonb := '{}'::jsonb;
  v_count integer;
  v_area record;
  v_master_qty numeric;
  v_master_min numeric;
begin
  if not public.is_inventory_manager() then
    raise exception 'No tienes permiso para fusionar productos de inventario.';
  end if;

  if p_master_item_id is null or p_duplicate_item_id is null then
    raise exception 'Debes indicar producto maestro y duplicado.';
  end if;

  if p_master_item_id = p_duplicate_item_id then
    raise exception 'No puedes fusionar un producto consigo mismo.';
  end if;

  select * into master_row
  from public.inventory_items
  where id = p_master_item_id
  for update;

  select * into duplicate_row
  from public.inventory_items
  where id = p_duplicate_item_id
  for update;

  if master_row.id is null then
    raise exception 'El producto maestro no existe.';
  end if;

  if duplicate_row.id is null then
    raise exception 'El producto duplicado no existe.';
  end if;

  if duplicate_row.merged_into_item_id is not null then
    raise exception 'El producto duplicado ya fue fusionado anteriormente.';
  end if;

  if master_row.merged_into_item_id is not null then
    raise exception 'El producto maestro ya fue fusionado en otro producto.';
  end if;

  -- area_inventory: sum stock per area, then remove duplicate rows
  for v_area in
    select area_id, quantity, minimum_quantity
    from public.area_inventory
    where item_id = p_duplicate_item_id
  loop
    select quantity, minimum_quantity
    into v_master_qty, v_master_min
    from public.area_inventory
    where item_id = p_master_item_id and area_id = v_area.area_id;

    if found then
      update public.area_inventory
      set quantity = coalesce(v_master_qty, 0) + coalesce(v_area.quantity, 0),
          minimum_quantity = greatest(coalesce(v_master_min, 0), coalesce(v_area.minimum_quantity, 0)),
          updated_at = now()
      where item_id = p_master_item_id and area_id = v_area.area_id;
    else
      update public.area_inventory
      set item_id = p_master_item_id,
          updated_at = now()
      where item_id = p_duplicate_item_id and area_id = v_area.area_id;
    end if;
  end loop;

  delete from public.area_inventory where item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('area_inventory_deleted', v_count);

  update public.inventory_movements set item_id = p_master_item_id where item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('inventory_movements', v_count);

  update public.requisition_items set item_id = p_master_item_id where item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('requisition_items', v_count);

  -- recipe_ingredients: merge quantities when both appear in the same recipe
  update public.recipe_ingredients ri_master
  set quantity = ri_master.quantity + ri_dup.quantity
  from public.recipe_ingredients ri_dup
  where ri_master.inventory_item_id = p_master_item_id
    and ri_dup.inventory_item_id = p_duplicate_item_id
    and ri_master.recipe_id = ri_dup.recipe_id;

  delete from public.recipe_ingredients ri_dup
  using public.recipe_ingredients ri_master
  where ri_dup.inventory_item_id = p_duplicate_item_id
    and ri_master.inventory_item_id = p_master_item_id
    and ri_dup.recipe_id = ri_master.recipe_id;

  update public.recipe_ingredients
  set inventory_item_id = p_master_item_id
  where inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('recipe_ingredients', v_count);

  update public.standard_recipes
  set output_inventory_item_id = p_master_item_id
  where output_inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('standard_recipes_output', v_count);

  update public.production_batches
  set output_inventory_item_id = p_master_item_id
  where output_inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('production_batches', v_count);

  update public.production_batch_inputs
  set inventory_item_id = p_master_item_id
  where inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('production_batch_inputs', v_count);

  update public.production_batch_outputs
  set inventory_item_id = p_master_item_id
  where inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('production_batch_outputs', v_count);

  update public.yield_audits
  set inventory_item_id = p_master_item_id
  where inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('yield_audits', v_count);

  delete from public.yield_audit_campaign_items yaci_dup
  using public.yield_audit_campaign_items yaci_master
  where yaci_dup.inventory_item_id = p_duplicate_item_id
    and yaci_master.inventory_item_id = p_master_item_id
    and yaci_dup.campaign_id = yaci_master.campaign_id;

  update public.yield_audit_campaign_items
  set inventory_item_id = p_master_item_id
  where inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('yield_audit_campaign_items', v_count);

  if exists (select 1 from public.inventory_yield_profiles where inventory_item_id = p_duplicate_item_id) then
    if exists (select 1 from public.inventory_yield_profiles where inventory_item_id = p_master_item_id) then
      delete from public.inventory_yield_profiles where inventory_item_id = p_duplicate_item_id;
      affected := affected || jsonb_build_object('inventory_yield_profiles', jsonb_build_object('action', 'deleted_duplicate'));
    else
      update public.inventory_yield_profiles
      set inventory_item_id = p_master_item_id
      where inventory_item_id = p_duplicate_item_id;
      affected := affected || jsonb_build_object('inventory_yield_profiles', jsonb_build_object('action', 'repointed'));
    end if;
  end if;

  delete from public.inventory_item_unit_conversions conv_dup
  using public.inventory_item_unit_conversions conv_master
  where conv_dup.inventory_item_id = p_duplicate_item_id
    and conv_master.inventory_item_id = p_master_item_id
    and lower(trim(conv_dup.from_unit)) = lower(trim(conv_master.from_unit))
    and lower(trim(conv_dup.to_unit)) = lower(trim(conv_master.to_unit));

  update public.inventory_item_unit_conversions
  set inventory_item_id = p_master_item_id
  where inventory_item_id = p_duplicate_item_id;
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('inventory_item_unit_conversions', v_count);

  update public.purchase_orders po
  set data = jsonb_set(
    coalesce(po.data, '{}'::jsonb),
    '{items}',
    (
      select coalesce(jsonb_agg(
        case
          when coalesce(elem ->> 'producto_id', elem ->> 'inventory_item_id', elem ->> 'id') = p_duplicate_item_id::text
            then elem
              || jsonb_build_object(
                'producto_id', p_master_item_id,
                'inventory_item_id', p_master_item_id,
                'id', p_master_item_id
              )
          else elem
        end
      ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(po.data -> 'items', '[]'::jsonb)) elem
    ),
    true
  ),
  updated_at = now()
  where exists (
    select 1
    from jsonb_array_elements(coalesce(po.data -> 'items', '[]'::jsonb)) elem
    where coalesce(elem ->> 'producto_id', elem ->> 'inventory_item_id', elem ->> 'id') = p_duplicate_item_id::text
  );
  get diagnostics v_count = row_count;
  affected := affected || jsonb_build_object('purchase_orders', v_count);

  -- Barcodes: move or alias, never lose
  if duplicate_row.barcode is not null and trim(duplicate_row.barcode) <> '' then
    if master_row.barcode is null or trim(master_row.barcode) = '' then
      update public.inventory_items
      set barcode = duplicate_row.barcode,
          barcode_type = coalesce(master_row.barcode_type, duplicate_row.barcode_type),
          barcode_source = coalesce(master_row.barcode_source, duplicate_row.barcode_source),
          barcode_created_at = coalesce(master_row.barcode_created_at, duplicate_row.barcode_created_at)
      where id = p_master_item_id;
      select * into master_row from public.inventory_items where id = p_master_item_id;
    elsif lower(trim(master_row.barcode)) <> lower(trim(duplicate_row.barcode)) then
      insert into public.inventory_item_barcode_aliases (item_id, barcode, barcode_type, source_item_id, created_by)
      values (
        p_master_item_id,
        duplicate_row.barcode,
        duplicate_row.barcode_type,
        p_duplicate_item_id,
        auth.uid()
      )
      on conflict do nothing;
      affected := affected || jsonb_build_object('barcode_alias_created', duplicate_row.barcode);
    end if;
  end if;

  -- Photo: use duplicate if master lacks one
  if (master_row.image_url is null or trim(master_row.image_url) = '')
     and duplicate_row.image_url is not null
     and trim(duplicate_row.image_url) <> '' then
    update public.inventory_items set image_url = duplicate_row.image_url where id = p_master_item_id;
    select * into master_row from public.inventory_items where id = p_master_item_id;
    affected := affected || jsonb_build_object('image_moved_from_duplicate', true);
  end if;

  -- SKU: keep master; store duplicate SKU in notes if different and master empty
  if (master_row.sku is null or trim(master_row.sku) = '')
     and duplicate_row.sku is not null
     and trim(duplicate_row.sku) <> '' then
    update public.inventory_items set sku = duplicate_row.sku where id = p_master_item_id;
    select * into master_row from public.inventory_items where id = p_master_item_id;
  elsif duplicate_row.sku is not null
    and trim(duplicate_row.sku) <> ''
    and coalesce(lower(trim(master_row.sku)), '') <> lower(trim(duplicate_row.sku)) then
    update public.inventory_items
    set notes = trim(both from coalesce(master_row.notes, '') || E'\nSKU fusionado: ' || duplicate_row.sku)
    where id = p_master_item_id;
  end if;

  update public.inventory_items
  set active = false,
      merged_into_item_id = p_master_item_id,
      merged_at = now(),
      merged_by = auth.uid(),
      barcode = null,
      sku = null,
      updated_at = now()
  where id = p_duplicate_item_id;

  insert into public.inventory_item_merge_audit (
    master_item_id,
    duplicate_item_id,
    merged_by,
    snapshot_master_before,
    snapshot_duplicate_before,
    affected_tables,
    notes
  )
  values (
    p_master_item_id,
    p_duplicate_item_id,
    auth.uid(),
    to_jsonb(master_row),
    to_jsonb(duplicate_row),
    affected,
    nullif(trim(p_notes), '')
  );

  perform public.refresh_inventory_item_costing(p_master_item_id);

  return jsonb_build_object(
    'ok', true,
    'master_item_id', p_master_item_id,
    'duplicate_item_id', p_duplicate_item_id,
    'affected_tables', affected
  );
exception
  when others then
    raise exception 'Merge fallido: %', sqlerrm;
end;
$$;

revoke all on function public.merge_inventory_items(uuid, uuid, text) from public;
grant execute on function public.merge_inventory_items(uuid, uuid, text) to authenticated;
