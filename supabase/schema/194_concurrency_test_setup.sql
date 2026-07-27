-- CC194 concurrency lab — SETUP (pestaña 0, una sola vez por corrida).
-- Crea fixture aislado cc194-*; no usa estación cash productiva ni su register operativo.
-- Requiere un profile_id activo solo como FK (sin Auth user nuevo). Ver comentario abajo.
-- Ejecutar completo; termina en COMMIT. Luego pestaña A → B → verify/cleanup.

begin;

do $$
begin
  if exists (
    select 1 from public.operational_stations where station_code = 'cc194-conc-lab'
  ) then
    raise exception
      'CC194 setup: fixture cc194-conc-lab ya existe. Ejecute 194_concurrency_test_cleanup_only.sql y reintente.';
  end if;

  if exists (
    select 1 from public.operational_station_devices
    where id = '19400000-0000-4000-8000-000000000003'::uuid
  ) then
    raise exception
      'CC194 setup: dispositivo lab cc194 ya existe. Ejecute 194_concurrency_test_cleanup_only.sql y reintente.';
  end if;

  if to_regclass('public.cc194_concurrency_lab') is not null then
    raise exception
      'CC194_SETUP_ALREADY_EXISTS: cc194_concurrency_lab. Ejecute 194_concurrency_test_cleanup_only.sql.';
  end if;

  if to_regclass('public.cc194_concurrency_heartbeat') is not null then
    raise exception
      'CC194_SETUP_ALREADY_EXISTS: cc194_concurrency_heartbeat. Ejecute 194_concurrency_test_cleanup_only.sql.';
  end if;

  if exists (
    select 1 from public.operational_station_cash_idempotency
    where idempotency_key like 'cc194-conc-%'
  ) then
    raise exception
      'CC194 setup: filas idempotency cc194 pendientes. Ejecute 194_concurrency_test_cleanup_only.sql antes de setup.';
  end if;
end;
$$;

create table if not exists public.cc194_concurrency_lab (
  singleton boolean primary key default true,
  constraint cc194_lab_singleton check (singleton is true),
  device_id uuid not null,
  station_id uuid not null,
  operator_session_id uuid not null,
  idempotency_key text not null,
  operation text not null,
  fingerprint text not null,
  fingerprint_alt text not null,
  mutation_count int not null default 0
);

create table if not exists public.cc194_concurrency_heartbeat (
  worker text primary key,
  constraint cc194_hb_worker check (worker in ('A', 'B')),
  phase text not null,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

truncate public.cc194_concurrency_lab;
truncate public.cc194_concurrency_heartbeat;

do $$
declare
  v_register_id uuid := '19400000-0000-4000-8000-000000000001'::uuid;
  v_station_id uuid := '19400000-0000-4000-8000-000000000002'::uuid;
  v_device_id uuid := '19400000-0000-4000-8000-000000000003'::uuid;
  v_session_id uuid := '19400000-0000-4000-8000-000000000004'::uuid;
  v_profile_id uuid;
  v_key text := 'cc194-conc-key-001';
  v_op text := 'conc_lab';
  v_payload jsonb := jsonb_build_object('cc194', 'mut0', 'amount', 0.01);
  v_fp text;
  v_fp_alt text;
begin
  -- Ancla FK: primer profile activo sin sesión humana de caja abierta (no modifica su caja).
  select p.id into v_profile_id
  from public.profiles p
  where p.status = 'active'
    and not exists (
      select 1 from public.cash_sessions cs
      where cs.opened_by = p.id and cs.status = 'open'
    )
  order by p.created_at
  limit 1;

  if v_profile_id is null then
    raise exception
      'CC194 setup: no hay profile activo disponible sin cash_sessions abiertas. '
      'Cierre sesiones humanas de prueba o use un profile de laboratorio dedicado.';
  end if;

  insert into public.cash_registers (id, name, location, status)
  values (v_register_id, 'CC194 Test Register', 'cc194-lab', 'active')
  on conflict (id) do update
  set name = excluded.name, location = excluded.location, status = excluded.status;

  insert into public.operational_stations (
    id, station_code, name, station_type, status, cash_register_id, identity_mode
  ) values (
    v_station_id, 'cc194-conc-lab', 'CC194 Concurrency Lab', 'cash', 'active', v_register_id, 'individual'
  );

  insert into public.operational_station_devices (
    id, station_id, device_label, status, activated_at
  ) values (
    v_device_id, v_station_id, 'cc194-conc-device', 'active', now()
  );

  v_fp := public.station_cash_request_fingerprint(v_op, v_payload);
  v_fp_alt := public.station_cash_request_fingerprint(
    v_op, v_payload || jsonb_build_object('cc194', 'mut1')
  );

  insert into public.operational_operator_sessions (
    id,
    operational_station_device_id,
    operational_station_id,
    operator_profile_id,
    module,
    session_token_hash,
    idle_expires_at
  ) values (
    v_session_id,
    v_device_id,
    v_station_id,
    v_profile_id,
    'cash',
    encode(extensions.digest('cc194-lab-token-do-not-use-in-prod', 'sha256'), 'hex'),
    now() + interval '2 hours'
  );

  insert into public.cc194_concurrency_lab (
    singleton, device_id, station_id, operator_session_id,
    idempotency_key, operation, fingerprint, fingerprint_alt, mutation_count
  ) values (
    true, v_device_id, v_station_id, v_session_id,
    v_key, v_op, v_fp, v_fp_alt, 0
  );
end;
$$;

commit;

select
  'cc194_setup_ok'::text as status,
  s.station_code,
  d.device_label,
  l.idempotency_key,
  l.operation,
  l.mutation_count,
  'next: pestaña A — 194_concurrency_test_worker_a.sql'::text as next_step
from public.cc194_concurrency_lab l
join public.operational_stations s on s.id = l.station_id
join public.operational_station_devices d on d.id = l.device_id;
