-- Fix inventory manager detection for RLS (read/write inventory catalog).
-- Apply after 135_inventory_categories_admin.sql.
--
-- Symptom: admin sees inventory items (including inactive) but gerente_general /
-- encargado_almacen users do not, even though the UI treats them as managers.
-- Root cause: is_inventory_manager() used raw profiles.role while the app normalizes
-- role aliases via normalize_profile_role().

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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'encargado_almacen')
      and status = 'active'
  );
$$;

revoke all on function public.is_inventory_manager() from public;
grant execute on function public.is_inventory_manager() to authenticated;

-- Ensure read policies remain paired: active rows for everyone, all rows for managers.
drop policy if exists "inventory_items_read_active" on public.inventory_items;
create policy "inventory_items_read_active"
  on public.inventory_items for select to authenticated
  using (active = true);

drop policy if exists "inventory_items_managers_read_all" on public.inventory_items;
create policy "inventory_items_managers_read_all"
  on public.inventory_items for select to authenticated
  using (public.is_inventory_manager());

-- Diagnostic (manual):
-- select id, email, role, status,
--   public.normalize_profile_role(role) as role_normalizado
-- from public.profiles
-- where email ilike '%claudia%' or role in ('gerente_general', 'encargado_almacen');
--
-- select id, name, active, sku, category, updated_at
-- from public.inventory_items
-- where name ilike '%tomate%cherry%' or name ilike '%tomate cherry%';
