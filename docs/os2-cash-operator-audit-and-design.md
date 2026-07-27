# OS2 — Auditoría pre-implementación y diseño (vertical slice Caja)

Estado: **local / sin aplicar remoto**. Flag `operational_stations_enabled` permanece `false`.

## Resumen ejecutivo

| Hallazgo | Severidad | Corrección propuesta |
|----------|-----------|----------------------|
| Tras enrollment, JWT técnico **no tiene fila en `profiles`** → `AuthContext` deja `user=null` y `ProtectedRoute` bloquea `/cash` | **Crítica** | Reconocer sesión de **dispositivo estación** vía `get_operational_station_device_context()` cuando `user_metadata.operational_station_device`; rutas `/station/*` con guard distinto |
| `Cashier.jsx` usa **localStorage** + perfil humano; `CashManagement` usa RPC `045` con **`auth.uid()` = profile** | **Alta (fase 2)** | Vertical slice Caja piloto sobre **CashManagement + RPC cash** con sesión operativa server-side; no reescribir arqueos |
| Cliente Supabase **único** en frontend | Media | Mantener un cliente; separar identidades por **operator session token** (sessionStorage) + JWT dispositivo; evitar login humano concurrente en mismo origen |
| No existen `operational_credentials` ni PIN operativo | Esperado | Migración **193** (nueva, post-192) |

El modelo **sesión operativa server-side** (dispositivo derivado de `auth.uid()`, operador derivado de PIN + asignación) es **viable** con la corrección de guard de dispositivo antes del shell Caja.

---

## A. `StationEnroll` — sesión técnica

- Claim secret: `sessionStorage` (`os1-device-claim-secret:{enrollmentId}:{deviceId}`).
- Fingerprint: `localStorage` `operationalStationClientFingerprint`.
- Tras `complete`: `clearDeviceClaimSecret` + `supabase.auth.setSession({ access_token, refresh_token })` en **`frontend/src/lib/supabase.js`** (persistencia Auth por defecto).
- Edge `complete` crea usuario Auth con `user_metadata: { operational_station_device: true, device_id }` y `finalize_station_device_enrollment` liga `auth_user_id`.

## B. Recarga del navegador post-enrollment

- JWT persiste en storage Auth.
- `loadProfileForSession` consulta `profiles` → **sin fila** → `profileError` “Tu usuario no tiene perfil…”.
- `/station-enroll` es ruta pública; no re-hidrata UI de enrollment.
- **No** hay llamada automática a `get_operational_station_device_context()` hoy.

## C. `AppRoutes` / `AuthContext`

- `isAuthenticated: Boolean(session && user)` — dispositivo técnicamente autenticado pero **no “autenticado”** para la app.
- `ProtectedRoute`: `session && !user && profileError` → pantalla de error + logout.
- `/station-enroll` fuera de `MainLayout`.

## D. Entrada a Caja hoy

| Ruta | Componente | Guard | Backend |
|------|------------|-------|---------|
| `/cash`, `/cashier` | `Cashier.jsx` | `module="cash"` + rol | localStorage (`utils/cashier.js`) |
| `/cash-control` | `CashManagement.jsx` | idem | `cashService` → `open_cash_session`, etc. |
| Roles | `cajero`, `caja`, `supervisor`, … | `ROLE_PERMISSIONS` | RPC `is_cash_operator()` exige `profiles.id = auth.uid()` |

## E. Identificación del cajero

- **Supabase:** `cash_sessions.opened_by/closed_by`, `cash_movements.created_by` = **`auth.uid()`** como profile UUID.
- **Cashier local:** `user.id` / `username` del perfil humano en AuthContext.
- Dispositivo técnico **no** es FK válida hacia `profiles`.

## F. Idle vs bloqueo inmediato (reglas de negocio OS2 Caja)

| Reinicia idle 90s (servidor `touch`) | Bloqueo operador inmediato |
|--------------------------------------|----------------------------|
| Interacción UI en shell Caja (teclas, navegación in-module) | Cobro exitoso |
| Heartbeat explícito mientras operador activo | Cierre de turno / cierre sesión caja |
| | Botón “Bloquear estación” |
| | Revocación dispositivo / estación inactive |
| | Expiración `idle_expires_at` |

**No** cerrar JWT dispositivo ni `cash_session` al bloquear operador.

## G. Cliente Supabase principal vs aislado

- **Un solo cliente** es aceptable si:
  - JWT dispositivo permanece en Auth storage.
  - Token sesión operador vive en **sessionStorage** (no localStorage).
  - No se mezcla login humano en el mismo browser del terminal (política operativa).
- Cliente aislado solo necesario si mismo PC alterna admin humano + terminal; **fuera de scope v1**.

## H. PIN no usable desde dispositivo no autorizado

- Verificación solo vía RPC/Edge con **`auth.uid()` = `operational_station_devices.auth_user_id`**, dispositivo `active`, estación `active`, tipo `cash`, `cash_register_id` presente.
- Cliente **no** envía `station_id` ni `operator_profile_id` como autoridad.
- Rate limit persistente por bucket (`device_id` + ventana).

## I. Atribución empleado con `auth.uid()` técnico

- Sesión operativa almacena `operator_profile_id`.
- Fase siguiente (post-foundation): wrappers RPC cash que aceptan contexto operativo validado (p. ej. `created_by = operator_profile_id` verificado contra sesión activa).
- Eventos `operational_station_events`: `actor_profile_id` = operador; dispositivo en `station_device_id`.

