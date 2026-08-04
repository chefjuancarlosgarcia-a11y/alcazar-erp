-- Lab-only runtime parity for migration 199 (BEGIN … ROLLBACK).
-- Requires elevated local PostgreSQL (embedded lab via scripts/run-parity-lab-199.mjs).
-- NOT safe for Supabase managed / production: uses session_replication_role, auth.users,
-- trigger toggles, app_settings writes, and cc199-* fixture DML.
-- Remote structural evidence: supabase/schema/199_test_operational_station_pos_catalog_parity.sql

begin;

create or replace function public.test_operational_station_pos_catalog_parity_199_lab()
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
  v_open_def text;
  v_prod_simple uuid := '19900000-0000-4000-8000-000000000020'::uuid;
  v_prod_pizza uuid := '19900000-0000-4000-8000-000000000021'::uuid;
  v_var_med uuid := '19900000-0000-4000-8000-000000000022'::uuid;
  v_mod uuid := '19900000-0000-4000-8000-000000000023'::uuid;
  v_pricing jsonb;
  v_catalog_def text;
begin
  perform set_config('request.jwt.claim.sub', '', true);

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

  v_open_def := pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure);

  return query select 'open_service_opened_insert_static'::text,
    position('insert into public.pos_order_events' in v_open_def) > 0,
    'open_station_pos_table_service logs pos_order_events'::text;

  return query select 'open_service_opened_type_static'::text,
    position('''service_opened''' in v_open_def) > 0,
    'event_type service_opened present in function body'::text;

  return query select 'open_service_opened_created_by_operator'::text,
    position('created_by' in v_open_def) > 0
      and position('v_operator_id' in v_open_def) > 0,
    'created_by uses v_operator_id'::text;

  if to_regclass('public.pos_orders') is null or to_regclass('public.profiles') is null then
    return query select 'schema_pos_tables'::text, false, 'pos_orders/profiles missing'::text;
    return;
  end if;

  select p.id into v_owner_a
  from public.profiles p
  where p.id = '19900000-0000-4000-8000-000000000001'::uuid
    and p.status = 'active';

  if v_owner_a is null then
    select p.id into v_owner_a
    from public.profiles p
    where p.status = 'active'
    order by p.created_at
    limit 1;
  end if;

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

  begin
    perform public.station_pos_assert_order_open_for_drafts(v_order_open, v_owner_b);
    return query select 'remote_p0001_owner_mismatch_repro'::text, false,
      'expected STATION_POS_ORDER_OWNER_MISMATCH'::text;
  exception
    when others then
      return query select 'remote_p0001_owner_mismatch_repro'::text,
        sqlerrm = 'STATION_POS_ORDER_OWNER_MISMATCH',
        format(
          'function=station_pos_assert_order_open_for_drafts; order_id=%s owner_profile_id=%s operator_profile_id=%s sqlerrm=%s',
          v_order_open, v_owner_a, v_owner_b, sqlerrm
        )::text;
  end;

  begin
    perform public.station_pos_assert_order_open_for_drafts(v_order_open, v_owner_a);
    return query select 'same_owner_reuse_assert'::text, true,
      format('order_id=%s operator_profile_id=%s', v_order_open, v_owner_a)::text;
  exception
    when others then
      return query select 'same_owner_reuse_assert'::text, false, sqlerrm::text;
  end;

  begin
    perform public.station_pos_assert_order_open_for_drafts(v_order_closed, v_owner_a);
    return query select 'order_not_open_blocked'::text, false, 'expected STATION_POS_ORDER_NOT_OPEN'::text;
  exception
    when others then
      return query select 'order_not_open_blocked'::text,
        sqlerrm = 'STATION_POS_ORDER_NOT_OPEN',
        format('function=station_pos_assert_order_open_for_drafts; status=paid; sqlerrm=%s', sqlerrm)::text;
  end;

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

revoke all on function public.test_operational_station_pos_catalog_parity_199_lab() from public, anon, authenticated;
grant execute on function public.test_operational_station_pos_catalog_parity_199_lab() to postgres, service_role;

create or replace function public.test_operational_station_pos_open_runtime_199_lab()
returns table (scenario text, passed boolean, detail text)
language plpgsql
set search_path = ''
as $$
declare
  v_operator_id constant uuid := '19900000-0000-4000-8000-000000000001'::uuid;
  v_device_auth_id constant text := '19900000-0000-4000-8000-000000000030';
  v_lab_token constant text := 'cc199-lab-operator-session-token-local-only';
  v_table_id text := 'cc199-open-new-1';
  v_prod_simple constant uuid := '19900000-0000-4000-8000-000000000020'::uuid;
  v_idem_new text;
  v_idem_reuse text;
  v_open_result jsonb;
  v_open_order_id uuid;
  v_event_count int;
  v_reuse_id uuid;
