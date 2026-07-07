-- POS catalog performance audit (SQL Editor)
-- Apply after 164 + 165. Run sections manually and save output for the perf report.

-- ---------------------------------------------------------------------------
-- 1) Health / image audit
-- ---------------------------------------------------------------------------
select diagnose_pos_catalog_health();

select
  (diagnose_pos_catalog_health()->>'products_with_inline_image')::int as products_with_inline_image,
  (diagnose_pos_catalog_health()->>'products_with_storage_image')::int as products_with_storage_image,
  (diagnose_pos_catalog_health()->>'products_with_data_image')::int as products_with_data_image,
  (diagnose_pos_catalog_health()->>'max_image_url_bytes')::int as max_image_url_bytes,
  (diagnose_pos_catalog_health()->>'avg_image_url_bytes')::int as avg_image_url_bytes,
  (diagnose_pos_catalog_health()->>'total_products')::int as total_products;

-- ---------------------------------------------------------------------------
-- 2) EXPLAIN ANALYZE — paginated catalog RPC (target < 300 ms)
-- ---------------------------------------------------------------------------
explain (analyze, buffers, verbose, format text)
select public.list_pos_catalog_page(50, 0, null, null, null);

explain (analyze, buffers, verbose, format text)
select public.list_pos_catalog_page(50, 50, null, null, null);

explain (analyze, buffers, verbose, format text)
select public.list_pos_catalog_page(50, 100, null, null, true);

-- JSON plan (copy into report)
explain (analyze, buffers, format json)
select public.list_pos_catalog_page(50, 0, null, null, null);

-- ---------------------------------------------------------------------------
-- 3) Count-only baseline (should be fast)
-- ---------------------------------------------------------------------------
explain (analyze, buffers, format text)
select count(*)::int from public.pos_products;

-- ---------------------------------------------------------------------------
-- 4) Verify list query does NOT read image_url column
-- ---------------------------------------------------------------------------
-- Inspect function body:
select pg_get_functiondef('public.list_pos_catalog_page(integer, integer, text, text, boolean)'::regprocedure);
