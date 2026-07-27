-- CC194 concurrency — VERIFY + conflict probe + CLEANUP (tras Worker A y B).
-- Capturar/exportar el result set de verificación ANTES de que el bloque cleanup borre datos.
-- Si el lab no existe: fila cc194_lab_missing_use_cleanup_only (sin 42P01); cleanup sigue al final.

begin;

create or replace function public.cc194_concurrency_verify()
returns table(
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid;
  v_station uuid;
  v_session uuid;
  v_key text;
  v_op text;
  v_fp text;
  v_fp_alt text;
  v_count int;
  v_mut int;
  v_row jsonb;
  v_err text;
begin
  if to_regclass('public.cc194_concurrency_lab') is null then
    return query select 'cc194_lab_missing_use_cleanup_only'::text, false,
      'Ejecute 194_concurrency_test_cleanup_only.sql antes de setup'::text;
    return;
  end if;

  if not exists (select 1 from public.cc194_concurrency_lab where singleton is true) then
    return query select 'cc194_lab_missing_use_cleanup_only'::text, false,
      'Lab vacío: use cleanup_only'::text;
    return;
  end if;

  select device_id, station_id, operator_session_id, idempotency_key, operation, fingerprint, fingerprint_alt, mutation_count
  into v_device, v_station, v_session, v_key, v_op, v_fp, v_fp_alt, v_mut
  from public.cc194_concurrency_lab
  where singleton is true;

  return query select 'isolated_station_code'::text,
    v_device is not null
    and (select s.station_code from public.operational_stations s where s.id = v_station) = 'cc194-conc-lab',
    coalesce((select s.station_code from public.operational_stations s where s.id = v_station), 'missing')::text;

  select count(*)::int into v_count
  from public.operational_station_cash_idempotency
  where device_id = v_device and idempotency_key = v_key;

  return query select 'single_idempotency_row'::text, v_count = 1, v_count::text;

  select result into v_row
  from public.operational_station_cash_idempotency
  where device_id = v_device and idempotency_key = v_key;

  return query select 'idempotency_completed'::text,
    coalesce(v_row ->> 'idempotency_status', '') = 'completed',
    coalesce(v_row ->> 'idempotency_status', 'missing')::text;

  return query select 'single_lab_mutation'::text, v_mut = 1, v_mut::text;

  return query select 'worker_a_committed'::text,
    exists (select 1 from public.cc194_concurrency_heartbeat h where h.worker = 'A' and h.phase = 'committed'),
    'heartbeat A'::text;

  return query select 'worker_b_replay_ok'::text,
    exists (select 1 from public.cc194_concurrency_heartbeat h where h.worker = 'B' and h.phase = 'replay_ok'),
    'heartbeat B'::text;

  begin
    perform public.station_cash_idempotency_begin(
      v_device, v_station, v_session, v_key, v_op, v_fp_alt
    );
    return query select 'conflict_fingerprint_raises'::text, false, 'no exception'::text;
  exception
    when others then
      v_err := sqlerrm;
      return query select 'conflict_fingerprint_raises'::text,
        v_err like 'Conflicto de idempotencia:%',
        left(v_err, 120)::text;
  end;
end;
$$;

with results as materialized (
  select * from public.cc194_concurrency_verify()
),
summary as (
  select
    count(*)::int as total,
    count(*) filter (where passed)::int as passed_total,
    count(*) filter (where not passed)::int as failed_total,
    (count(*) filter (where not passed) > 0) as cleanup_required
  from results
)
select
  r.scenario,
  r.passed,
  r.detail,
  s.total,
  s.passed_total,
  s.failed_total,
  s.cleanup_required
from results r
cross join summary s
order by r.passed asc, r.scenario;

drop function if exists public.cc194_concurrency_verify();

-- Cleanup fixture (misma lógica que 194_concurrency_test_cleanup_only.sql)
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

commit;

select 'cc194_cleanup_done'::text as status, false as cleanup_required;
