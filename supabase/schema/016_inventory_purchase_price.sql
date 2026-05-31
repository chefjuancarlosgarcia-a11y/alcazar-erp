-- Purchase price for the complete supplier unit.
-- Apply after 015_warehouse_manager_role.sql.

alter table public.inventory_items
  add column if not exists purchase_price numeric;

alter table public.inventory_items
  drop constraint if exists inventory_items_purchase_price_check;

alter table public.inventory_items
  add constraint inventory_items_purchase_price_check
  check (purchase_price is null or purchase_price >= 0);

-- Existing products intentionally retain a null purchase_price and their
-- recorded cost_per_base_unit until a supplier purchase price is provided.
-- The inventory importer is replaced by 017_inventory_initial_stock_warehouse_only.sql.
