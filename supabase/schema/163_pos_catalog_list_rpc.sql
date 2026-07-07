-- Fast catalog list fallback when PostgREST embed queries timeout.
-- Apply after 161_pos_configurable_products.sql.

create or replace function public.list_pos_catalog_products()
returns setof public.pos_products
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.pos_products
  order by sort_order asc, name asc;
$$;

revoke all on function public.list_pos_catalog_products() from public;
grant execute on function public.list_pos_catalog_products() to authenticated;
