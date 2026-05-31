-- Warehouse manager role with operational inventory permissions.
-- Apply after 014_pos_service_actions.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin', 'gerente_general', 'gerente', 'encargado_almacen', 'rrhh', 'supervisor',
    'cajero', 'mesero', 'cocinero', 'pizzero', 'barista', 'bartender',
    'repostero', 'panadero', 'colaborador'
  ));

create or replace function public.is_inventory_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'gerente_general', 'encargado_almacen')
      and status = 'active'
  );
$$;

revoke all on function public.is_inventory_manager() from public;
grant execute on function public.is_inventory_manager() to authenticated;

drop policy if exists "inventory_items_managers_read_all" on public.inventory_items;
create policy "inventory_items_managers_read_all"
  on public.inventory_items for select to authenticated
  using (public.is_inventory_manager());

drop policy if exists "inventory_items_managers_insert" on public.inventory_items;
create policy "inventory_items_managers_insert"
  on public.inventory_items for insert to authenticated
  with check (public.is_inventory_manager());

drop policy if exists "inventory_items_managers_update" on public.inventory_items;
create policy "inventory_items_managers_update"
  on public.inventory_items for update to authenticated
  using (public.is_inventory_manager())
  with check (public.is_inventory_manager());

drop policy if exists "area_inventory_managers_insert" on public.area_inventory;
create policy "area_inventory_managers_insert"
  on public.area_inventory for insert to authenticated
  with check (public.is_inventory_manager());

drop policy if exists "area_inventory_managers_update" on public.area_inventory;
create policy "area_inventory_managers_update"
  on public.area_inventory for update to authenticated
  using (public.is_inventory_manager())
  with check (public.is_inventory_manager());

drop policy if exists "inventory_movements_managers_insert" on public.inventory_movements;
create policy "inventory_movements_managers_insert"
  on public.inventory_movements for insert to authenticated
  with check (public.is_inventory_manager());

drop policy if exists "inventory_images_managers_insert" on storage.objects;
create policy "inventory_images_managers_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'inventory-images'
    and public.is_inventory_manager()
  );

drop policy if exists "inventory_images_managers_update" on storage.objects;
create policy "inventory_images_managers_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'inventory-images'
    and public.is_inventory_manager()
  )
  with check (
    bucket_id = 'inventory-images'
    and public.is_inventory_manager()
  );

drop policy if exists "inventory_images_managers_delete" on storage.objects;
create policy "inventory_images_managers_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'inventory-images'
    and public.is_inventory_manager()
  );

-- Keep the latest function bodies and replace only their inventory permission check.
do $$
declare
  function_name regprocedure;
  definition text;
begin
  foreach function_name in array array[
    'public.adjust_area_inventory(uuid,text,numeric,numeric,text,text)'::regprocedure,
    'public.import_area_inventory_stock(uuid,text,numeric,numeric,text)'::regprocedure,
    'public.import_inventory_rows(jsonb)'::regprocedure
  ]
  loop
    definition := pg_get_functiondef(function_name);
    definition := replace(definition, 'public.is_profile_manager()', 'public.is_inventory_manager()');
    execute definition;
  end loop;
end;
$$;
