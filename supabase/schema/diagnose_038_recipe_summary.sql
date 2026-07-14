select jsonb_build_object(
  'has_set_standard_recipe_output_inventory_item',
  exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'set_standard_recipe_output_inventory_item'
  ),
  'has_create_internal_production_output_item',
  exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'create_internal_production_output_item'
  ),
  'has_production_batches_table',
  to_regclass('public.production_batches') is not null,
  'has_output_inventory_item_column',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'standard_recipes' and column_name = 'output_inventory_item_id'
  ),
  'moises_profile',
  (
    select jsonb_build_object(
      'id', id,
      'email', email,
      'full_name', full_name,
      'role', role,
      'status', status,
      'area_id', area_id
    )
    from public.profiles
    where lower(coalesce(full_name, username, email, '')) like '%mois%'
    limit 1
  ),
  'pesto_recipe',
  (
    select jsonb_build_object(
      'id', id,
      'name', name,
      'production_area_id', production_area_id,
      'output_inventory_item_id', output_inventory_item_id,
      'updated_at', updated_at
    )
    from public.standard_recipes
    where id = '31c485f6-7102-45e3-9638-ad0f880b135e'
  )
) as audit_038_recipe_state;
