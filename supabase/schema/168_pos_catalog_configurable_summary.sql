-- ---------------------------------------------------------------------------
-- Catálogo POS: resumen de decisiones activas en listado paginado
-- El diagnóstico client-side no debe revalidar con option_groups=[] cuando
-- production_ready ya fue calculado por pos_configurable_catalog_is_valid().
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
      (p.image_url is not null) as has_image,
      (
        select count(*)::integer
        from public.pos_option_groups g
        where g.product_id = p.id
          and g.is_active = true
      ) as active_option_groups_count
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
