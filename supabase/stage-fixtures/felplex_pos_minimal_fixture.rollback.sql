-- FELplex Stage — rollback for felplex_pos_minimal_fixture.sql (7 rows).
-- Manual execution in the privileged Supabase Stage SQL Editor.
-- Deletes ONLY deterministic fixture IDs; does NOT touch FEL config or profiles.

begin;

select pg_advisory_xact_lock(hashtext('felplex_pos_minimal_fixture'));

-- ---------------------------------------------------------------------------
-- Safety guards (same as apply script)
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
      'Refusing rollback: fel_emission_config id=1 not in safe Stage state '
      '(environment=stage, emission_enabled=false, auto_issue_paid_orders=false, '
      'formal_contingency_enabled=false).';
  end if;

  if exists (select 1 from public.pos_fel_documents) then
    raise exception 'Refusing rollback: pos_fel_documents is not empty.';
  end if;

  if exists (select 1 from public.pos_fel_attempts) then
    raise exception 'Refusing rollback: pos_fel_attempts is not empty.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Exact fixture identity (IS DISTINCT FROM; abort if id exists with wrong values)
-- ---------------------------------------------------------------------------

do $$
declare
  v_product_id uuid := 'fef00001-0000-4000-8000-000000000001'::uuid;
  v_cash_register_id uuid := 'fef00002-0000-4000-8000-000000000002'::uuid;
  v_table_ids text[] := array['M-FEL-OPEN', 'M-FEL-PARTIAL', 'M-FEL-PAID'];
