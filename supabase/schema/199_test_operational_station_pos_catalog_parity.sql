-- Runtime parity lab for migration 199 (BEGIN … ROLLBACK). Isolated fixture prefix cc199-*.
-- Reproduces exact P0001 root cause from remote smoke: owner mismatch on add_item path.

begin;

create or replace function public.test_operational_station_pos_catalog_parity_199()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_a uuid;
  v_owner_b uuid;
  v_order_open uuid := '19900000-0000-4000-8000-000000000010'::uuid;
  v_order_closed uuid := '19900000-0000-4000-8000-000000000011'::uuid;
  v_table_id text := 'cc199-lab-m1';
  v_prod_simple uuid := '19900000-0000-4000-8000-000000000020'::uuid;
  v_prod_pizza uuid := '19900000-0000-4000-8000-000000000021'::uuid;
  v_var_med uuid := '19900000-0000-4000-8000-000000000022'::uuid;
  v_mod uuid := '19900000-0000-4000-8000-000000000023'::uuid;
  v_pricing jsonb;
  v_err text;
  v_catalog_def text;
begin
  -- Static: catalog batch fields present (no N+1 RPC)
  v_catalog_def := pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure);
  return query select 'catalog_batch_image_url'::text,
    position('''image_url''' in v_catalog_def) > 0
      and position('get_pos_product_image_url' in v_catalog_def) = 0,
    'single RPC includes image_url; no per-product image RPC'::text;

  return query select 'catalog_batch_production_area_name'::text,
    position('production_area_name' in v_catalog_def) > 0
      and position('left join public.areas' in v_catalog_def) > 0,
    'area name joined in catalog query'::text;

  return query select 'assert_owner_error_code'::text,
    position('STATION_POS_ORDER_OWNER_MISMATCH' in pg_get_functiondef(
      'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure
    )) > 0,
    'function station_pos_assert_order_open_for_drafts; block owner check'::text;

  return query select 'assert_not_open_error_code'::text,
    position('STATION_POS_ORDER_NOT_OPEN' in pg_get_functiondef(
      'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure
    )) > 0,
    'function station_pos_assert_order_open_for_drafts; status <> open'::text;

  if to_regclass('public.pos_orders') is null or to_regclass('public.profiles') is null then
    return query select 'schema_pos_tables'::text, false, 'pos_orders/profiles missing'::text;
    return;
  end if;

  select p.id into v_owner_a
  from public.profiles p
  where p.status = 'active'
  order by p.created_at
  limit 1;

  if v_owner_a is null then
    v_owner_a := '19900000-0000-4000-8000-000000000001'::uuid;
    perform set_config('session_replication_role', 'replica', true);
    insert into auth.users (id, email)
    values (v_owner_a, 'cc199-owner-a@lab.local')
    on conflict (id) do nothing;
    insert into public.profiles (id, email, username, full_name, role, status)
    values (v_owner_a, 'cc199-owner-a@lab.local', 'cc199-owner-a', 'CC199 Owner A', 'mesero', 'active')
    on conflict (id) do update set status = 'active', role = 'mesero';
    perform set_config('session_replication_role', 'origin', true);
  end if;

  v_owner_b := gen_random_uuid();
  while v_owner_b = v_owner_a loop
    v_owner_b := gen_random_uuid();
  end loop;

  return query select 'lab_fixture_profile'::text, v_owner_a is not null,
    format('owner_a=%s owner_b=%s', v_owner_a, v_owner_b)::text;

  update public.app_settings
  set value = jsonb_build_object('enabled', true, 'updated_at', now()),
      updated_at = now()
  where key in ('operational_stations_enabled', 'operational_station_pos_enabled');

  return query select 'lab_flags_enabled'::text,
    public.operational_stations_enabled() and public.operational_station_pos_enabled(),
    'flags true inside lab transaction only'::text;

  insert into public.pos_orders (
    id, table_id, table_name, area_id, area_name, sales_channel,
    waiter_id, waiter_name, owner_profile_id, status
  ) values
    (v_order_open, v_table_id, 'Mesa cc199-lab-m1', 'cc199-zone', 'CC199 Lab', 'dine_in',
     v_owner_a, 'CC199 Owner A', v_owner_a, 'open'),
    (v_order_closed, v_table_id || '-closed', 'Mesa cc199-closed', 'cc199-zone', 'CC199 Lab', 'dine_in',
     v_owner_a, 'CC199 Owner A', v_owner_a, 'paid')
  on conflict (id) do update
  set status = excluded.status,
      owner_profile_id = excluded.owner_profile_id,
      table_id = excluded.table_id;

  -- Scenario 8/9 remote P0001 reproduction: add_item path → assert owner
  begin
    perform public.station_pos_assert_order_open_for_drafts(v_order_open, v_owner_b);
    return query select 'remote_p0001_owner_mismatch_repro'::text, false,
      'expected STATION_POS_ORDER_OWNER_MISMATCH'::text;
  exception
    when others then
      v_err := sqlerrm;
      return query select 'remote_p0001_owner_mismatch_repro'::text,
        v_err = 'STATION_POS_ORDER_OWNER_MISMATCH',
        format(
          'function=station_pos_assert_order_open_for_drafts; condition=NOT station_pos_is_order_owner; '
          || 'order_id=%s owner_profile_id=%s operator_profile_id=%s sqlerrm=%s',
          v_order_open, v_owner_a, v_owner_b, v_err
        )::text;
  end;

  -- Same owner reuse must pass assert (scenario 8)
  begin
    perform public.station_pos_assert_order_open_for_drafts(v_order_open, v_owner_a);
    return query select 'same_owner_reuse_assert'::text, true,
      format('order_id=%s operator_profile_id=%s', v_order_open, v_owner_a)::text;
  exception
    when others then
      return query select 'same_owner_reuse_assert'::text, false, sqlerrm::text;
  end;

  -- Order not open (scenario 10)
  begin
    perform public.station_pos_assert_order_open_for_drafts(v_order_closed, v_owner_a);
    return query select 'order_not_open_blocked'::text, false, 'expected STATION_POS_ORDER_NOT_OPEN'::text;
  exception
    when others then
      return query select 'order_not_open_blocked'::text,
        sqlerrm = 'STATION_POS_ORDER_NOT_OPEN',
        format('function=station_pos_assert_order_open_for_drafts; status=paid; sqlerrm=%s', sqlerrm)::text;
  end;

  -- Product fixtures for pricing (scenarios 7, 13–15)
  insert into public.pos_products (
    id, name, price, active, product_type, production_ready, production_area_id, is_test_item, image_url
  ) values (
    v_prod_simple, 'CC199 Simple', 30, true, 'simple', true, 'cocina', true,
    'https://example.test/cc199-simple.jpg'
  ) on conflict (id) do update
  set price = 30, active = true, image_url = excluded.image_url, is_test_item = true;

  insert into public.pos_products (
    id, name, price, active, product_type, production_ready, production_area_id, is_test_item
  ) values (
    v_prod_pizza, 'CC199 Pizza', 0, true, 'pizza', true, 'pizzeria', true
  ) on conflict (id) do update set product_type = 'pizza', active = true, is_test_item = true;

  insert into public.pos_product_variants (
    id, product_id, name, size, price, is_active, sort_order, production_area_id
  ) values (
    v_var_med, v_prod_pizza, 'Mediana', 'mediana', 90, true, 0, 'pizzeria'
  ) on conflict (id) do update set price = 90, is_active = true;

  insert into public.pos_product_modifiers (
    id, product_id, name, modifier_type, price_delta, is_active, sort_order
  ) values (
    v_mod, v_prod_pizza, 'Extra queso', 'extra', 10, true, 0
  ) on conflict (id) do update set price_delta = 10, is_active = true;

  v_pricing := public.station_pos_compute_line_item_pricing(v_prod_simple, null, '[]'::jsonb, '{}'::jsonb);
  return query select 'add_simple_product_pricing'::text,
    (v_pricing ->> 'unit_price')::numeric = 30,
    format('product_id=%s unit_price=30', v_prod_simple)::text;

  begin
    perform public.station_pos_compute_line_item_pricing(v_prod_pizza, null, '[]'::jsonb, '{}'::jsonb);
    return query select 'pizza_requires_variant'::text, false, 'expected STATION_POS_PRICING_GAP'::text;
  exception
    when others then
      return query select 'pizza_requires_variant'::text,
        sqlerrm = 'STATION_POS_PRICING_GAP',
        format('function=station_pos_compute_line_item_pricing; product_type=pizza; variant_id=null; sqlerrm=%s', sqlerrm)::text;
  end;

  v_pricing := public.station_pos_compute_line_item_pricing(
    v_prod_pizza, v_var_med, jsonb_build_array(v_mod), '{}'::jsonb
  );
  return query select 'pizza_variant_modifiers_pricing'::text,
    (v_pricing ->> 'unit_price')::numeric = 100,
    '90+10'::text;

  return query select 'open_reuse_owner_guard_present'::text,
    (
      select count(*) >= 2
      from regexp_matches(
        pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure),
        'STATION_POS_ORDER_OWNER_MISMATCH',
        'g'
      ) m
    ),
    'open_station_pos_table_service blocks foreign owner on reuse'::text;
end;
$$;

revoke all on function public.test_operational_station_pos_catalog_parity_199() from public, anon, authenticated;
grant execute on function public.test_operational_station_pos_catalog_parity_199() to service_role;

select scenario, passed, detail
from public.test_operational_station_pos_catalog_parity_199()
order by passed asc, scenario asc;

select
  count(*) as total,
  count(*) filter (where passed) as passed_total,
  count(*) filter (where not passed) as failed_total
from public.test_operational_station_pos_catalog_parity_199();

drop function if exists public.test_operational_station_pos_catalog_parity_199();

-- Cleanup lab rows
delete from public.pos_product_modifiers where id = '19900000-0000-4000-8000-000000000023'::uuid;
delete from public.pos_product_variants where id = '19900000-0000-4000-8000-000000000022'::uuid;
delete from public.pos_products where id in (
  '19900000-0000-4000-8000-000000000020'::uuid,
  '19900000-0000-4000-8000-000000000021'::uuid
);
delete from public.pos_orders where id in (
  '19900000-0000-4000-8000-000000000010'::uuid,
  '19900000-0000-4000-8000-000000000011'::uuid
);

rollback;
