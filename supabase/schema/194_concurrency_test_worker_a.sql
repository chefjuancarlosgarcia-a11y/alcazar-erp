-- CC194 concurrency — Worker A (pestaña 1). Ejecutar PRIMERO.
-- Deja la transacción abierta ~8s (FOR UPDATE en idempotency). NO refrescar esta pestaña hasta COMMIT.
-- Cuando vea phase=holding_lock en heartbeat (pestaña 0 consulta), ejecute Worker B en pestaña 2.

begin;

do $$
declare
  v_device uuid;
  v_station uuid;
  v_session uuid;
  v_key text;
  v_op text;
  v_fp text;
  v_begin jsonb;
  v_rows int;
begin
  select device_id, station_id, operator_session_id, idempotency_key, operation, fingerprint
  into v_device, v_station, v_session, v_key, v_op, v_fp
  from public.cc194_concurrency_lab
  where singleton is true;

  if v_device is null then
    raise exception 'CC194: ejecute 194_concurrency_test_setup.sql primero';
  end if;

  insert into public.cc194_concurrency_heartbeat (worker, phase, detail, updated_at)
  values ('A', 'starting', jsonb_build_object('key', v_key), now())
  on conflict (worker) do update
  set phase = excluded.phase, detail = excluded.detail, updated_at = excluded.updated_at;

  v_begin := public.station_cash_idempotency_begin(
    v_device, v_station, v_session, v_key, v_op, v_fp
  );

  if v_begin is not null then
    raise exception 'Worker A: se esperaba reserva nueva, obtuvo completed/replay: %', v_begin;
  end if;

  update public.cc194_concurrency_lab
  set mutation_count = mutation_count + 1
  where singleton is true;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Worker A: mutation_count no actualizado';
  end if;

  insert into public.cc194_concurrency_heartbeat (worker, phase, detail, updated_at)
  values (
    'A',
    'holding_lock',
    jsonb_build_object('key', v_key, 'sleep_seconds', 8, 'hint', 'ejecute worker_b ahora'),
    now()
  )
  on conflict (worker) do update
  set phase = excluded.phase, detail = excluded.detail, updated_at = excluded.updated_at;

  perform pg_sleep(8);

  perform public.station_cash_idempotency_complete(
    v_device,
    v_key,
    jsonb_build_object('cc194', 'completed', 'winner', 'A', 'mutation_count', 1)
  );

  insert into public.cc194_concurrency_heartbeat (worker, phase, detail, updated_at)
  values ('A', 'committed', jsonb_build_object('key', v_key), now())
  on conflict (worker) do update
  set phase = excluded.phase, detail = excluded.detail, updated_at = excluded.updated_at;
end;
$$;

commit;

select worker, phase, updated_at
from public.cc194_concurrency_heartbeat
where worker = 'A';
