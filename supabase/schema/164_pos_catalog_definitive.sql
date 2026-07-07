-- Definitive POS catalog: paginated list without heavy columns, diagnostics, indexes.
-- Apply after 161_pos_configurable_products.sql (162 save suppression recommended).

-- ---------------------------------------------------------------------------
-- Indexes for list/filter/search
-- ---------------------------------------------------------------------------
create index if not exists pos_products_created_at_desc_idx
  on public.pos_products (created_at desc);

create index if not exists pos_products_name_idx
  on public.pos_products (name);

create index if not exists pos_products_category_active_idx
  on public.pos_products (category_id, active);

create index if not exists pos_products_active_sort_idx
  on public.pos_products (active, sort_order, name);

-- ---------------------------------------------------------------------------
-- Diagnostics (run in SQL Editor: select diagnose_pos_catalog_health();)
-- ---------------------------------------------------------------------------
create or replace function public.diagnose_pos_catalog_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_products', (select count(*)::int from public.pos_products),
    'active_products', (select count(*)::int from public.pos_products where active = true),
    'products_with_inline_image', (
      select count(*)::int from public.pos_products where image_url like 'data:%'
    ),
    'max_image_url_bytes', (
      select coalesce(max(length(coalesce(image_url, ''))), 0)::int from public.pos_products
    ),
    'avg_heavy_column_bytes', (
      select coalesce(avg(
        length(coalesce(name, ''))
        + length(coalesce(description, ''))
        + length(coalesce(image_url, ''))
      ), 0)::int
      from public.pos_products
    ),
    'recent_products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'active', r.active,
        'product_type', r.product_type,
        'created_at', r.created_at,
        'image_url_bytes', length(coalesce(r.image_url, '')),
        'has_base64_image', r.image_url like 'data:%'
      ) order by r.created_at desc), '[]'::jsonb)
      from (
        select id, name, active, product_type, created_at, image_url
        from public.pos_products
        order by created_at desc
        limit 20
      ) r
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', indexname,
        'definition', indexdef
      ) order by indexname), '[]'::jsonb)
      from pg_indexes
      where schemaname = 'public' and tablename = 'pos_products'
    ),
    'rls_policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', policyname,
        'cmd', cmd,
        'roles', roles
      ) order by policyname), '[]'::jsonb)
      from pg_policies
      where schemaname = 'public' and tablename = 'pos_products'
    ),
    'triggers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', trigger_name,
        'timing', action_timing,
        'event', event_manipulation
      ) order by trigger_name), '[]'::jsonb)
      from information_schema.triggers
      where event_object_schema = 'public' and event_object_table = 'pos_products'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Paginated catalog list — NO image_url, NO description (prevents timeout)
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
      (p.image_url is not null and btrim(p.image_url) <> '') as has_image,
      case when p.image_url like 'data:%' then length(p.image_url) else null end as image_inline_bytes
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

-- ---------------------------------------------------------------------------
-- Post-save verification
-- ---------------------------------------------------------------------------
create or replace function public.verify_pos_product_exists(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_id is null then jsonb_build_object('ok', false, 'reason', 'missing_id')
    when exists (select 1 from public.pos_products where id = p_id) then
      jsonb_build_object(
        'ok', true,
        'id', p_id,
        'name', (select name from public.pos_products where id = p_id limit 1),
        'active', (select active from public.pos_products where id = p_id limit 1)
      )
    else jsonb_build_object('ok', false, 'id', p_id, 'reason', 'not_found')
  end;
$$;

-- ---------------------------------------------------------------------------
-- Lazy image load (only when editing/displaying one product)
-- ---------------------------------------------------------------------------
create or replace function public.get_pos_product_image_url(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select image_url from public.pos_products where id = p_id limit 1;
$$;

-- Replace heavy list_pos_catalog_products (select *) with paginated API above.
drop function if exists public.list_pos_catalog_products();

revoke all on function public.diagnose_pos_catalog_health() from public;
revoke all on function public.list_pos_catalog_page(integer, integer, text, text, boolean) from public;
revoke all on function public.verify_pos_product_exists(uuid) from public;
revoke all on function public.get_pos_product_image_url(uuid) from public;

grant execute on function public.diagnose_pos_catalog_health() to authenticated;
grant execute on function public.list_pos_catalog_page(integer, integer, text, text, boolean) to authenticated;
grant execute on function public.verify_pos_product_exists(uuid) to authenticated;
grant execute on function public.get_pos_product_image_url(uuid) to authenticated;
