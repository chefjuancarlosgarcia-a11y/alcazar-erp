-- Performance: indexes for hot area_inventory lookups.
-- Apply after 104_auth_login_security_sprint2.sql.
-- Note: unique (item_id, area_id) already supports item_id + pair lookups;
-- area_id-only filters (reports, POS by area) benefit from a dedicated index.

create index if not exists area_inventory_area_id_idx
  on public.area_inventory (area_id);

create index if not exists area_inventory_item_id_idx
  on public.area_inventory (item_id);

create index if not exists area_inventory_updated_at_idx
  on public.area_inventory (updated_at desc);

comment on index public.area_inventory_area_id_idx is
  'Speeds stock queries filtered by production/storage area.';
