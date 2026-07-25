# OS1 — notas de implementación local

## Preproducción (futuro, no ejecutado)

1. Revisar diff `190_operational_stations_foundation.sql` + rollback + Edge `operational-station-enroll`.
2. Aplicar migración en staging Supabase; ejecutar `190_test_operational_stations_foundation.sql`.
3. Desplegar Edge Function con secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `OPERATIONAL_STATION_ENROLL_ORIGINS` (allowlist CORS).
4. Smoke: admin crea estación → enrollment → claim → authorize → complete → `get_operational_station_device_context`.
5. Mantener `operational_stations_enabled=false` en prod hasta OS3+.

## Rollback forward-only

Ver `supabase/rollback/190_operational_stations_foundation.rollback.sql`: flag off, revoke devices, revoke RPC grants; ban Auth users manualmente.

## Rate limiting

- **Secundario (Edge):** ventana in-memory por instancia; defensa local, insuficiente multi-instancia en producción.
- **Primario (PostgreSQL):** `device_claim_attempt_count` + `device_claim_locked_until` vía `record_operational_enrollment_secret_attempt` (10 fallos → lock 15 min). No usa buckets OS2.

## Claim secret rotado

Tras claim, el dispositivo demuestra posesión con `device_claim_secret` (256 bits, Edge). PostgreSQL guarda solo `claim_secret_hash`, `claim_secret_expires_at`, `claim_secret_consumed_at` en `operational_station_devices`. Navegador: solo `sessionStorage` de la pestaña hasta complete/error.

## Compensación Auth ↔ PG (complete en Edge)

Orden: **createUser → signInWithPassword → finalize_station_device_enrollment** (consume claim secret, activa device).

- createUser OK + signIn falla → `deleteUser` + `fail_station_device_enrollment` (device pending).
- signIn OK + finalize falla → `deleteUser` + fail enrollment; **no** tokens al navegador.
- Enrollment `completed` → replay rechazado; sin reentrega de sesión.
- Contraseña técnica solo en memoria Edge durante `complete`.

## Lifecycle enrollment

`pending → claimed → authorized → completed`
Ramificaciones: `blocked`, `revoked`, `failed`, `expired`. Dispositivo `pending` hasta `complete` exitoso.
