-- Inventory category admin helpers.
-- Apply after 134_inventory_categories.sql.

create or replace function public.get_inventory_category_product_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb := '{}'::jsonb;
begin
  if not public.is_inventory_manager() then
    raise exception 'No autorizado para consultar uso de categorías de inventario';
  end if;

  select coalesce(
    jsonb_object_agg(bucket.normalized_name, bucket.product_count),
    '{}'::jsonb
  )
  into result
  from (
    select
      lower(trim(translate(coalesce(ii.category, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) as normalized_name,
      count(*)::bigint as product_count
    from public.inventory_items ii
    where nullif(trim(ii.category), '') is not null
    group by 1
  ) bucket
  where bucket.normalized_name <> '';

  return result;
end;
$$;

revoke all on function public.get_inventory_category_product_counts() from public;
grant execute on function public.get_inventory_category_product_counts() to authenticated;

create or replace function public.touch_inventory_categories_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists inventory_categories_set_updated_at on public.inventory_categories;
create trigger inventory_categories_set_updated_at
  before update on public.inventory_categories
  for each row
  execute function public.touch_inventory_categories_updated_at();
