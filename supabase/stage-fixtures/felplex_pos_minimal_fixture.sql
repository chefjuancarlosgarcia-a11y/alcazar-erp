-- FELplex Stage — minimal POS/Caja fixture (7 rows).
-- Manual execution in the privileged Supabase Stage SQL Editor.
-- Does NOT create orders, payments, sessions, movements, or enable FEL.

begin;

select pg_advisory_xact_lock(hashtext('felplex_pos_minimal_fixture'));

-- ---------------------------------------------------------------------------
-- Safety guards (Stage + FEL disabled)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from public.fel_emission_config
    where id = 1
      and environment = 'stage'
      and emission_enabled = false
      and auto_issue_paid_orders = false
      and formal_contingency_enabled = false
  ) then
    raise exception
      'Refusing fixture: fel_emission_config id=1 not in safe Stage state '
      '(environment=stage, emission_enabled=false, auto_issue_paid_orders=false, '
      'formal_contingency_enabled=false).';
  end if;

  if exists (select 1 from public.pos_fel_documents) then
    raise exception 'Refusing fixture: pos_fel_documents is not empty.';
  end if;

  if exists (select 1 from public.pos_fel_attempts) then
    raise exception 'Refusing fixture: pos_fel_attempts is not empty.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Deterministic fixture IDs
-- ---------------------------------------------------------------------------
-- area_id:        fel_test_cocina
-- product_id:     fef00001-0000-4000-8000-000000000001
-- zone_id:        fel_test_salon
-- table_ids:      M-FEL-OPEN, M-FEL-PARTIAL, M-FEL-PAID
-- cash_register:  fef00002-0000-4000-8000-000000000002

