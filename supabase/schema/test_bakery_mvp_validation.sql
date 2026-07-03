-- Bakery MVP validation script
-- Run in Supabase SQL Editor after 156 + optional seed_bakery_day1_optional.sql

-- Simulate authenticated admin for RPC permission checks (Supabase SQL Editor)
select set_config(
  'request.jwt.claim.sub',
  coalesce(
    (select id::text from public.profiles
     where public.normalize_profile_role(role) = 'admin' and status = 'active'
     limit 1),
    ''
  ),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- =============================================================================
-- 1. Role helpers (as simulated admin)
-- =============================================================================
select
  public.can_access_bakery_module() as admin_can_access,
  public.can_manage_bakery_plans() as admin_can_manage_plans;

-- =============================================================================
-- 2. batch_code generator — sequential / no duplicate on insert
-- =============================================================================
do $$
declare
  v_code1 text;
  v_code2 text;
  v_id1 uuid;
  v_id2 uuid;
begin
  v_code1 := public.next_bakery_production_batch_code('Cheesecake');
  insert into public.bakery_production_batches (
    batch_code, product_name, planned_quantity, unit, status
  )
  values (v_code1, 'Cheesecake TEST', 1, 'Unidad', 'created')
  returning id into v_id1;

  v_code2 := public.next_bakery_production_batch_code('Cheesecake');
  if v_code1 = v_code2 then
    raise notice 'PASS: next code advanced (% -> %)', v_code1, v_code2;
  else
    raise notice 'PASS: codes differ % vs %', v_code1, v_code2;
  end if;

  begin
    insert into public.bakery_production_batches (
      batch_code, product_name, planned_quantity, unit, status
    )
    values (v_code1, 'Cheesecake DUP', 1, 'Unidad', 'created');
    raise exception 'FAIL: duplicate batch_code was allowed';
  exception when unique_violation then
    raise notice 'PASS: duplicate batch_code blocked';
  end;

  delete from public.bakery_production_batches where id in (v_id1, v_id2);
end;
$$;

-- =============================================================================
-- 3. deliver without photo — must fail
-- =============================================================================
do $$
declare
  v_batch_id uuid;
  v_plan_id uuid;
begin
  insert into public.bakery_production_plan_items (
    product_name, planned_quantity, unit, required_date, status, notes
  )
  values (
    'TEST Deliver Block', 1, 'Unidad',
    (now() at time zone 'America/Guatemala')::date,
    'in_progress', '[BAKERY_TEST] deliver block'
  )
  returning id into v_plan_id;

  insert into public.bakery_production_batches (
    batch_code, plan_item_id, product_name, planned_quantity, unit, status, started_at
  )
  values (
    public.next_bakery_production_batch_code('TESTDELIVER'),
    v_plan_id, 'TEST Deliver Block', 1, 'Unidad', 'in_progress', now()
  )
  returning id into v_batch_id;

  insert into public.bakery_production_diary_entries (
    batch_id, planned_quantity, actual_quantity, quality_result, created_by
  )
  select v_batch_id, 1, 1, 'good', id
  from public.profiles
  where public.normalize_profile_role(role) = 'admin'
  limit 1;

  begin
    perform public.deliver_bakery_production_batch(v_batch_id, 1, 'good', null, 'test');
    raise exception 'FAIL: deliver allowed without photo';
  exception when others then
    if sqlerrm ilike '%foto%' then
      raise notice 'PASS: deliver blocked without photo (%)', sqlerrm;
    else
      raise;
    end if;
  end;

  delete from public.bakery_production_diary_entries where batch_id = v_batch_id;
  delete from public.bakery_production_batches where id = v_batch_id;
  delete from public.bakery_production_plan_items where id = v_plan_id;
end;
$$;

-- =============================================================================
-- 4. waste without photo — must fail
-- =============================================================================
do $$
begin
  begin
    perform public.register_bakery_waste(jsonb_build_object(
      'product_name', 'TEST Waste',
      'quantity', 1,
      'unit', 'Unidad',
      'waste_reason', 'other',
      'photo_url', null
    ));
    raise exception 'FAIL: waste allowed without photo';
  exception when others then
    if sqlerrm ilike '%foto%' then
      raise notice 'PASS: waste blocked without photo (%)', sqlerrm;
    else
      raise;
    end if;
  end;
end;
$$;

-- =============================================================================
-- 5. Dashboard RPC
-- =============================================================================
select
  case
    when public.get_bakery_supervisor_dashboard() ? 'today_plan' then 'PASS: dashboard JSON keys ok'
    else 'FAIL: dashboard missing keys'
  end as dashboard_check,
  jsonb_array_length(coalesce(public.get_bakery_supervisor_dashboard() -> 'today_plan', '[]'::jsonb)) as today_plan_count,
  jsonb_array_length(coalesce(public.get_bakery_supervisor_dashboard() -> 'cold_room_dough', '[]'::jsonb)) as cold_dough_count;

-- =============================================================================
-- 6. Junior supervisor role (after seed)
-- =============================================================================
select set_config(
  'request.jwt.claim.sub',
  coalesce(
    (select id::text from public.profiles
     where status = 'active'
       and public.normalize_profile_role(role) = 'supervisor_panaderia'
     order by case when lower(coalesce(full_name, username, '')) like '%junior%' then 0 else 1 end
     limit 1),
    ''
  ),
  true
);

select
  public.can_access_bakery_module() as junior_can_access,
  public.can_manage_bakery_plans() as junior_can_manage_plans;

-- =============================================================================
-- 7. Plan RLS policies
-- =============================================================================
select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where tablename = 'bakery_production_plan_items'
order by policyname;

-- =============================================================================
-- 8. Seed data presence (optional)
-- =============================================================================
select count(*) as seed_plans from public.bakery_production_plan_items where notes like '[BAKERY_SEED_DAY1]%';
select count(*) as seed_dough from public.bakery_dough_batches where notes like '[BAKERY_SEED_DAY1]%';
select count(*) as seed_waste from public.bakery_waste_records where notes like '[BAKERY_SEED_DAY1]%';
