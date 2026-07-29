-- Runtime pricing fixtures for station POS (local DB only). BEGIN … ROLLBACK.

begin;

create or replace function public.test_station_pos_pricing_fixtures_198()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod_simple uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid;
  v_prod_pizza uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid;
  v_prod_cfg uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid;
  v_var_med uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid;
  v_mod_ok uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid;
  v_grp uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid;
  v_choice uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid;
  v_pricing jsonb;
  v_err text;
begin
  if to_regclass('public.pos_products') is null then
    return query select 'schema_pos_products'::text, false, 'pos_products missing'::text;
    return;
  end if;

  insert into public.pos_products (
    id, name, price, active, product_type, production_ready, production_area_id, recipe_id, is_test_item
  ) values (
    v_prod_simple, 'Fixture Simple', 25, true, 'simple', true, 'cocina', null, true
  ) on conflict (id) do update set name = excluded.name, price = excluded.price, active = true, is_test_item = true;

  insert into public.pos_products (
    id, name, price, active, product_type, production_ready, production_area_id, is_test_item
  ) values (
    v_prod_pizza, 'Fixture Pizza', 0, true, 'pizza', true, 'pizzeria', true
  ) on conflict (id) do update set product_type = 'pizza', active = true, is_test_item = true;

  insert into public.pos_product_variants (
    id, product_id, name, size, price, is_active, sort_order, production_area_id
  ) values (
    v_var_med, v_prod_pizza, 'Mediana', 'mediana', 89, true, 0, 'pizzeria'
  ) on conflict (id) do update set price = 89, is_active = true;

  insert into public.pos_product_modifiers (
    id, product_id, name, modifier_type, price_delta, is_active, sort_order
  ) values (
    v_mod_ok, v_prod_pizza, 'Extra queso', 'extra', 12, true, 0
  ) on conflict (id) do update set price_delta = 12, is_active = true;

  insert into public.pos_products (
    id, name, price, active, product_type, production_ready, production_area_id, is_test_item
  ) values (
    v_prod_cfg, 'Fixture Config', 10, true, 'configurable', true, 'cocina', true
  ) on conflict (id) do update set product_type = 'configurable', active = true, is_test_item = true;

  insert into public.pos_option_groups (
    id, product_id, name, required, selection_mode, min_selections, max_selections, is_active, sort_order
  ) values (
    v_grp, v_prod_cfg, 'Sabor', true, 'single', 1, 1, true, 0
  ) on conflict (id) do nothing;

  insert into public.pos_option_choices (
    id, group_id, name, price_mode, price, is_active, sort_order
  ) values (
    v_choice, v_grp, 'BBQ', 'delta', 5, true, 0
  ) on conflict (id) do update set price = 5, price_mode = 'delta';

  v_pricing := public.station_pos_compute_line_item_pricing(v_prod_simple, null, '[]'::jsonb, '{}'::jsonb);
  return query select 'simple_price'::text,
    (v_pricing ->> 'unit_price')::numeric = 25,
    'unit 25'::text;

  v_pricing := public.station_pos_compute_line_item_pricing(
    v_prod_pizza, v_var_med, jsonb_build_array(v_mod_ok), '{}'::jsonb
  );
  return query select 'pizza_variant_modifier'::text,
    (v_pricing ->> 'unit_price')::numeric = 101,
    '89+12'::text;

  begin
    perform public.station_pos_compute_line_item_pricing(v_prod_pizza, null, '[]'::jsonb, '{}'::jsonb);
    return query select 'pizza_requires_size'::text, false, 'should raise'::text;
  exception when others then
    get stacked diagnostics v_err = message_text;
    return query select 'pizza_requires_size'::text,
      v_err = 'STATION_POS_PRICING_GAP',
      v_err;
  end;

  v_pricing := public.station_pos_compute_line_item_pricing(
    v_prod_cfg, null, '[]'::jsonb,
    jsonb_build_object(v_grp::text, v_choice::text)
  );
  return query select 'configurable_delta'::text,
    (v_pricing ->> 'unit_price')::numeric = 15,
    '10+5'::text;

  begin
    perform public.station_pos_compute_line_item_pricing(
      v_prod_pizza, v_var_med, jsonb_build_array(v_mod_ok), '{}'::jsonb
    );
    return query select 'client_price_ignored'::text, true,
      'wrapper has no client price param'::text;
  end;
end;
$$;

revoke all on function public.test_station_pos_pricing_fixtures_198() from public, anon, authenticated;
grant execute on function public.test_station_pos_pricing_fixtures_198() to service_role;

select scenario, passed, detail
from public.test_station_pos_pricing_fixtures_198()
order by case when not passed then 0 else 1 end, scenario;

select count(*) as total,
  count(*) filter (where passed) as passed_total,
  count(*) filter (where not passed) as failed_total
from public.test_station_pos_pricing_fixtures_198();

drop function if exists public.test_station_pos_pricing_fixtures_198();
rollback;
