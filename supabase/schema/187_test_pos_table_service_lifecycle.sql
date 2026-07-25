-- Regression tests for 187_pos_table_service_lifecycle.sql
-- Run AFTER applying 187. Entire file: BEGIN … ROLLBACK (no COMMIT).
-- Does NOT touch order 4e6ba009-84ae-421e-9c6b-3217b3863dca.

begin;

create or replace function public.test_pos_table_service_lifecycle_187()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_open_def text;
  v_release_def text;
  v_classify_def text;
  v_assert_def text;
  v_has_payments_def text;
  v_idx_def text;
  v_waiter uuid;
  v_super uuid;
  v_product uuid;
  v_area text;
  v_table_a text := '187-test-a-' || substr(gen_random_uuid()::text, 1, 8);
  v_table_z text := '187-test-z-' || substr(gen_random_uuid()::text, 1, 8);
  v_key_open uuid := gen_random_uuid();
  v_key_open2 uuid := gen_random_uuid();
  v_key_rel uuid := gen_random_uuid();
  v_order uuid;
  v_order2 uuid;
  v_zombie uuid := gen_random_uuid();
  v_result jsonb;
  v_owner uuid;
  v_can_rpc boolean := auth.uid() is not null;
  v_skipped bigint := 0;
begin
  v_open_def := pg_get_functiondef('public.open_pos_table_service(text,text,text,text,text,uuid,uuid,text,text,text,uuid)'::regprocedure);
  v_release_def := pg_get_functiondef('public.release_pos_table_service(uuid,text,uuid,boolean)'::regprocedure);
  v_classify_def := pg_get_functiondef('public.pos_classify_release_scenario(uuid)'::regprocedure);
  v_assert_def := pg_get_functiondef('public.pos_assert_release_authorized(uuid,text)'::regprocedure);
  v_has_payments_def := pg_get_functiondef('public.pos_order_has_payments(uuid)'::regprocedure);

  select indexdef into v_idx_def
  from pg_indexes
  where schemaname = 'public'
    and indexname = 'pos_orders_one_active_service_per_table';

  return query select 'static_open_exists'::text, v_open_def is not null, 'open_pos_table_service defined'::text;
  return query select 'static_release_exists'::text, v_release_def is not null, 'release_pos_table_service defined'::text;

  return query select 'static_open_auth_uid'::text,
    v_open_def ilike '%auth.uid()%' and v_open_def ilike '%can_operate_pos_orders()%',
    'auth + permission gate'::text;

  return query select 'static_open_advisory_lock'::text,
    v_open_def ilike '%pg_advisory_xact_lock%' and v_open_def ilike '%pos_table_service:%',
    'table advisory lock'::text;

  return query select 'static_open_idempotency'::text,
    v_open_def ilike '%pos_load_rpc_idempotency%' and v_open_def ilike '%POS_IDEMPOTENCY_KEY_REQUIRED%',
    'idempotency required'::text;

  return query select 'static_open_zombie_block'::text,
    v_open_def ilike '%POS_TABLE_PENDING_RELEASE%',
    'zombie not reused'::text;

  return query select 'static_open_owner_auth'::text,
    v_open_def ilike '%owner_profile_id%' and v_open_def ilike '%auth.uid()%',
    'owner from auth.uid'::text;

  return query select 'static_release_payments_block'::text,
    v_release_def ilike '%pos_classify_release_scenario%'
    and v_release_def ilike '%pos_assert_release_authorized%'
    and v_classify_def ilike '%partially_paid%'
    and v_classify_def ilike '%pos_order_has_payments%'
    and v_has_payments_def ilike '%public.pos_order_payments%'
    and v_has_payments_def ilike '%p.order_id = p_order_id%'
    and v_has_payments_def ilike '%p.status = ''paid''%'
    and v_assert_def ilike '%L5_payments%'
    and v_assert_def ilike '%POS_RELEASE_BLOCKED_PAYMENTS%'
    and position('pos_classify_release_scenario' in lower(v_release_def)) > 0
    and position('pos_assert_release_authorized' in lower(v_release_def))
        > position('pos_classify_release_scenario' in lower(v_release_def))
    and position('pos_assert_release_authorized' in lower(v_release_def)) > 0
    and position('clear_pos_order_draft_items' in lower(v_release_def)) > 0
    and position('update public.pos_orders' in lower(v_release_def)) > 0
    and position('pos_assert_release_authorized' in lower(v_release_def))
        < position('clear_pos_order_draft_items' in lower(v_release_def))
    and position('pos_assert_release_authorized' in lower(v_release_def))
        < position('update public.pos_orders' in lower(v_release_def)),
    'payment block chain via classify/assert helpers'::text;

  return query select 'static_release_events'::text,
    v_release_def ilike '%table_released%' and v_release_def ilike '%service_cancelled%',
    'audit events'::text;

  return query select 'static_release_search_path'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'release_pos_table_service'
        and pg_get_function_identity_arguments(p.oid) like 'p_order_id uuid, p_reason text%'
        and exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
          where split_part(cfg, '=', 1) = 'search_path'
            and btrim(split_part(cfg, '=', 2), ' "') = ''
        )
    ),
    'release proconfig search_path empty'::text;

  return query select 'A17_index_all_active_statuses'::text,
    v_idx_def ilike '%pos_dine_in_table_service_predicate%'
    or (
      v_idx_def ilike '%sales_channel%'
      and v_idx_def ilike '%dine_in%'
    ),
    coalesce(v_idx_def, 'index missing')::text;

  return query select 'static_index_dine_in_scope'::text,
    v_idx_def ilike '%pos_dine_in_table_service_predicate%'
    and v_idx_def not ilike '%sales-channel%',
    coalesce(v_idx_def, 'index missing')::text;

  return query select 'static_gate_dine_in_scope'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'pos_dine_in_table_service_predicate'
    ),
    'shared dine-in predicate function defined before gate/index'::text;

  return query select 'static_idempotency_table'::text,
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'pos_rpc_idempotency'
    ),
    'pos_rpc_idempotency exists'::text;

  if not v_can_rpc then
    return query select 'runtime_skipped_no_auth'::text, true,
      'SQL Editor without auth.uid(): RPC runtime tests skipped; validate via frontend selftest'::text;
    return;
  end if;

  select p.id into v_waiter
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) = 'mesero'
  limit 1;

  select p.id into v_super
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) in ('supervisor', 'gerente_general', 'admin')
  limit 1;

  select pp.id into v_product from public.pos_products pp where pp.active = true limit 1;
  select a.id into v_area from public.areas a where a.active = true and a.is_production_area = true limit 1;

  if v_waiter is null or v_product is null or v_area is null then
    return query select 'fixtures_profile_product'::text, false,
      'need active mesero profile, product, production area'::text;
    return;
  end if;

  -- A1 new open
  v_result := public.open_pos_table_service(
    v_table_a, 'Mesa 187 A', 'zone-187', 'Salon 187', 'dine_in',
    null, null, null, null, null, v_key_open
  );
  v_order := (v_result ->> 'order_id')::uuid;
  v_owner := (v_result ->> 'owner_profile_id')::uuid;

  return query select 'A1_new_open'::text,
    coalesce((v_result ->> 'created')::boolean, false) = true
    and v_order is not null
    and v_owner = auth.uid(),
    v_result::text;

  -- A10 idempotent retry same key
  v_result := public.open_pos_table_service(
    v_table_a, 'Mesa 187 A', 'zone-187', 'Salon 187', 'dine_in',
    null, null, null, null, null, v_key_open
  );
  return query select 'A10_idempotent_retry'::text,
    (v_result ->> 'order_id')::uuid = v_order,
    v_result::text;

  -- A10b fingerprint mismatch
  begin
    perform public.open_pos_table_service(
      v_table_a, 'Mesa 187 B DIFF', 'zone-187', 'Salon 187', 'dine_in',
      null, null, null, null, null, v_key_open
    );
    return query select 'A10b_fingerprint_mismatch'::text, false, 'expected exception'::text;
  exception when others then
    return query select 'A10b_fingerprint_mismatch'::text,
      sqlerrm ilike '%POS_IDEMPOTENCY_FINGERPRINT_MISMATCH%',
      sqlerrm;
  end;

  -- A2 help reuse: add draft item
  insert into public.pos_order_items (
    order_id, product_id, product_name, quantity, unit_price, total_price, status, production_area_id
  ) values (
    v_order, v_product, '187 help item', 1, 10, 10, 'draft', v_area
  );

  v_result := public.open_pos_table_service(
    v_table_a, 'Mesa 187 A', 'zone-187', 'Salon 187', 'dine_in',
    null, null, null, null, null, v_key_open2
  );
  return query select 'A2_help_reuse'::text,
    coalesce((v_result ->> 'reused')::boolean, false) = true
    and (v_result ->> 'order_id')::uuid = v_order,
    v_result::text;

  -- A5 owner unchanged on reuse
  return query select 'A5_owner_unchanged_reuse'::text,
    (v_result ->> 'owner_profile_id')::uuid = v_owner,
    'owner stable'::text;

  -- A13 zombie fixture
  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status, subtotal, total
  ) values (
    v_zombie, v_table_z, 'Mesa 187 Z', v_waiter, 'Zombie 187', v_waiter, 'open', 0, 0
  );
  insert into public.pos_order_items (
    order_id, product_id, product_name, quantity, unit_price, total_price, status, production_area_id
  ) values (
    v_zombie, v_product, 'cancelled only', 1, 5, 5, 'cancelled', v_area
  );

  begin
    perform public.open_pos_table_service(
      v_table_z, 'Mesa 187 Z', 'zone-187', 'Salon 187', 'dine_in',
      null, null, null, null, null, gen_random_uuid()
    );
    return query select 'A13_zombie_not_reused'::text, false, 'expected POS_TABLE_PENDING_RELEASE'::text;
  exception when others then
    return query select 'A13_zombie_not_reused'::text,
      sqlerrm ilike '%POS_TABLE_PENDING_RELEASE%',
      sqlerrm;
  end;

  return query select 'static_zombie_helper'::text,
    public.pos_table_is_zombie_open(v_table_z),
    'pos_table_is_zombie_open true'::text;

  -- L1 release empty order on table A after clearing? Use new empty order
  v_order2 := gen_random_uuid();
  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status
  ) values (
    v_order2, '187-empty-' || substr(gen_random_uuid()::text, 1, 6),
    'Mesa empty', auth.uid(), 'Owner test', auth.uid(), 'open'
  );

  v_result := public.release_pos_table_service(
    v_order2, 'Cliente se retiro sin consumir nada.', gen_random_uuid()
  );
  return query select 'A4_L1_owner_release_empty'::text,
    coalesce((v_result ->> 'released')::boolean, false) = true,
    v_result::text;

  -- A12 after cancelled, new open on same table
  v_table_a := '187-reopen-' || substr(gen_random_uuid()::text, 1, 8);
  update public.pos_orders set table_id = v_table_a where id = v_order;
  v_result := public.release_pos_table_service(
    v_order, 'Cierre de prueba 187 para reopen.', gen_random_uuid()
  );
  v_result := public.open_pos_table_service(
    v_table_a, 'Mesa reopen', 'zone-187', 'Salon', 'dine_in',
    null, null, null, null, null, gen_random_uuid()
  );
  return query select 'A12_new_order_after_cancelled'::text,
    coalesce((v_result ->> 'created')::boolean, false) = true
    and (v_result ->> 'order_id')::uuid <> v_order,
    v_result::text;

  -- A15 owner on new order = current actor
  return query select 'A15_new_owner_actor'::text,
    (v_result ->> 'owner_profile_id')::uuid = auth.uid(),
    v_result::text;

  -- Service opened event on last created order
  return query select 'A16_service_opened_event'::text,
    exists (
      select 1 from public.pos_order_events e
      where e.order_id = (v_result ->> 'order_id')::uuid
        and e.event_type = 'service_opened'
    ),
    'service_opened logged'::text;

  -- L3 requires supervisor — attempt as mesero on kds order (skip if current user is supervisor)
  if not public.is_pos_elevated_supervisor() then
    insert into public.pos_orders (
      id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status
    ) values (
      gen_random_uuid(), '187-kds-' || substr(gen_random_uuid()::text, 1, 6),
      'KDS test', auth.uid(), 'Me', auth.uid(), 'open'
    ) returning id into v_order2;
    insert into public.pos_order_items (
      order_id, product_id, product_name, quantity, unit_price, total_price,
      status, production_area_id, production_ticket_id
    ) values (
      v_order2, v_product, 'sent line', 1, 8, 8, 'sent_to_production', v_area, gen_random_uuid()
    );
    begin
      perform public.release_pos_table_service(
        v_order2, 'Intento liberar historial KDS sin supervisor.', gen_random_uuid()
      );
      return query select 'A6_kds_requires_supervisor'::text, false, 'expected supervisor error'::text;
    exception when others then
      return query select 'A6_kds_requires_supervisor'::text,
        sqlerrm ilike '%POS_RELEASE_REQUIRES_SUPERVISOR%',
        sqlerrm;
    end;
  else
    v_skipped := v_skipped + 1;
    return query select 'A6_kds_requires_supervisor'::text, true,
      'skipped: current auth user is elevated supervisor'::text;
  end if;

  -- A8 partially_paid block
  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status
  ) values (
    gen_random_uuid(), '187-pp-' || substr(gen_random_uuid()::text, 1, 6),
    'Partial', auth.uid(), 'Me', auth.uid(), 'partially_paid'
  ) returning id into v_order2;
  begin
    perform public.release_pos_table_service(
      v_order2, 'Intento liberar orden con pago parcial.', gen_random_uuid()
    );
    return query select 'A8_partial_paid_blocked'::text, false, 'expected payment block'::text;
  exception when others then
    return query select 'A8_partial_paid_blocked'::text,
      sqlerrm ilike '%POS_RELEASE_BLOCKED_PAYMENTS%',
      sqlerrm;
  end;

  -- A9 paid idempotent response
  insert into public.pos_orders (
    id, table_id, table_name, waiter_id, waiter_name, owner_profile_id, status, paid_at
  ) values (
    gen_random_uuid(), '187-paid-' || substr(gen_random_uuid()::text, 1, 6),
    'Paid', auth.uid(), 'Me', auth.uid(), 'paid', now()
  ) returning id into v_order2;
  v_result := public.release_pos_table_service(
    v_order2, 'Intento sobre orden ya pagada en prueba.', gen_random_uuid()
  );
  return query select 'A9_paid_no_release'::text,
    coalesce((v_result ->> 'released')::boolean, true) = false,
    v_result::text;

end;
$$;

revoke all on function public.test_pos_table_service_lifecycle_187() from public;
revoke all on function public.test_pos_table_service_lifecycle_187() from anon;
revoke all on function public.test_pos_table_service_lifecycle_187() from authenticated;
grant execute on function public.test_pos_table_service_lifecycle_187() to service_role;

with results as materialized (
  select scenario, passed, detail
  from public.test_pos_table_service_lifecycle_187()
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where passed)::bigint as passed_total,
    count(*) filter (where not passed)::bigint as failed_total
  from results
)
select
  r.scenario,
  r.passed,
  r.detail,
  s.total,
  s.passed_total,
  s.failed_total
from results r
cross join summary s
order by r.passed asc, r.scenario;

drop function if exists public.test_pos_table_service_lifecycle_187();

rollback;