-- ---------------------------------------------------------------------------
-- Name collision guards (different id, same display name)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.areas
    where name = 'Cocina FEL Test' and id <> 'fel_test_cocina'
  ) then
    raise exception 'Fixture conflict: area name "Cocina FEL Test" already used by id=%',
      (select id from public.areas where name = 'Cocina FEL Test' and id <> 'fel_test_cocina' limit 1);
  end if;

  if exists (
    select 1 from public.pos_products
    where name = 'Producto FEL Test'
      and id <> 'fef00001-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'Fixture conflict: product name "Producto FEL Test" already used by a different id.';
  end if;

  if exists (
    select 1 from public.pos_floor_zones
    where name = 'Salón FEL Test' and id <> 'fel_test_salon'
  ) then
    raise exception 'Fixture conflict: zone name "Salón FEL Test" already used by id=%',
      (select id from public.pos_floor_zones where name = 'Salón FEL Test' and id <> 'fel_test_salon' limit 1);
  end if;

  if exists (
    select 1 from public.pos_floor_tables
    where name = 'M-FEL-OPEN' and id <> 'M-FEL-OPEN'
  ) then
    raise exception 'Fixture conflict: table name "M-FEL-OPEN" already used by id=%',
      (select id from public.pos_floor_tables where name = 'M-FEL-OPEN' and id <> 'M-FEL-OPEN' limit 1);
  end if;

  if exists (
    select 1 from public.pos_floor_tables
    where name = 'M-FEL-PARTIAL' and id <> 'M-FEL-PARTIAL'
  ) then
    raise exception 'Fixture conflict: table name "M-FEL-PARTIAL" already used by id=%',
      (select id from public.pos_floor_tables where name = 'M-FEL-PARTIAL' and id <> 'M-FEL-PARTIAL' limit 1);
  end if;

  if exists (
    select 1 from public.pos_floor_tables
    where name = 'M-FEL-PAID' and id <> 'M-FEL-PAID'
  ) then
    raise exception 'Fixture conflict: table name "M-FEL-PAID" already used by id=%',
      (select id from public.pos_floor_tables where name = 'M-FEL-PAID' and id <> 'M-FEL-PAID' limit 1);
  end if;

  if exists (
    select 1 from public.cash_registers
    where name = 'Caja FEL Stage'
      and id <> 'fef00002-0000-4000-8000-000000000002'::uuid
  ) then
    raise exception 'Fixture conflict: cash register name "Caja FEL Stage" already used by a different id.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Area (fel_test_cocina)
-- ---------------------------------------------------------------------------

insert into public.areas (
  id,
  name,
  type,
  is_production_area,
  active
) values (
  'fel_test_cocina',
  'Cocina FEL Test',
  'produccion',
  true,
  true
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.areas
    where id = 'fel_test_cocina'
      and name = 'Cocina FEL Test'
      and type = 'produccion'
      and is_production_area = true
      and active = true
  ) then
    raise exception
      'Fixture mismatch: areas id=fel_test_cocina exists with unexpected values.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Floor zone (fel_test_salon)
-- ---------------------------------------------------------------------------

insert into public.pos_floor_zones (
  id,
  name,
  active
) values (
  'fel_test_salon',
  'Salón FEL Test',
  true
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.pos_floor_zones
    where id = 'fel_test_salon'
      and name = 'Salón FEL Test'
      and active = true
  ) then
    raise exception
      'Fixture mismatch: pos_floor_zones id=fel_test_salon exists with unexpected values.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. POS product (is_test_item → production_ready via trigger)
-- ---------------------------------------------------------------------------

insert into public.pos_products (
  id,
  name,
  price,
  category_id,
  production_area_id,
  active,
  is_test_item,
  product_type
) values (
  'fef00001-0000-4000-8000-000000000001'::uuid,
  'Producto FEL Test',
  148.50,
  'extras',
  'fel_test_cocina',
  true,
  true,
  'manual_test'
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.pos_products
    where id = 'fef00001-0000-4000-8000-000000000001'::uuid
      and name = 'Producto FEL Test'
      and price = 148.50
      and category_id = 'extras'
      and production_area_id = 'fel_test_cocina'
      and active = true
      and is_test_item = true
      and product_type = 'manual_test'
      and production_ready = true
  ) then
    raise exception
      'Fixture mismatch: pos_products id=fef00001-0000-4000-8000-000000000001 '
      'exists with unexpected values or production_ready <> true.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4–6. Floor tables (3 mesas)
-- ---------------------------------------------------------------------------

insert into public.pos_floor_tables (
  id,
  zone_id,
  name,
  capacity,
  x,
  y,
  manual_status,
  active
) values
  ('M-FEL-OPEN', 'fel_test_salon', 'M-FEL-OPEN', 4, 20, 50, 'disponible', true),
  ('M-FEL-PARTIAL', 'fel_test_salon', 'M-FEL-PARTIAL', 4, 50, 50, 'disponible', true),
  ('M-FEL-PAID', 'fel_test_salon', 'M-FEL-PAID', 4, 80, 50, 'disponible', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.pos_floor_tables
    where id = 'M-FEL-OPEN'
      and zone_id = 'fel_test_salon'
      and name = 'M-FEL-OPEN'
      and capacity = 4
      and x = 20
      and y = 50
      and manual_status = 'disponible'
      and active = true
  ) then
    raise exception
      'Fixture mismatch: pos_floor_tables id=M-FEL-OPEN exists with unexpected values.';
  end if;

  if not exists (
    select 1
    from public.pos_floor_tables
    where id = 'M-FEL-PARTIAL'
      and zone_id = 'fel_test_salon'
      and name = 'M-FEL-PARTIAL'
      and capacity = 4
      and x = 50
      and y = 50
      and manual_status = 'disponible'
      and active = true
  ) then
    raise exception
      'Fixture mismatch: pos_floor_tables id=M-FEL-PARTIAL exists with unexpected values.';
  end if;

  if not exists (
    select 1
    from public.pos_floor_tables
    where id = 'M-FEL-PAID'
      and zone_id = 'fel_test_salon'
      and name = 'M-FEL-PAID'
      and capacity = 4
      and x = 80
      and y = 50
      and manual_status = 'disponible'
      and active = true
  ) then
    raise exception
      'Fixture mismatch: pos_floor_tables id=M-FEL-PAID exists with unexpected values.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Cash register
-- ---------------------------------------------------------------------------

insert into public.cash_registers (
  id,
  name,
  status
) values (
  'fef00002-0000-4000-8000-000000000002'::uuid,
  'Caja FEL Stage',
  'active'
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.cash_registers
    where id = 'fef00002-0000-4000-8000-000000000002'::uuid
      and name = 'Caja FEL Stage'
      and status = 'active'
  ) then
    raise exception
      'Fixture mismatch: cash_registers id=fef00002-0000-4000-8000-000000000002 '
      'exists with unexpected values.';
  end if;
end $$;

commit;