begin
  perform set_config('request.jwt.claim.sub', v_device_auth_id, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_idem_new := gen_random_uuid()::text;
  v_idem_reuse := gen_random_uuid()::text;

  begin
    v_open_result := public.open_station_pos_table_service(
      v_lab_token,
      v_table_id,
      'Mesa Open New',
      'cc199-zone',
      'CC199 Lab',
      v_idem_new
    );
    v_open_order_id := nullif(v_open_result ->> 'order_id', '')::uuid;
  exception
    when others then
      return query select 'open_new_service_opened_once'::text, false, sqlerrm::text;
      return query select 'open_new_service_opened_created_by'::text, false, sqlerrm::text;
      return query select 'open_idempotency_replay_no_duplicate_event'::text, false, sqlerrm::text;
      return query select 'open_valid_reuse_no_second_event'::text, false, sqlerrm::text;
      return;
  end;

  select count(*) into v_event_count
  from public.pos_order_events e
  where e.order_id = v_open_order_id
    and e.event_type = 'service_opened';

  return query select 'open_new_service_opened_once'::text,
    coalesce((v_open_result ->> 'created')::boolean, false)
      and v_open_order_id is not null
      and v_event_count = 1,
    format('order_id=%s service_opened_count=%s', v_open_order_id, v_event_count)::text;

  return query select 'open_new_service_opened_created_by'::text,
    exists (
      select 1 from public.pos_order_events e
      where e.order_id = v_open_order_id
        and e.event_type = 'service_opened'
        and e.created_by = v_operator_id
    ),
    format('created_by=%s operator=%s', v_operator_id, v_operator_id)::text;

  begin
    v_open_result := public.open_station_pos_table_service(
      v_lab_token,
      v_table_id,
      'Mesa Open New',
      'cc199-zone',
      'CC199 Lab',
      v_idem_new
    );

    select count(*) into v_event_count
    from public.pos_order_events e
    where e.order_id = v_open_order_id
      and e.event_type = 'service_opened';

    return query select 'open_idempotency_replay_no_duplicate_event'::text,
      v_open_result is not null
        and coalesce((v_open_result ->> 'order_id')::uuid, v_open_order_id) = v_open_order_id
        and v_event_count = 1,
      format('order_id=%s service_opened_count=%s after replay', v_open_order_id, v_event_count)::text;
  exception
    when others then
      return query select 'open_idempotency_replay_no_duplicate_event'::text, false, sqlerrm::text;
  end;

  begin
    insert into public.pos_order_items (
      order_id, product_id, product_name, quantity, unit_price, total_price, status
    ) values (
      v_open_order_id,
      v_prod_simple,
      'CC199 Simple',
      1,
      30,
      30,
      'draft'
    );

    v_open_result := public.open_station_pos_table_service(
      v_lab_token,
      v_table_id,
      'Mesa Open New',
      'cc199-zone',
      'CC199 Lab',
      v_idem_reuse
    );
    v_reuse_id := nullif(v_open_result ->> 'order_id', '')::uuid;

    select count(*) into v_event_count
    from public.pos_order_events e
    where e.order_id = v_open_order_id
      and e.event_type = 'service_opened';

    return query select 'open_valid_reuse_no_second_event'::text,
      coalesce((v_open_result ->> 'reused')::boolean, false)
        and coalesce((v_open_result ->> 'created')::boolean, true) = false
        and v_reuse_id = v_open_order_id
        and v_event_count = 1,
      format('order_id=%s service_opened_count=%s reuse probe', v_open_order_id, v_event_count)::text;
  exception
    when others then
      return query select 'open_valid_reuse_no_second_event'::text, false, sqlerrm::text;
  end;
end;
$$;

revoke all on function public.test_operational_station_pos_open_runtime_199_lab() from public, anon;
grant execute on function public.test_operational_station_pos_open_runtime_199_lab() to authenticated, postgres, service_role;

create temp table if not exists _199_lab_results (
  scenario text,
  passed boolean,
  detail text
) on commit drop;

insert into _199_lab_results
select * from public.test_operational_station_pos_catalog_parity_199_lab();

update public.app_settings
set value = jsonb_build_object('enabled', true, 'updated_at', now()),
    updated_at = now()
where key in ('operational_stations_enabled', 'operational_station_pos_enabled');

select set_config('session_replication_role', 'replica', true);

insert into auth.users (id, email, role, aud)
values (
  '19900000-0000-4000-8000-000000000001'::uuid,
  'cc199-owner-a@lab.local',
  'authenticated',
  'authenticated'
)
on conflict (id) do nothing;

insert into auth.users (id, email, role, aud, raw_app_meta_data)
values (
  '19900000-0000-4000-8000-000000000030'::uuid,
  'cc199-device@lab.local',
  'authenticated',
  'authenticated',
  '{"operational_station_device": true}'::jsonb
)
on conflict (id) do update set raw_app_meta_data = excluded.raw_app_meta_data;

alter table public.profiles disable trigger protect_profile_managed_fields;

insert into public.profiles (id, email, username, full_name, role, status)
values (
  '19900000-0000-4000-8000-000000000001'::uuid,
  'cc199-owner-a@lab.local',
  'cc199-owner-a',
  'CC199 Owner A',
  'mesero',
  'active'
)
on conflict (id) do update set status = 'active', role = 'mesero';

insert into public.profiles (id, email, username, full_name, role, status)
values (
  '19900000-0000-4000-8000-000000000030'::uuid,
  'cc199-device@lab.local',
  'cc199-device',
  'CC199 Device Auth',
  'mesero',
  'active'
)
on conflict (id) do update set status = 'active', role = 'mesero';

alter table public.profiles enable trigger protect_profile_managed_fields;

select set_config('session_replication_role', 'origin', true);

insert into public.operational_stations (
  id, station_code, name, station_type, status, identity_mode, pos_floor_zone
) values (
  '19900000-0000-4000-8000-000000000031'::uuid,
  'cc199-lab-pos',
  'CC199 Lab POS',
  'pos',
  'active',
  'individual',
  'mesas'
) on conflict (id) do update set status = 'active', station_type = 'pos';

insert into public.operational_station_devices (
  id, station_id, device_label, status, auth_user_id, activated_at
) values (
  '19900000-0000-4000-8000-000000000032'::uuid,
  '19900000-0000-4000-8000-000000000031'::uuid,
  'cc199-lab-device',
  'active',
  '19900000-0000-4000-8000-000000000030'::uuid,
  now()
) on conflict (id) do update
  set status = 'active', auth_user_id = excluded.auth_user_id, station_id = excluded.station_id;

insert into public.operational_station_assignments (profile_id, station_id, active)
values (
  '19900000-0000-4000-8000-000000000001'::uuid,
  '19900000-0000-4000-8000-000000000031'::uuid,
  true
)
on conflict (profile_id, station_id) do update set active = true;

insert into public.operational_operator_sessions (
  id, operational_station_device_id, operational_station_id,
  operator_profile_id, module, session_token_hash,
  idle_expires_at, absolute_expires_at
) values (
  '19900000-0000-4000-8000-000000000033'::uuid,
  '19900000-0000-4000-8000-000000000032'::uuid,
  '19900000-0000-4000-8000-000000000031'::uuid,
  '19900000-0000-4000-8000-000000000001'::uuid,
  'pos',
  encode(extensions.digest('cc199-lab-operator-session-token-local-only', 'sha256'), 'hex'),
  now() + interval '4 hours',
  now() + interval '4 hours'
) on conflict (id) do update set
  revoked_at = null,
  idle_expires_at = now() + interval '4 hours',
  absolute_expires_at = now() + interval '4 hours',
  session_token_hash = excluded.session_token_hash;

select set_config('request.jwt.claim.sub', '19900000-0000-4000-8000-000000000030', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into _199_lab_results
select * from public.test_operational_station_pos_open_runtime_199_lab();

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

with scenarios as (
  select scenario, passed, detail
  from _199_lab_results
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where passed)::bigint as passed_total,
    count(*) filter (where not passed)::bigint as failed_total
  from scenarios
)
select
  s.scenario,
  s.passed,
  s.detail,
  sm.total,
  sm.passed_total,
  sm.failed_total
from scenarios s
cross join summary sm
order by s.passed asc, s.scenario asc;

drop function if exists public.test_operational_station_pos_catalog_parity_199_lab();
drop function if exists public.test_operational_station_pos_open_runtime_199_lab();

delete from public.pos_order_items where order_id in (
  select id from public.pos_orders
  where table_id like 'cc199-%'
    or id in (
      '19900000-0000-4000-8000-000000000010'::uuid,
      '19900000-0000-4000-8000-000000000011'::uuid
    )
);
delete from public.pos_product_modifiers where id = '19900000-0000-4000-8000-000000000023'::uuid;
delete from public.pos_product_variants where id = '19900000-0000-4000-8000-000000000022'::uuid;
delete from public.pos_products where id in (
  '19900000-0000-4000-8000-000000000020'::uuid,
  '19900000-0000-4000-8000-000000000021'::uuid
);
delete from public.pos_order_events where order_id in (
  select id from public.pos_orders where table_id like 'cc199-%'
);
delete from public.operational_station_pos_idempotency where device_id = '19900000-0000-4000-8000-000000000032'::uuid;
delete from public.operational_station_pos_action_audit where operational_station_device_id = '19900000-0000-4000-8000-000000000032'::uuid;
delete from public.operational_operator_sessions where id = '19900000-0000-4000-8000-000000000033'::uuid;
delete from public.operational_station_assignments where station_id = '19900000-0000-4000-8000-000000000031'::uuid;
delete from public.operational_station_devices where id = '19900000-0000-4000-8000-000000000032'::uuid;
delete from public.operational_stations where id = '19900000-0000-4000-8000-000000000031'::uuid;
delete from public.pos_orders where table_id like 'cc199-%' or id in (
  '19900000-0000-4000-8000-000000000010'::uuid,
  '19900000-0000-4000-8000-000000000011'::uuid
);

rollback;
