-- Tests for 197 (apply migration first). BEGIN … ROLLBACK.

begin;

create or replace function public.test_operational_pin_module_station_type_197()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.verify_operational_pin_for_device(text, text, text)'::regprocedure);

  return query select 'column_absolute_expires_at'::text,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'operational_operator_sessions'
        and column_name = 'absolute_expires_at'
    ),
    'additive session cap column'::text;

  return query select 'verify_required_module_mapping'::text,
    v_def ilike '%v_required_module%' and v_def ilike '%v_station.station_type%',
    'station_type drives module'::text;

  return query select 'verify_rejects_client_module_mismatch'::text,
    v_def ilike '%p_module%' and v_def ilike '%v_required_module%',
    'client module must match station'::text;

  return query select 'verify_pos_idle_120'::text,
    v_def ilike '%when ''pos'' then 120%',
    'POS idle seconds'::text;

  return query select 'verify_pos_absolute_cap'::text,
    v_def ilike '%absolute_expires_at%' and v_def ilike '%15 minutes%',
    'POS absolute session cap on insert'::text;

  return query select 'verify_generic_pin_error'::text,
    v_def ilike '%PIN o acceso no valido.%',
    'generic PIN failure preserved'::text;
end;
$$;

revoke all on function public.test_operational_pin_module_station_type_197() from public, anon, authenticated;
grant execute on function public.test_operational_pin_module_station_type_197() to service_role;

select scenario, passed, detail from public.test_operational_pin_module_station_type_197() order by scenario;

select count(*) as total,
  count(*) filter (where passed) as passed_total,
  count(*) filter (where not passed) as failed_total
from public.test_operational_pin_module_station_type_197();

drop function if exists public.test_operational_pin_module_station_type_197();

rollback;
