-- CC194 concurrency — Worker B (pestaña 2). Ejecutar mientras A está en holding_lock (~8s).
-- Bloquea en station_cash_idempotency_begin hasta que A haga COMMIT; debe recibir el mismo completed.

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
  v_a jsonb;
begin
  select device_id, station_id, operator_session_id, idempotency_key, operation, fingerprint
  into v_device, v_station, v_session, v_key, v_op, v_fp
  from public.cc194_concurrency_lab
  where singleton is true;

  if v_device is null then
    raise exception 'CC194: ejecute setup primero';
  end if;

  insert into public.cc194_concurrency_heartbeat (worker, phase, detail, updated_at)
  values ('B', 'waiting_on_a_lock', jsonb_build_object('key', v_key), now())
  on conflict (worker) do update
  set phase = excluded.phase, detail = excluded.detail, updated_at = excluded.updated_at;

  v_begin := public.station_cash_idempotency_begin(
    v_device, v_station, v_session, v_key, v_op, v_fp
  );

  if v_begin is null then
    raise exception 'Worker B: se esperaba resultado completed tras A, obtuvo NULL (segunda mutación?)';
  end if;

  if coalesce(v_begin ->> 'idempotency_status', '') <> 'completed' then
    raise exception 'Worker B: status inesperado %', v_begin;
  end if;

  select result into v_a
  from public.operational_station_cash_idempotency
  where device_id = v_device and idempotency_key = v_key;

  if v_a is distinct from v_begin then
    raise exception 'Worker B: begin JSON distinto de fila idempotency';
  end if;

  insert into public.cc194_concurrency_heartbeat (worker, phase, detail, updated_at)
  values ('B', 'replay_ok', jsonb_build_object('status', v_begin ->> 'idempotency_status'), now())
  on conflict (worker) do update
  set phase = excluded.phase, detail = excluded.detail, updated_at = excluded.updated_at;
end;
$$;

commit;

select worker, phase, updated_at
from public.cc194_concurrency_heartbeat
where worker = 'B';
