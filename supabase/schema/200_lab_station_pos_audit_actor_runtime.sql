-- Lab-only runtime for migration 200 (BEGIN … ROLLBACK).
-- Requires elevated local PostgreSQL via scripts/run-station-pos-audit-lab-200.mjs.
-- NOT for Supabase managed / production.

begin;

create temp table if not exists _200_lab_results (
  scenario text,
  passed boolean,
  detail text
);

truncate _200_lab_results;

create or replace function public.test_station_pos_audit_actor_200_lab()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_human uuid := '20000000-0000-4000-8000-000000000001'::uuid;
  v_technical uuid := '20000000-0000-4000-8000-000000000002'::uuid;
  v_order_id uuid := '20000000-0000-4000-8000-000000000010'::uuid;
  v_order_waiter uuid := '20000000-0000-4000-8000-000000000011'::uuid;
  v_product_id uuid := '20000000-0000-4000-8000-000000000020'::uuid;
  v_item_id uuid;
  v_actor uuid;
  v_event_count int;
begin
  perform set_config('request.jwt.claim.sub', '', true);

  if to_regclass('public.profiles') is null then
    return query select 'schema'::text, false, 'profiles missing'::text;
    return;
  end if;

  perform set_config('session_replication_role', 'replica', true);
  insert into auth.users (id, email)
  values
    (v_human, 'cc200-human@lab.local'),
    (v_technical, 'cc200-technical@lab.local')
  on conflict (id) do nothing;
  insert into public.profiles (id, email, username, full_name, role, status)
  values (v_human, 'cc200-human@lab.local', 'cc200-human', 'CC200 Human', 'mesero', 'active')
  on conflict (id) do update set status = 'active';
  delete from public.profiles where id = v_technical;
  insert into public.pos_products (id, name, price, active, production_ready)
  values (v_product_id, 'CC200 Lab Product', 10, true, true)
  on conflict (id) do nothing;
  perform set_config('session_replication_role', 'origin', true);

  return query select 'L01-no_technical_profile'::text,
    not exists (select 1 from public.profiles p where p.id = v_technical),
    format('technical=%s human=%s', v_technical, v_human)::text;

  delete from public.pos_order_events where order_id in (v_order_id, v_order_waiter);
  delete from public.pos_order_items where order_id in (v_order_id, v_order_waiter);
  delete from public.pos_orders where id in (v_order_id, v_order_waiter);

  perform set_config('request.jwt.claim.sub', v_technical::text, true);

  insert into public.pos_orders (
    id, table_id, table_name, area_id, area_name, sales_channel,
    waiter_id, waiter_name, owner_profile_id, status
  ) values (
    v_order_id, 'cc200-m1', 'Mesa cc200-m1', 'cc200-z', 'CC200', 'dine_in',
    v_human, 'CC200 Human', v_human, 'open'
  );

  select count(*) into v_event_count
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'order_created';

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'order_created'
  limit 1;

  return query select 'L02-order_created_no_fk_fail'::text,
    v_event_count = 1 and v_actor = v_human,
    format('events=%s actor=%s expected=%s', v_event_count, v_actor, v_human)::text;

  return query select 'L03-order_created_owner_profile'::text,
    v_actor = v_human,
    format('actor=%s owner=%s', v_actor, v_human)::text;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (v_order_id, 'service_opened', 'Lab service_opened', v_human);

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'service_opened'
  limit 1;

  return query select 'L04-service_opened_operator_actor'::text,
    v_actor = v_human,
    format('actor=%s', v_actor)::text;

  insert into public.pos_order_items (
    order_id, product_id, product_name, quantity, unit_price, total_price, status
  ) values (
    v_order_id, v_product_id, 'CC200 Lab Item', 1, 10, 10, 'draft'
  )
  returning id into v_item_id;

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'item_added'
  order by e.created_at desc
  limit 1;

  return query select 'L05-item_added_operator_actor'::text,
    v_actor = v_human,
    format('actor=%s expected=%s', v_actor, v_human)::text;

  update public.pos_order_items
  set quantity = 2
  where id = v_item_id;

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'item_updated'
  order by e.created_at desc
  limit 1;

  return query select 'L06-item_updated_operator_actor'::text,
    v_actor = v_human,
    format('actor=%s', v_actor)::text;

  update public.pos_orders set status = 'sent' where id = v_order_id;

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'order_sent'
  order by e.created_at desc
  limit 1;

  return query select 'L07-status_change_operator_actor'::text,
    v_actor = v_human,
    format('actor=%s event=order_sent', v_actor)::text;

  delete from public.pos_order_items where id = v_item_id;

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'item_removed'
  order by e.created_at desc
  limit 1;

  return query select 'L08-item_removed_operator_actor'::text,
    v_actor = v_human,
    format('actor=%s', v_actor)::text;

  select count(*) into v_event_count
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'order_created';

  return query select 'L09-replay_no_duplicate_order_created'::text,
    v_event_count = 1,
    format('order_created_count=%s', v_event_count)::text;

  insert into public.pos_orders (
    id, table_id, table_name, sales_channel, waiter_id, waiter_name, owner_profile_id, status
  ) values (
    v_order_waiter, 'cc200-w', 'Mesa waiter fallback', 'dine_in',
    v_human, 'CC200 Human', null, 'open'
  );

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_waiter and e.event_type = 'order_created'
  limit 1;

  return query select 'L10-waiter_id_fallback'::text,
    v_actor = v_human,
    format('actor=%s waiter=%s', v_actor, v_human)::text;

  begin
    perform public.pos_order_event_actor_profile(null, null, null);
    return query select 'L11-invalid_actor_raises'::text, false, 'expected STATION_POS_AUDIT_ACTOR_INVALID'::text;
  exception
    when others then
      return query select 'L11-invalid_actor_raises'::text,
        sqlerrm = 'STATION_POS_AUDIT_ACTOR_INVALID',
        sqlerrm::text;
  end;

  perform set_config('request.jwt.claim.sub', v_human::text, true);
  delete from public.pos_order_events where order_id = v_order_id;
  delete from public.pos_order_items where order_id = v_order_id;
  delete from public.pos_orders where id = v_order_id;

  insert into public.pos_orders (
    id, table_id, table_name, sales_channel, waiter_id, waiter_name, owner_profile_id, status
  ) values (
    v_order_id, 'cc200-h', 'Mesa human', 'dine_in',
    v_human, 'CC200 Human', v_human, 'open'
  );

  select e.created_by into v_actor
  from public.pos_order_events e
  where e.order_id = v_order_id and e.event_type = 'order_created'
  limit 1;

  return query select 'L12-human_session_uses_auth_uid'::text,
    v_actor = v_human,
    format('actor=%s', v_actor)::text;

  begin
    perform set_config('request.jwt.claim.sub', v_technical::text, true);
    insert into public.pos_orders (
      id, table_id, table_name, sales_channel, waiter_id, waiter_name, owner_profile_id, status
    ) values (
      '20000000-0000-4000-8000-000000000099'::uuid, 'cc200-fail', 'Fail tx', 'dine_in',
      null, null, null, 'open'
    );
    return query select 'L13-failed_tx_no_orphan_order'::text, false, 'expected exception'::text;
  exception
    when others then
      return query select 'L13-failed_tx_no_orphan_order'::text,
        not exists (
          select 1 from public.pos_orders o
          where o.id = '20000000-0000-4000-8000-000000000099'::uuid
        ),
        sqlerrm::text;
  end;

  return query select 'L14-no_technical_profile_after_lab'::text,
    not exists (select 1 from public.profiles p where p.id = v_technical),
    'must not create technical profile'::text;

  return query select 'L15-lab_rollback_scope'::text,
    current_setting('transaction_isolation') is not null,
    'executed inside BEGIN/ROLLBACK lab transaction'::text;
end;
$$;

revoke all on function public.test_station_pos_audit_actor_200_lab() from public, anon, authenticated;
grant execute on function public.test_station_pos_audit_actor_200_lab() to service_role;

insert into _200_lab_results
select * from public.test_station_pos_audit_actor_200_lab();

with scenarios as (
  select scenario, passed, detail from _200_lab_results
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
order by s.scenario;

drop function if exists public.test_station_pos_audit_actor_200_lab();

delete from public.pos_order_events
where order_id in (
  '20000000-0000-4000-8000-000000000010'::uuid,
  '20000000-0000-4000-8000-000000000011'::uuid
);
delete from public.pos_order_items
where order_id in (
  '20000000-0000-4000-8000-000000000010'::uuid,
  '20000000-0000-4000-8000-000000000011'::uuid
);
delete from public.pos_orders
where id in (
  '20000000-0000-4000-8000-000000000010'::uuid,
  '20000000-0000-4000-8000-000000000011'::uuid
);
delete from public.pos_products where id = '20000000-0000-4000-8000-000000000020'::uuid;

rollback;