begin
  if exists (
    select 1
    from public.areas
    where id = 'fel_test_cocina'
      and (
        name is distinct from 'Cocina FEL Test'
        or type is distinct from 'produccion'
        or is_production_area is distinct from true
        or active is distinct from true
      )
  ) then
    raise exception
      'Rollback blocked: areas id=fel_test_cocina exists with non-fixture values.';
  end if;

  if exists (
    select 1
    from public.pos_floor_zones
    where id = 'fel_test_salon'
      and (
        name is distinct from 'Salón FEL Test'
        or active is distinct from true
      )
  ) then
    raise exception
      'Rollback blocked: pos_floor_zones id=fel_test_salon exists with non-fixture values.';
  end if;

  if exists (
    select 1
    from public.pos_products
    where id = v_product_id
      and (
        name is distinct from 'Producto FEL Test'
        or price is distinct from 148.50
        or category_id is distinct from 'extras'
        or production_area_id is distinct from 'fel_test_cocina'
        or active is distinct from true
        or is_test_item is distinct from true
        or product_type is distinct from 'manual_test'
        or production_ready is distinct from true
      )
  ) then
    raise exception
      'Rollback blocked: pos_products fixture id exists with non-fixture values.';
  end if;

  if exists (
    select 1
    from public.pos_floor_tables
    where id = 'M-FEL-OPEN'
      and (
        name is distinct from 'M-FEL-OPEN'
        or zone_id is distinct from 'fel_test_salon'
        or capacity is distinct from 4
        or x is distinct from 20
        or y is distinct from 50
        or manual_status is distinct from 'disponible'
        or active is distinct from true
      )
  ) then
    raise exception
      'Rollback blocked: pos_floor_tables id=M-FEL-OPEN exists with non-fixture values.';
  end if;

  if exists (
    select 1
    from public.pos_floor_tables
    where id = 'M-FEL-PARTIAL'
      and (
        name is distinct from 'M-FEL-PARTIAL'
        or zone_id is distinct from 'fel_test_salon'
        or capacity is distinct from 4
        or x is distinct from 50
        or y is distinct from 50
        or manual_status is distinct from 'disponible'
        or active is distinct from true
      )
  ) then
    raise exception
      'Rollback blocked: pos_floor_tables id=M-FEL-PARTIAL exists with non-fixture values.';
  end if;

  if exists (
    select 1
    from public.pos_floor_tables
    where id = 'M-FEL-PAID'
      and (
        name is distinct from 'M-FEL-PAID'
        or zone_id is distinct from 'fel_test_salon'
        or capacity is distinct from 4
        or x is distinct from 80
        or y is distinct from 50
        or manual_status is distinct from 'disponible'
        or active is distinct from true
      )
  ) then
    raise exception
      'Rollback blocked: pos_floor_tables id=M-FEL-PAID exists with non-fixture values.';
  end if;

  if exists (
    select 1
    from public.cash_registers
    where id = v_cash_register_id
      and (
        name is distinct from 'Caja FEL Stage'
        or status is distinct from 'active'
      )
  ) then
    raise exception
      'Rollback blocked: cash_registers fixture id exists with non-fixture values.';
  end if;

  -- Zone CASCADE guard: pos_floor_tables.zone_id → pos_floor_zones ON DELETE CASCADE
  if exists (
    select 1
    from public.pos_floor_tables
    where zone_id = 'fel_test_salon'
      and not (id = any (v_table_ids))
  ) then
    raise exception
      'Rollback blocked: pos_floor_tables contains non-fixture rows in zone fel_test_salon '
      '(zone delete would CASCADE to foreign tables).';
  end if;

  -- Area guard: no other products may reference fel_test_cocina
  if exists (
    select 1
    from public.pos_products
    where production_area_id = 'fel_test_cocina'
      and id is distinct from v_product_id
  ) then
    raise exception
      'Rollback blocked: other pos_products reference production_area_id=fel_test_cocina.';
  end if;

  -- -------------------------------------------------------------------------
  -- Incoming FK guards — pos_floor_tables.id (no DB FK; pos_orders.table_id is text)
  -- -------------------------------------------------------------------------

  if exists (
    select 1
    from public.pos_orders
    where table_id = any (v_table_ids)
  ) then
    raise exception
      'Rollback blocked: fixture tables referenced by pos_orders.table_id.';
  end if;

  -- -------------------------------------------------------------------------
  -- Incoming FK guards — pos_products.id
  -- -------------------------------------------------------------------------

  if exists (
    select 1 from public.pos_order_items where product_id = v_product_id
  ) then
    raise exception
      'Rollback blocked: fixture product referenced by pos_order_items (NO ACTION).';
  end if;

  if exists (
    select 1 from public.production_ticket_items where product_id = v_product_id
  ) then
    raise exception
      'Rollback blocked: fixture product referenced by production_ticket_items (NO ACTION).';
  end if;

  if exists (
    select 1 from public.pos_option_groups where product_id = v_product_id
  ) then
    raise exception
      'Rollback blocked: fixture product referenced by pos_option_groups (ON DELETE CASCADE).';
  end if;

  if exists (
    select 1 from public.pos_product_modifiers where product_id = v_product_id
  ) then
    raise exception
      'Rollback blocked: fixture product referenced by pos_product_modifiers (ON DELETE CASCADE).';
  end if;

  if exists (
    select 1 from public.pos_product_variants where product_id = v_product_id
  ) then
    raise exception
      'Rollback blocked: fixture product referenced by pos_product_variants (ON DELETE CASCADE).';
  end if;

  if exists (
    select 1 from public.pos_inventory_deduction_skips where product_id = v_product_id
  ) then
    raise exception
      'Rollback blocked: fixture product referenced by pos_inventory_deduction_skips (ON DELETE SET NULL).';
  end if;

  -- -------------------------------------------------------------------------
  -- Incoming FK guards — cash_registers.id
  -- -------------------------------------------------------------------------

  if exists (
    select 1 from public.cash_sessions where cash_register_id = v_cash_register_id
  ) then
    raise exception
      'Rollback blocked: fixture cash register referenced by cash_sessions (NO ACTION).';
  end if;

  if exists (
    select 1 from public.cash_movements where cash_register_id = v_cash_register_id
  ) then
    raise exception
      'Rollback blocked: fixture cash register referenced by cash_movements (NO ACTION).';
  end if;

  if exists (
    select 1 from public.operational_stations where cash_register_id = v_cash_register_id
  ) then
    raise exception
      'Rollback blocked: fixture cash register referenced by operational_stations (ON DELETE RESTRICT).';
  end if;

  -- -------------------------------------------------------------------------
  -- Incoming FK guards — areas.id
  -- -------------------------------------------------------------------------

  if exists (
    select 1 from public.area_inventory where area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by area_inventory (NO ACTION).';
  end if;

  if exists (
    select 1 from public.assigned_tasks where area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by assigned_tasks (ON DELETE SET NULL).';
  end if;

  if exists (
    select 1 from public.bakery_production_batches where destination_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by bakery_production_batches (ON DELETE SET NULL).';
  end if;

  if exists (
    select 1 from public.bakery_production_plan_items where destination_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by bakery_production_plan_items (ON DELETE SET NULL).';
  end if;

  if exists (
    select 1 from public.inventory_movements where from_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by inventory_movements.from_area_id (NO ACTION).';
  end if;

  if exists (
    select 1 from public.inventory_movements where to_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by inventory_movements.to_area_id (NO ACTION).';
  end if;

  if exists (
    select 1 from public.operational_stations where area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by operational_stations (ON DELETE RESTRICT).';
  end if;

  if exists (
    select 1 from public.pos_order_items where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by pos_order_items.production_area_id (NO ACTION).';
  end if;

  if exists (
    select 1 from public.pos_product_variants where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by pos_product_variants.production_area_id (NO ACTION).';
  end if;

  if exists (
    select 1 from public.pos_recipe_consumptions where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by pos_recipe_consumptions (NO ACTION).';
  end if;

  if exists (
    select 1 from public.production_batches where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by production_batches (NO ACTION).';
  end if;

  if exists (
    select 1 from public.production_tickets where area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by production_tickets (NO ACTION).';
  end if;

  if exists (
    select 1 from public.requisitions where from_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by requisitions.from_area_id (NO ACTION).';
  end if;

  if exists (
    select 1 from public.requisitions where to_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by requisitions.to_area_id (NO ACTION).';
  end if;

  if exists (
    select 1 from public.standard_recipes where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by standard_recipes (NO ACTION).';
  end if;

  if exists (
    select 1 from public.task_labels where area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by task_labels (ON DELETE SET NULL).';
  end if;

  if exists (
    select 1 from public.user_production_areas where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by user_production_areas (ON DELETE CASCADE).';
  end if;

  if exists (
    select 1 from public.yield_audits where production_area_id = 'fel_test_cocina'
  ) then
    raise exception
      'Rollback blocked: fixture area referenced by yield_audits (NO ACTION).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Deletes (reverse dependency order; plain DELETE only — no explicit CASCADE)
-- ---------------------------------------------------------------------------

delete from public.pos_floor_tables
where id in ('M-FEL-OPEN', 'M-FEL-PARTIAL', 'M-FEL-PAID');

delete from public.pos_floor_zones
where id = 'fel_test_salon';

delete from public.pos_products
where id = 'fef00001-0000-4000-8000-000000000001'::uuid;

delete from public.cash_registers
where id = 'fef00002-0000-4000-8000-000000000002'::uuid;

delete from public.areas
where id = 'fel_test_cocina';

commit;