## J. Funciones que asumen `auth.uid()` humano (wrappers futuros)

- **Cash 045:** `is_cash_*`, `open_cash_session`, `create_cash_movement`, `close_cash_session`, `record_cash_sale`, RLS sesiones/movimientos.
- **POS 184/187:** ownership / lifecycle con `owner_profile_id`.
- **OS1 admin:** `is_operational_stations_admin`, authorize/revoke (admin profile).
- **Asistencia 019:** independiente; **no** reutilizar `attendance_credentials`.
- **Compatibles con JWT dispositivo hoy:** `get_operational_station_device_context`, `touch_operational_station_device_seen`.

---

## Diseño sesión operativa (193 + Edge)

### Tablas

1. `operational_credentials` — `profile_id`, `pin_hash` (crypt), `pin_lookup` (HMAC/pepper), `status`, intentos/bloqueo.
2. `operational_station_assignments` — `profile_id`, `station_id`, `active`, `assigned_by`.
3. `operational_operator_sessions` — device/station/operator, `module`, hashes de token, `idle_expires_at`, `revoked_at`.
4. `operational_pin_attempt_buckets` — rate limit multi-instancia.

### Flujo PIN (Caja)

1. Dispositivo presenta JWT (verify_jwt **true** en Edge `operational-station-access`).
2. Edge CORS estricto (misma allowlist que enroll).
3. `verify_pin` → RPC `verify_operational_pin_for_device(p_pin, p_module, p_idempotency_key)`:
   - Resuelve dispositivo desde `auth.uid()`.
   - Valida estación cash + caja.
   - Lookup PIN → verifica hash → asignación activa a estación.
   - Crea/renueva sesión operativa (90s idle), devuelve **token opaco** (solo hash en BD).
4. Frontend guarda token en sessionStorage; heartbeats/touch vía RPC autenticado como dispositivo.
5. `lock` revoca sesión operativa; JWT dispositivo intacto.

### RRHH

- RPC admin: generar/reset PIN (4 dígitos), mostrar **una vez** en UI.
- Asignación explícita estación Caja (`operational_station_assignments`).

### Próxima fase (no en 193 UI completa)

- Wrappers `open_cash_session_as_operator(...)` pasando `operator_profile_id` desde sesión validada.
- Integración POS/KDS/Producción: fuera de scope.

---

## Migración

- **`193_operational_operator_access_foundation.sql`** — tablas + RPC + extiende `get_operational_station_device_context` (`cash_register_id`).
- Test transaccional **`193_test_...sql`**, rollback **`supabase/rollback/193_...rollback.sql`**.

## Edge

- **`operational-station-access`** — `verify_jwt: true`, acciones `verify_pin`, `lock`, `touch`.

## Frontend (piloto)

- AuthContext: modo dispositivo estación.
- `/station/cash` — PIN + shell hacia `CashManagement`.
- RRHH: sección “Acceso operativo” en `ProfileManagement`.

---

## Estado remoto (read-only, contexto operador)

Según contexto confirmado: **1 estación** (`caja-principal-01`, cash, active), **1 dispositivo** active, flag **false**, E2E OS1 OK. **No se ejecutó SQL remoto en esta tarea.**

---

## Fase 2 — Integración Caja (local, migración 194)

**Decisión migración:** `193` sigue sin aplicar remoto; los wrappers cash van en **`194_station_cash_operator_wrappers.sql`** para revisar/aplicar en orden `193 → 194` sin mezclar PIN y finanzas en un solo diff.

### Matriz humana vs estación

| Operación | Humano (045) | Estación (194) | Actor en filas |
|-----------|--------------|----------------|----------------|
| Contexto / consulta | RLS + selects | `get_station_cash_context(token)` | — |
| Abrir turno | `open_cash_session(register, …)` | `open_station_cash_session(token, …)` | `opened_by` = **operator_profile_id** |
| Movimiento | `create_cash_movement(session, …)` | `create_station_cash_movement(token, …)` | `created_by` = **operator_profile_id**; `metadata` estación/dispositivo |
| Cobro POS efectivo | `record_cash_sale` / split 064 | `record_station_cash_sale(token, …)` (register fijo por estación) | idem + idempotencia por device |
| Cerrar turno | `close_cash_session` | `close_station_cash_session(token, …)` | `closed_by` = **operator_profile_id**; bloquea sesión operativa |
| Turno ya abierto | `Ya existe una caja abierta.` | **Igual** — sin toma silenciosa | — |
| Cierre por otro cajero | Solo opener o supervisor | **Igual** vía `can_close_session` | — |
| Otro cajero opera turno ajeno | Movimientos permitidos (045 no exige opener) | **Igual** en wrapper | `created_by` = quien ingresó PIN |

### UI

- Humano: `/cash-control` → `CashManagement` + `createHumanCashPort()` (sin cambios de ruta).
- Estación: `/station/cash` → PIN → `CashManagement` + `createStationCashPort(token)`.
- Bloqueo operador: `lock_operational_operator_session` / revocación en cobro y cierre; **no** `signOut` del JWT dispositivo.

### Apply futuro (no ejecutar aún)

1. `193_operational_operator_access_foundation.sql`
2. `194_station_cash_operator_wrappers.sql`
3. Deploy Edge `operational-station-access` con JWT verificado
4. RRHH: PIN + assignment a Caja Principal
5. Smoke en dispositivo enrolado
