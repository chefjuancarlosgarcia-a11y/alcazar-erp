-- CC194 — cleanup idempotente (sin verificación). Usar tras fallo de setup o para resetear lab.
-- Funciona aunque no existan tablas cc194_* ni fixtures. BEGIN/COMMIT únicos.

begin;

do $$
declare
  v_register uuid := '19400000-0000-4000-8000-000000000001'::uuid;
  v_station uuid := '19400000-0000-4000-8000-000000000002'::uuid;
  v_device uuid := '19400000-0000-4000-8000-000000000003'::uuid;
  v_session uuid := '19400000-0000-4000-8000-000000000004'::uuid;
begin
  if exists (select 1 from public.cash_registers where id = v_register)
     and not exists (
       select 1 from public.cash_registers
       where id = v_register and name = 'CC194 Test Register'
     ) then
    raise exception
      'CC194 cleanup abortado: cash_registers % existe con otro nombre (no es fixture lab).', v_register;
  end if;

  if exists (select 1 from public.operational_stations where id = v_station)
     and not exists (
       select 1 from public.operational_stations
       where id = v_station and station_code = 'cc194-conc-lab'
     ) then
    raise exception
      'CC194 cleanup abortado: operational_stations % existe con otro station_code.', v_station;
  end if;

  if exists (select 1 from public.operational_station_devices where id = v_device)
     and not exists (
       select 1 from public.operational_station_devices d
       join public.operational_stations s on s.id = d.station_id
       where d.id = v_device
         and d.device_label = 'cc194-conc-device'
         and s.id = v_station
         and s.station_code = 'cc194-conc-lab'
     ) then
    raise exception
      'CC194 cleanup abortado: operational_station_devices % no coincide con fixture lab.', v_device;
  end if;

  if exists (select 1 from public.operational_operator_sessions where id = v_session)
     and not exists (
       select 1 from public.operational_operator_sessions
       where id = v_session and operational_station_device_id = v_device
     ) then
    raise exception
      'CC194 cleanup abortado: operational_operator_sessions % no pertenece al device lab.', v_session;
  end if;

  delete from public.operational_station_cash_idempotency
  where device_id = v_device
    and idempotency_key like 'cc194-conc-%';

  delete from public.operational_operator_sessions
  where id = v_session
     or operational_station_device_id = v_device;

  delete from public.operational_station_devices
  where id = v_device;

  delete from public.operational_stations
  where id = v_station and station_code = 'cc194-conc-lab';

  delete from public.cash_registers
  where id = v_register and name = 'CC194 Test Register';

  drop table if exists public.cc194_concurrency_heartbeat;
  drop table if exists public.cc194_concurrency_lab;
end;
$$;

drop function if exists public.cc194_concurrency_verify();

commit;

select 'cc194_cleanup_done'::text as status, false as cleanup_required;
