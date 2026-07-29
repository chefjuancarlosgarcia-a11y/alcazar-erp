-- Preflight 199: verify 198 applied before catalog parity patch.

select
  '199_preflight_198_catalog'::text as check_name,
  to_regprocedure('public.get_station_pos_catalog(text)') is not null as ok,
  'get_station_pos_catalog must exist from 198'::text as detail;

select
  '199_preflight_198_open'::text as check_name,
  to_regprocedure('public.open_station_pos_table_service(text, text, text, text, text, text)') is not null as ok,
  'open_station_pos_table_service must exist from 198'::text as detail;

select
  '199_preflight_flags_present'::text as check_name,
  exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled') as ok,
  'station POS flag row present'::text as detail;
