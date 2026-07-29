-- Postflight 199: catalog parity + differentiated errors.

select
  '199_postflight_catalog_image_url'::text as check_name,
  position('''image_url''' in pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure)) > 0 as ok,
  'batch image_url in catalog RPC'::text as detail;

select
  '199_postflight_catalog_production_area_name'::text as check_name,
  position('production_area_name' in pg_get_functiondef('public.get_station_pos_catalog(text)'::regprocedure)) > 0 as ok,
  'production_area_name in catalog RPC'::text as detail;

select
  '199_postflight_assert_owner_code'::text as check_name,
  position('STATION_POS_ORDER_OWNER_MISMATCH' in pg_get_functiondef(
    'public.station_pos_assert_order_open_for_drafts(uuid, uuid)'::regprocedure
  )) > 0 as ok,
  'owner mismatch code in assert'::text as detail;

select
  '199_postflight_open_reuse_owner_guard'::text as check_name,
  (
    select count(*) >= 2
    from regexp_matches(
      pg_get_functiondef('public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure),
      'STATION_POS_ORDER_OWNER_MISMATCH',
      'g'
    ) m
  ) as ok,
  'open reuse blocks foreign owner (both paths)'::text as detail;

select
  '199_postflight_catalog_acl'::text as check_name,
  has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE') as ok,
  'authenticated execute on catalog'::text as detail;

select
  '199_postflight_assert_not_public'::text as check_name,
  not has_function_privilege('authenticated', 'public.station_pos_assert_order_open_for_drafts(uuid, uuid)', 'EXECUTE') as ok,
  'assert remains internal'::text as detail;
