-- Fix catalog list + schema audit: POS images use pos_products.image_url + Storage bucket.
-- There is NO public.pos_product_images table.
-- Apply after 164_pos_catalog_definitive.sql (165 recommended for Storage bucket).

-- ---------------------------------------------------------------------------
-- Schema audit helper (safe — no dependency on pos_product_images table)
-- ---------------------------------------------------------------------------
create or replace function public.audit_pos_catalog_schema()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'image_storage_model', 'pos_products.image_url text + storage bucket pos-product-images (no pos_product_images table)',
    'pos_products_table_exists', exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'pos_products'
    ),
    'pos_product_images_table_exists', exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'pos_product_images'
    ),
    'pos_products_has_image_url_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pos_products' and column_name = 'image_url'
    ),
    'storage_bucket_pos_product_images', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'public', b.public,
        'file_size_limit', b.file_size_limit
      )), '[]'::jsonb)
      from storage.buckets b
      where b.id = 'pos-product-images'
    ),
    'list_rpc_exists', exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'list_pos_catalog_page'
    ),
    'get_image_rpc_exists', exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_pos_product_image_url'
    )
  );
$$;

revoke all on function public.audit_pos_catalog_schema() from public;
grant execute on function public.audit_pos_catalog_schema() to authenticated;

-- ---------------------------------------------------------------------------
-- list_pos_catalog_page — do NOT read image_url content (no length/like/btrim)
-- Only cheap NULL check for has_image flag.
-- ---------------------------------------------------------------------------
create or replace function public.list_pos_catalog_page(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_category_id text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total integer;
  v_items jsonb;
begin
  select count(*)::integer into v_total
  from public.pos_products p
  where (v_search is null or p.name ilike '%' || v_search || '%' or coalesce(p.category_name, '') ilike '%' || v_search || '%')
    and (p_category_id is null or p.category_id = p_category_id)
    and (p_active is null or p.active = p_active);

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sort_order asc, row_data.name asc), '[]'::jsonb)
  into v_items
  from (
    select
      p.id,
      p.name,
      p.price,
      p.category_id,
      p.category_name,
      p.recipe_id,
      p.production_area_id,
      p.active,
      p.production_ready,
      p.sort_order,
      p.product_type,
      p.is_test_item,
      p.inventory_tracking_enabled,
      p.recipe_required_for_sale,
      p.recipe_status,
      p.allow_kitchen_notes,
      p.prep_time_minutes,
      p.created_at,
      p.updated_at,
      (p.image_url is not null) as has_image
    from public.pos_products p
    where (v_search is null or p.name ilike '%' || v_search || '%' or coalesce(p.category_name, '') ilike '%' || v_search || '%')
      and (p_category_id is null or p.category_id = p_category_id)
      and (p_active is null or p.active = p_active)
    order by p.sort_order asc, p.name asc
    limit v_limit offset v_offset
  ) row_data;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
end;
$$;
