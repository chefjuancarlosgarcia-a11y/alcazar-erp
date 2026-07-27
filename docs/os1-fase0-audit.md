# OS1 Fase 0 — auditoría previa (local)

**Worktree:** `C:\Users\chefj\alcazar-inventario-os1`
**Branch:** `feat/operational-stations-os1` @ `origin/main` (`6ea392b0…`)
**Migración OS1:** `190_operational_stations_foundation.sql` (188–189 reservadas; sin conflicto en repo)

| Reutilizado | Nuevo OS1 |
|-------------|-----------|
| `public.areas`, `cash_registers`, `profiles` | `operational_stations`, `operational_station_devices`, `operational_station_enrollment_tokens`, `operational_station_events` |
| `app_settings` (flag) | RPC OS1 §20, Edge `operational-station-enroll` |
| Patrones `059` attendance devices / admin UI | `/settings/operational-stations`, `/station-enroll` |
| `normalize_profile_role`, gates admin/gerente | Helpers `is_operational_stations_admin` |

**Conflictos:** ninguno material vs doc v1.0.1. Estación usa `active/inactive/revoked` (+ `draft` provisioning) alineado al brief OS1.

**Archivos previstos:** ver entrega final del agente.
