-- POS catalog performance audit (SQL Editor)
-- Apply after 164 + 165. Run sections manually and save output for the perf report.
--
-- IMAGE STORAGE MODEL (important):
--   - Table: public.pos_products (column image_url = public URL string)
--   - Files: storage bucket "pos-product-images" (storage.buckets / storage.objects)
--   - NO table public.pos_product_images exists — do not query it.

-- ---------------------------------------------------------------------------
-- 0) Schema audit — confirms real object names
-- ---------------------------------------------------------------------------
select public.audit_pos_catalog_schema();

-- Expected:
--   pos_products_table_exists = true
--   pos_product_images_table_exists = false
--   storage_bucket_pos_product_images = [{ "id": "pos-product-images", ... }]

-- Manual fallback if audit_pos_catalog_schema not applied yet:
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'pos_products'
) as pos_products_exists;

select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'pos_product_images'
) as pos_product_images_table_exists;

select id, name, public, file_size_limit
from storage.buckets
where id = 'pos-product-images';

-- ---------------------------------------------------------------------------
-- 1) Health / image audit (uses only public.pos_products.image_url)
-- ---------------------------------------------------------------------------
select diagnose_pos_catalog_health();

select
  (d->>'total_products')::int as total_products,
  (d->>'products_with_inline_image')::int as products_with_inline_image,
  (d->>'products_with_storage_image')::int as products_with_storage_image,
  (d->>'products_with_data_image')::int as products_with_data_image,
  (d->>'max_image_url_bytes')::int as max_image_url_bytes,
  (d->>'avg_image_url_bytes')::int as avg_image_url_bytes
from (select diagnose_pos_catalog_health() d) s;

-- ---------------------------------------------------------------------------
-- 2) EXPLAIN ANALYZE — paginated catalog RPC (target < 300 ms)
--    Depends ONLY on public.pos_products — NOT pos_product_images
-- ---------------------------------------------------------------------------
explain (analyze, buffers, verbose, format text)
select public.list_pos_catalog_page(50, 0, null, null, null);

explain (analyze, buffers, verbose, format text)
select public.list_pos_catalog_page(50, 50, null, null, null);

explain (analyze, buffers, verbose, format text)
select public.list_pos_catalog_page(50, 100, null, null, true);

explain (analyze, buffers, format json)
select public.list_pos_catalog_page(50, 0, null, null, null);

-- ---------------------------------------------------------------------------
-- 3) Count-only baseline (should be fast)
-- ---------------------------------------------------------------------------
explain (analyze, buffers, format text)
select count(*)::int from public.pos_products;

-- ---------------------------------------------------------------------------
-- 4) Verify list RPC does NOT return image_url payload
-- ---------------------------------------------------------------------------
select public.list_pos_catalog_page(5, 0, null, null, null)->'items'->0 as first_item_sample;

select pg_get_functiondef(
  'public.list_pos_catalog_page(integer, integer, text, text, boolean)'::regprocedure
);

-- Confirm: function body must NOT contain "image_url" except "(p.image_url is not null) as has_image"
-- Full image bytes load only via get_pos_product_image_url(uuid) on edit.
