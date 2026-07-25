# Diseño técnico — Sistema unificado de estaciones operativas

**Proyecto:** ERP El Gran Alcázar
**Versión:** 1.0.1 (revisión pre-OS1)
**Estado:** Diseño aprobado — **sin implementación**; revisión de decisiones y políticas normativas completada; **OS1 pendiente de aprobación explícita**
**Base:** `docs/operational-stations-current-state-audit.md`, diagnóstico remoto 2026-07-25, release `v0.6.0-pos-f0a-table-lifecycle` (`6ea392b0…`), migraciones 184–187
**Documento subordinado:** decisiones POS detalladas en `docs/pos-station-technical-design.md` (reutilización de seguridad PIN/enrollment/sesión donde aplique)

---

## 0. Resumen arquitectónico

Se introduce un **catálogo unificado** de estaciones operativas (`operational_stations`) con **dispositivos enrolados** (`operational_station_devices`), **identidad Auth técnica revocable** por dispositivo, **PIN operativo separado** de asistencia (`operational_credentials`), y **sesiones de operador** solo donde el negocio exige identidad individual (POS, Caja). KDS y Producción operan en **modo equipo** (device session persistente, sin operator session; KPI por área/turno/estación).

**Conservado sin duplicar:** `public.areas`, `user_production_areas`, `cash_registers`, `cash_sessions`, F0A `owner_profile_id`, lifecycle mesas 187, dominio asistencia (`attendance_*`).

**Rollout:** feature flags server-side `off | optional | required` por módulo; acceso personal legacy hasta enforcement; admin/gerencia/supervisor con **emergency access** auditado.

**Migraciones futuras:** reservar conceptualmente 188–189 (traslado mesa, pagos); **OS schema desde 190+** (confirmar siguiente número libre en repo antes de OS1).

---

## 1. Terminología obligatoria

| Término | Definición | Ejemplos |
|---------|------------|----------|
| **Área** | Función operativa o destino de tickets (lógica de negocio). | Cocina, Pizzería, Cafetería, Barra |
| **Estación** | Punto operativo **configurado** (POS/KDS/Caja/Producción). | POS Salón 1, KDS Pizzería Principal, Caja 1 |
| **Dispositivo** | Hardware **autorizado** para una estación (tablet/PC/pantalla). | Tablet enrolada en KDS Cocina Auxiliar |
| **Operador** | Persona identificada por **PIN operativo** cuando el módulo lo exige. | Mesero en POS, cajero en Caja |
| **Equipo** | Grupo que trabaja **colectivamente** en un área (KDS/Producción). | Equipo Pizzería en turno comida |
| **Supervisor** | Persona que autoriza acciones excepcionales con PIN (consumo único). | Cancelar ticket KDS, anulación caja |

**No** usar área, estación, dispositivo u operador como sinónimos.

---

## 2. Decisiones de negocio aprobadas (cerradas)

Las 40 decisiones del brief de producto quedan **normativas** para implementación. Resumen por tema:

- **Unificación:** POS, KDS, Caja, Producción bajo el mismo modelo estación + dispositivo + (opcional) operador/supervisor.
- **Cardinalidad v1:** 1 estación → máx. **1** `station_device` con `status = active`; historial de reemplazos; 2 pantallas = **2 estaciones** (ej. KDS Cocina Principal / Auxiliar).
- **Dispositivo:** enrolamiento individual; no fingerprint como autoridad; Auth técnica revocable; QR/código TTL 15 min; pending hasta Autorizar/Rechazar; rechazo → bloqueado sin DELETE; mismo enrollment no reutilizable si bloqueado.
- **PIN operativo:** 4 dígitos, generado sistema, único entre activos, mostrar una vez, nunca recuperar; **separado** de asistencia.
- **Modos:** dispositivo fija módulo/área; POS/Caja **individual**; KDS/Producción **equipo**; supervisor solo excepciones; KPI KDS por área/turno/equipo/estación (no “un cocinero produjo todo”).
- **Transición:** acceso personal permanece; station-only por módulo después; backend impone; no eliminar Auth users ni perfiles.
- **Persistencia legacy:** áreas, asignaciones producción, cajas/sesiones, F0A owner.

---

## 3. Extensión de `/production/areas`

**Ruta existente:** `/production/areas` (`ProductionAreasManagement.jsx`) — CRUD de filas en `areas` con `is_production_area`.

**Áreas activas observadas (remoto):** 7 — Cocina, Pizzería, Cafetería, Barra, Línea Caliente, Panadería, Repostería.

**Extensión (sin reemplazar pantalla):**

Cada tarjeta/fila de área muestra agregados (vía RPC/vista read-only):

- `station_count` (estaciones tipo `kds` o `production` ligadas al `area_id`)
- `active_device_count`
- `health_summary` (ej. todos online / alguno offline / pendientes enrollment)

**UI ejemplo:**

```text
Cocina
2 estaciones · 2 dispositivos activos · En línea
[Estaciones y dispositivos] [Editar] [Desactivar]
```

**Drill-down** (nueva subvista o drawer, misma ruta con `?areaId=`):

- Lista estaciones del área (nombre, dispositivo activo, status, last_seen, conexión).
- Acciones por estación: enrollment, revocar, reemplazar, eventos.
- `[+ Crear estación KDS en Cocina]` → prefill `station_type=kds`, `area_id=cocina`.

**Regla:** no convertir un área en un dispositivo; el área sigue siendo destino de tickets; la estación es el punto físico autorizado.

---

## 4. Administración central

**Ruta propuesta:** `/settings/operational-stations`
**Justificación:** `settings` ya existe en `AuthContext` para admin/gerencia; centraliza POS/KDS/Caja/Producción sin mezclar RRHH asistencia. Alternativa aceptable: `/operations-center/stations` si producto prefiere operaciones — **preferencia v1: settings** con permiso `is_operational_stations_admin()`.

**Listado columnas:** nombre, código (`station_code`), tipo, área o `cash_register_id`, dispositivo activo, estado estación, última conexión (`last_seen_at` del device activo), modo identidad (`individual` | `team`), operador actual (POS/Caja si aplica), `cash_session_id` abierta (Caja), acciones.

**Tipos v1:** `pos` | `kds` | `cash` | `production`

**Acciones:** crear, editar, activar/desactivar, generar enrollment, confirmar/rechazar pending, revocar, reemplazar, ver eventos/sesiones, “Abrir estación” (deep link shell).

**Filtros:** tipo, área, estado, dispositivo, conexión (online/offline threshold ej. 5 min sin heartbeat).

**Permisos:** admin, gerente_general (full); supervisor (read + enrollment approve según política); RRHH **sin** gestión de estaciones operativas por defecto.

---

## 5. Modelo de datos

### 5.1 `operational_stations`

| Aspecto | Diseño |
|---------|--------|
| **Propósito** | Catálogo de estaciones lógicas operativas. |
| **PK** | `id uuid` |
| **Columnas** | `station_code text unique`, `name text`, `station_type text check (pos,kds,cash,production)`, `status text check (draft,active,disabled)`, `area_id text null references areas(id)`, `cash_register_id uuid null references cash_registers`, `pos_floor_zone text null`, `identity_mode text check (individual,team) default by type`, `settings jsonb default '{}'`, `created_at`, `updated_at`, `created_by`, `disabled_at`, `disabled_by` |
| **UNIQUE** | `station_code`; partial unique `(area_id, name)` where active optional |
| **Índices** | `(station_type, status)`, `(area_id)`, `(cash_register_id)` |
| **CHECK** | KDS/production → `area_id` not null; cash → `cash_register_id` not null; POS → area optional |
| **ON DELETE** | area/register: restrict if stations active |
| **RLS** | managers read; admins write |
| **Sensible** | no secrets |

**Transiciones estación:** `draft → active → disabled` (disabled no borra historial).

---

### 5.2 `operational_station_devices`

| Aspecto | Diseño |
|---------|--------|
| **Propósito** | Dispositivo físico vinculado a estación; historial de reemplazos. |
| **PK** | `id uuid` |
| **FK** | `station_id → operational_stations`, `auth_user_id uuid null` (Auth técnica) |
| **Columnas** | `device_label text`, `status text check (pending,active,rejected,blocked,revoked,replaced)`, `user_agent_summary text`, `enrollment_id uuid null`, `activated_at`, `revoked_at`, `replaced_by_device_id uuid null`, `last_seen_at`, `last_ip`, `connection_state text check (online,offline,unknown)`, `blocked_reason text`, `blocked_by`, `metadata jsonb` |
| **UNIQUE** | partial **one** `status=active` per `station_id`; partial **one** `status=active` per `auth_user_id` (dispositivo no en dos estaciones) |
| **Índices** | `(station_id, status)`, `(auth_user_id)`, `(last_seen_at desc)` |
| **ON DELETE** | station: restrict if active device |
| **Retención** | rejected/blocked/replaced/revoked conservados (auditoría) |
| **RLS** | vía RPC security definer principalmente |

**Estados:** ver §7.

---

### 5.3 `operational_station_enrollment_tokens`

| Propósito | Tokens one-time enrollment |
|-----------|----------------------------|
| **PK** | `id uuid` |
| **FK** | `station_id`, `created_by` |
| **Columnas** | `token_hash text unique` (SHA-256), `expires_at`, `status check (issued,claimed,completed,expired,revoked)`, `claimed_at`, `claimed_user_agent`, `confirmation_code text` (6 dígitos admin-visible, no es secret de enrollment), `completed_device_id uuid null`, `attempt_count int`, `metadata jsonb` |
| **TTL** | 15 minutos |
| **No almacenar** | token plano, JWT, refresh, contraseña técnica |

---

### 5.4 `operational_credentials`

| Propósito | PIN operativo por perfil |
|-----------|--------------------------|
| **PK** | `profile_id uuid → profiles` |
| **Columnas** | `pin_hash text`, `pin_lookup_key text unique` (HMAC-SHA256 con pepper Vault), `status check (active,blocked)`, `failed_attempts int`, `locked_until timestamptz null`, `updated_at`, `updated_by`, `last_used_at` |
| **UNIQUE** | `pin_lookup_key` entre `status=active`; validación unicidad PIN en set |
| **Sensible** | hash + lookup only |
| **No** | PIN plano, ever |

**Espacio PIN:** 10 000 combinaciones; 26 activos → baja colisión; generación con reintentos acotados; credenciales de inactivos no cuentan para unicidad activa; documentar política de liberación al desactivar perfil.

---

### 5.5 `operational_station_assignments`

| Propósito | Excepciones explícitas perfil ↔ estación/módulo |
|-----------|--------------------------------------------------|
| **PK** | `id uuid` |
| **Columnas** | `profile_id`, `station_id null`, `module text null`, `assignment_type check (allow,deny)`, `scope jsonb`, `is_active`, `created_by` |
| **Modelo** | rol = defaults + allow/deny explícitos |

---

### 5.6 `operational_operator_sessions`

| Propósito | Sesión corta operador (POS/Caja) |
|-----------|-----------------------------------|
| **PK** | `id uuid` |
| **FK** | `station_id`, `station_device_id`, `profile_id` |
| **Columnas** | `session_token_hash text unique`, `module check (pos,cash)`, `opened_at`, `last_activity_at`, `expires_at`, `absolute_expires_at`, `closed_at`, `close_reason`, `status check (active,expired,revoked,replaced)` |
| **Reglas** | una sesión `active` por estación (POS); token 32 bytes random, hash SHA-256; plano solo sessionStorage cliente |
| **Idempotencia** | `client_session_id uuid` optional unique |

---

### 5.7 `operational_pin_attempt_buckets`

| Propósito | Rate limit PIN por device/station/IP |
|-----------|----------------------------------------|
| **PK** | compuesto `(bucket_key text, window_started_at)` |
| **Columnas** | `attempt_count`, `locked_until`, `last_attempt_at` |
| **Política** | 5 intentos → lock temporal (ej. 5 min); respuesta genérica |

---

### 5.8 `operational_station_events`

| Propósito | Auditoría append-only |
|-----------|----------------------|
| **PK** | `id uuid` |
| **Columnas** | `station_id`, `station_device_id null`, `event_type text`, `actor_profile_id null`, `operator_profile_id null`, `supervisor_profile_id null`, `payload jsonb`, `idempotency_key text null unique`, `created_at` |
| **Retención** | ≥ 24 meses operativo (decisión retención §26) |

---

### 5.9 `operational_supervisor_authorizations`

| Propósito | Autorización one-shot supervisor |
|-----------|----------------------------------|
| **PK** | `id uuid` |
| **Columnas** | `station_id`, `station_device_id`, `supervisor_profile_id`, `action_type text`, `target_ref jsonb`, `reason_code`, `observation`, `status check (pending,consumed,denied,expired)`, `consumed_at`, `rpc_name`, `before_state jsonb`, `after_state jsonb`, `idempotency_key unique` |
| **Regla** | consumida en misma transacción que RPC sensible |

---

### 5.10 Cardinalidad v1 (normativa)

```text
operational_station 1 ── N operational_station_devices (historial)
                      └── max 1 device status = active

operational_station_device (active) ── 1 auth.users técnico
                                    └── 1 operational_station

KDS/production station ── 1 area_id
cash station ── 1 cash_register_id
POS station ── optional pos_floor_zone
```

---

## 6. Enrollment y autorización

**Flujo:**

1. Admin crea estación (`draft` → `active`).
2. “Vincular dispositivo” → RPC `create_station_enrollment_token` → token ≥128 bits, **solo hash** en BD, TTL 15 min, QR URL `https://…/enroll?e=<one-time>` (token en fragment o POST body, no log).
3. Dispositivo abre URL → Edge `claim_station_enrollment` valida hash, crea fila device `pending`, muestra **código confirmación** al admin.
4. Admin lista pending (nombre propuesto, tipo, UA resumido, hora, código).
5. **Autorizar** → Edge/RPC: crea usuario Auth técnico (email sintético), `signInWithPassword` o flujo password one-time **nunca persistido**; guarda `auth_user_id`; device → `active`; enrollment → `completed`; emite tokens al cliente **una vez** en respuesta HTTP.
6. **Rechazar y bloquear** → device `blocked`, enrollment invalidado, evento, desaparece de pendientes.
7. Pérdida respuesta HTTP → **re-enrollment supervisado**; nunca reemitir mismo token.
8. **Revocación:** DB `revoked` + ban/signOut Auth **orden:** marcar revoked en PG primero, luego Auth admin API (compensación job si Auth falla).

**Idempotencia:** `Idempotency-Key` header en claim/finalize; fingerprint `(enrollment_id, device_fingerprint_client)` donde fingerprint es random client id en sessionStorage, **no** browser fingerprint.

**Prohibido persistir:** contraseña técnica, enrollment plain, JWT, refresh token.

---

## 7. Pendientes, rechazados y bloqueados

| Estado | Semántica UI |
|--------|----------------|
| **pending** | Enrollment reclamado; espera Autorizar/Rechazar |
| **active** | Operativo |
| **blocked** | Solicitud negada o dispositivo vetado; **estado persistido v1** para rechazo |
| **revoked** | Era active; acceso retirado |
| **replaced** | Sustituido por nuevo device; histórico |

**v1:** no usar fila `rejected` separada en BD; la acción UI **“Rechazar y bloquear”** persiste **`status = blocked`** con `blocked_reason` y evento `device_rejected`. El término “rejected” es semántica de negocio, no segundo estado concurrente.

### 7.1 Política normativa — rechazo de dispositivos operativos

| Regla | Comportamiento |
|-------|----------------|
| Transición | `pending` → **`blocked`** (nunca DELETE como acción normal) |
| Bandeja Pendientes | El registro **desaparece** de la vista principal de pendientes |
| Historial | Visible en **Bloqueados / Historial** con filtros (`status=blocked`, fechas, estación) |
| Evidencia conservada | `blocked_by`, `blocked_at`, `blocked_reason`, `user_agent_summary`, `client_fingerprint` (enrollment claim), `enrollment_id`, eventos en `operational_station_events` |
| Enrollment token | Marcado `revoked`/`completed` según caso; **no** reutilizable para completar |
| Re-solicitud silenciosa | Un device **blocked** que intente `claim` con nuevo token **no** se auto-promueve; queda blocked o se registra intento denegado auditado |
| Reactivación | Solo **administrador autorizado** (`admin` / `gerente_general`) vía flujo explícito: desbloqueo + **nuevo enrollment** (no “unblock silencioso” sin trazabilidad) |
| Revocación vs rechazo | **Revoked** = era active; **blocked** = nunca autorizado o vetado en pending |

**Asistencia (OS-A, separado):** hoy `attendance_devices.status in ('pending','authorized','blocked')` (`059`). Mejora propuesta: paridad UX **Rechazar y bloquear**, bloqueados, masivo — **migración aparte**; no mezclar con `operational_station_devices`.

---

## 8. PIN operativo — normativa v1 (cerrada)

El **PIN operativo** es **independiente** del PIN de asistencia (`attendance_credentials`). No comparte tabla, pepper, lookup space, RPC ni UI de generación.

| # | Regla v1 | Detalle técnico |
|---|----------|-----------------|
| 1 | **4 dígitos** | `[0-9]{4}`; generación CSPRNG |
| 2 | **Separación total de asistencia** | Tabla `operational_credentials` únicamente; prohibido escribir PIN operativo en `attendance_credentials` o columnas de perfil en claro |
| 3 | **Almacenamiento** | Solo `pin_hash` (bcrypt) + `pin_lookup_key` (HMAC-SHA256 con pepper en Vault); **nunca** columna de PIN plano |
| 4 | **Entrega única** | RPC `set_operational_pin` / generación RRHH devuelve PIN plano **una sola vez** en respuesta HTTP; UI obligada a modal “copiar/imprimir”; no re-fetch |
| 5 | **Regeneración supervisada** | `reset_operational_pin` por HR/admin autorizado; invalida hash/lookup anterior; nueva entrega one-time |
| 6 | **Unicidad** | Entre credenciales **activas** (`status=active` + perfil `active`); reintentos acotados si colisión (espacio 10 000 / ~26 activos) |
| 7 | **Rate limiting** | `operational_pin_attempt_buckets` por `(station_device_id \| client_fingerprint)` + ventana; **5 intentos** fallidos |
| 8 | **Bloqueo temporal** | Tras umbral → `locked_until` en credential y/o bucket (ej. 5 min); evento `pin_rate_limited` |
| 9 | **Respuesta genérica** | Cliente y RPC: mismo mensaje ante PIN incorrecto, inexistente, bloqueado o perfil inactivo — **“PIN inválido o no disponible”** (sin enumerar causa) |
| 10 | **Prohibición de registro** | No PIN en logs, `operational_station_events.payload`, observabilidad, errores SQL, analytics ni backups lógicos de aplicación |
| 11 | **RRHH** | Pantalla muestra solo **configurado: Sí/No**; nunca el valor guardado |
| 12 | **Implementación por fase** | Esquema/tablas PIN en **OS2**; OS1 **no** expone PIN operativo en producción |

---

## 9. Recursos Humanos — “Acceso operativo”

**Ubicación:** `/hr?section=usuarios` → `ProfileManagement` → sección **Acceso operativo**.

**Campos UI (diseño):**

| Campo | Comportamiento |
|-------|----------------|
| PIN operativo configurado | Sí/No (sin valor) |
| Generar PIN | modal one-time display + imprimir/entregar |
| Restablecer / Bloquear | RPC `reset_operational_pin`, `block_operational_pin` |
| Permisos | defaults por rol + toggles excepción |
| POS / Caja / Producción / Supervisor auth | checkboxes + herencia rol |
| Áreas KDS | lectura `user_production_areas` + overrides |
| Estaciones específicas | lista allow/deny |
| Último acceso / bloqueos / eventos | read-only |

**Administración:**

| Acción | admin | gerente_general | RRHH | supervisor |
|--------|-------|-----------------|------|------------|
| Generar/reset PIN | ✓ | ✓ | ✓* | ✗ |
| Asignar áreas KDS | ✓ | ✓ | ✓ | limitado |
| Asignar POS/Caja | ✓ | ✓ | ✗ default | ✗ |
| Capacidad supervisor | ✓ | ✓ | ✗ | ✗ |

\*RRHH **no** otorga privilegios financieros elevados (Caja, supervisor financial) salvo decisión explícita futura (§26).

---

## 10. POS — modo individual

**Flujo:** device session (JWT técnico) → shell estación → PIN → `open_pos_operator_session` → operator token en **sessionStorage** → POS UI.

**Atribución:**

- Nueva orden: `owner_profile_id = operator` (F0A conservado).
- Ayudante con PIN: actor en eventos ≠ owner.
- JWT dispositivo **nunca** es owner.

**RPC (preferir wrappers v2, no romper 184–187 desplegados):**

| Acción | Validación station mode |
|--------|-------------------------|
| `open_pos_table_service` | station device + operator session + `can_operate_pos` assignment |
| `release_pos_table_service` | idem + reglas 187 |
| add item / send production / clear drafts / request payment | operator + station + owner rules |

**Modo personal:** si `pos_station_mode=off|optional`, RPC acepta solo `auth.uid()` como hoy.

---

## 11. Sesión POS — seguridad e idle (normativa)

### 11.1 Tres capas (no confundir)

| Capa | Qué es | Persistencia | Afectada por idle 45 s |
|------|--------|--------------|------------------------|
| **Device session** | JWT Auth técnico del dispositivo enrolado | Persistente (refresh) hasta revocación | **No** |
| **Operator session** | Token mesero (`operational_operator_sessions`) | Corta; hash BD; plano **sessionStorage** | **Sí** |
| **Pantalla bloqueada (UI)** | Teclado PIN; datos sensibles ocultos | UI + token invalidado | Consecuencia idle o bloqueo inmediato |
| **Expiración absoluta** | Tope máximo turno operador | `absolute_expires_at` | **Independiente** del idle (§26.2) |

**Caja:** mismas capas; idle operador **90 s** (§14.1).

### 11.2 Eventos que reinician el temporizador idle

**Reinician** `last_activity_at` (cliente + servidor):

- Interacción táctil/ratón en controles POS (categoría, mesa, producto, cantidad, modificadores).
- Edición activa en ticket (ver §11.4 `interaction_hold`).
- Navegación POS in-app (plano ↔ menú) sin salir del shell estación.
- RPC POS exitosa del operador (líneas, persistencia draft server-side).

**No reinician:** Realtime pasivo, timers UI, toasts, mirar pantalla sin input.

### 11.3 Aviso y expiración idle

| | POS | Caja |
|---|-----|------|
| Idle | **45 s** | **90 s** |
| Aviso | Banner a **15 s** restantes | Banner a **30 s** restantes |
| Al expirar | Pantalla PIN; revocar operator token; limpiar sessionStorage | Idem |
| Backend | RPC rechaza token expirado (`OPERATOR_REQUIRED`) | Idem |

### 11.4 Orden activa y drafts

- **interaction_hold:** con focus en input, modal producto o teclado numérico abierto → **pausar** idle.
- **RPC in-flight:** no bloquear hasta respuesta.
- **Drafts no enviados:** se conservan al bloquear; no liberar mesa; no cambiar owner.
- **Re-PIN:** restaura vista; owner intacto salvo nueva orden.

**Objetivo:** bloquear estación **abandonada**, no interrumpir ingreso normal.

### 11.5 Bloqueo inmediato (post-éxito)

Tras éxito: enviar cocina, salir de vista, cobro, liberar mesa, cambiar operador, bloqueo manual estación. Invalidar token **servidor primero**, luego UI PIN.

### 11.6 Multi-pestaña

`BroadcastChannel`; una sesión activa/estación; `session_version`; sessionStorage no compartido entre pestañas.

### 11.7 Token operador

32 bytes aleatorios; SHA-256 en BD; nunca localStorage.

---

## 12. KDS / Producción — modo equipo (normativa confirmada)

| Política | v1 |
|----------|-----|
| Sesión técnica persistente (JWT device) | Sí |
| Sin PIN operador en acciones ordinarias | Sí |
| Varios cocineros = equipo; no atribución individual del ticket | Sí |
| KPI estación / área / equipo / turno | Sí |
| PIN supervisor solo excepciones (§13) | Sí |
| Realtime reconecta sin cerrar device session | Sí |
| Revocación/bloqueo device → rechazo RPC inmediato + signOut | Sí |
| Sin idle timeout operador | Sí |
| `area_id` fijado por estación | Sí |

Audit: `station_id`, `station_device_id`, `area_id`, contexto equipo/turno. Producción v1 = KDS salvo §26.7.

---

## 13. KDS — acciones excepcionales

Overlay PIN supervisor → motivo + observación → RPC atómica `authorize_supervisor_station_action` + acción + `consume` authorization.

Acciones: cancelar, reabrir, corregir estado, prioridad, mover área, reportes operativos, override.

Guardar: station, area, action, supervisor_id, motivo, before/after, idempotency_key.

---

## 14. Caja — modo individual

Estación `cash` ligada a `cash_register_id`. PIN **no** sustituye apertura/cierre `cash_session`.

### 14.1 Idle y bloqueo (hereda §11)

- Idle operador: **90 s**; aviso a 30 s; mismas reglas `interaction_hold`, drafts, RPC in-flight.
- Bloqueo operador **no** cierra `cash_session`.
- Cobro registra cajero + station + device + `cash_session_id`.
- Bloqueo post-cobro: ver §26.3 (decisión abierta; default implementación OS5: bloqueo inmediato recomendado).

Supervisor: anulaciones vía `operational_supervisor_authorizations`. RPC cash: optional `operator_session_token` + `is_cash_operator`.

---

## 15. Producción — modo equipo

Referencia normativa: **§12** (misma política KDS). Excepciones supervisor §13.

**Nota:** bakery/internal production — decisión individual §26.7 (OS6).

---

## 16. Asistencia (dominio separado)

Sin conversión a `operational_stations`. Reutilizar patrones UI/admin/rate limit.

**OS-A:** rechazar/bloquear, masivo, bloqueados, desbloqueo, auditoría en `attendance_devices` — migración independiente.

---

## 17. Autorización — matriz (principio)

```text
permitido =
  estación activa
  AND dispositivo active
  AND (modo team OR operator_session válida)
  AND permiso módulo (rol + assignment)
  AND (KDS: area_id match estación)
  AND (supervisor: authorization consumida para excepción)
```

| Modo | Operator token | Supervisor auth |
|------|----------------|-----------------|
| KDS normal | No | No |
| KDS excepción | No | Sí |
| POS | Sí | Acciones sensibles opcional |
| Caja | Sí | Anulaciones |
| Personal legacy | JWT user | Según rol hoy |

**Emergency:** admin/gerente/supervisor bypass auditado → event `personal_emergency_access`.

---

## 18. Feature flags (server-side)

| Flag | Valores |
|------|---------|
| `operational_stations_enabled` | off / optional / required |
| `pos_station_mode` | off / optional / required |
| `kds_station_mode` | off / optional / required |
| `cash_station_mode` | off / optional / required |
| `production_station_mode` | off / optional / required |

Almacenamiento propuesto: fila en `app_settings` o tabla `operational_feature_flags` con RLS admin-only. RPC consulta flags; frontend solo refleja.

---

## 19. Retiro acceso personal (por módulo)

Sin borrar usuarios Auth. Cuando `required`:

- Mesero: POS solo estación; mantiene HR/tareas.
- Cocina: KDS solo device autorizado.
- Caja: solo estación.
- Producción: solo estación.

Gates: `assert_station_access(module)` en RPC + rutas shell.

---

## 20. Contratos RPC y Edge (resumen)

### Edge Functions

| Función | Rol |
|---------|-----|
| `operational-station-enroll-claim` | Valida token hash, crea pending |
| `operational-station-enroll-complete` | Auth user técnico + tokens respuesta |

### RPC PostgreSQL (firmas conceptuales)

| RPC | Auth | Idempotencia |
|-----|------|--------------|
| `provision_operational_station(...)` | admin | station_code |
| `update_operational_station(...)` | admin | version |
| `create_station_enrollment_token(p_station_id)` | admin | optional key |
| `claim_station_enrollment(p_token, p_client_fingerprint)` | anon + rate limit | key |
| `authorize_pending_station_device(p_device_id, p_confirmation_code)` | admin | key |
| `reject_and_block_station_device(p_device_id, p_reason)` | admin | key |
| `revoke_station_device(p_device_id)` | admin | key |
| `replace_station_device(...)` | admin | key |
| `set_operational_pin(p_profile_id)` | HR/admin | returns **once** plain |
| `reset_operational_pin / block_operational_pin` | HR/admin | — |
| `open_pos_operator_session(p_pin, p_station_device_id)` | device JWT | key |
| `close_pos_operator_session(p_token_hash)` | device/operator | key |
| `open_cash_operator_session(...)` | device JWT | key |
| `authorize_supervisor_station_action(...)` | device JWT | key |
| `consume_supervisor_authorization(p_auth_id)` | internal | transactional |
| `get_profile_operational_access(p_profile_id)` | HR/manager | read |
| `set_profile_station_assignment(...)` | admin | — |

**KDS/Production updates:** wrappers `update_production_ticket_status_v2(p_ticket_id, p_status, p_station_context jsonb)` validando device JWT sin operator token.

Errores estándar: `STATION_DISABLED`, `DEVICE_REVOKED`, `OPERATOR_REQUIRED`, `PIN_LOCKED`, `AREA_MISMATCH`, `FLAG_PERSONAL_DISABLED`.

---

## 21. Observabilidad

Eventos listados en brief §21 — insert en `operational_station_events`. **Nunca** loguear PIN, tokens, refresh, contraseña técnica.

Heartbeat: cliente device envía `station_connected` / periódico `last_seen_at` (throttled).

---

## 22. Concurrencia e idempotencia

- Advisory lock `(station_id)` en open operator session.
- Advisory lock `(auth_user_id)` en activate device.
- `idempotency_key` en enrollment complete y supervisor actions.
- Version column en `operational_stations` para update optimistic.
- Multi-tab: token version increment on revoke.

---

## 23. Pruebas (matriz diseño)

Cubrir escenarios del brief §23 como **casos de aceptación OS1–OS7** (documento de pruebas derivado en implementación). Incluir compensación Auth/DB en enrollment y POS idle 45s multi-tab.

---

## 24. Plan por fases

| Fase | Alcance | Gate |
|------|---------|------|
| **OS0** | Este documento + threat model + contratos | Aprobación negocio |
| **OS1** | Schema `operational_stations`, `operational_station_devices`, enrollment tokens, events; Edge claim/complete; admin `/settings/operational-stations`; Auth técnica; flags `operational_stations_enabled=off` default | Enrollment E2E en staging |
| **OS2** | PIN operativo + RRHH Acceso operativo + rate limit | PIN unicidad |
| **OS3** | POS shell + operator session + F0A/187 wrappers + optional flag | POS station E2E |
| **OS4** | KDS estaciones por área + team mode + supervisor + Realtime | KDS sin operator |
| **OS5** | Caja station + cash session integration | Cobro atribuido |
| **OS6** | Producción team + excepciones | KPI colectivo |
| **OS7** | required flags + emergency access + observabilidad | Cutover módulo |
| **OS-A** | Mejora attendance_devices pending/reject | Independiente |

**Rollback:** forward-only migrations; feature flags `off` como kill switch.

**Fuera alcance v1:** NFC; múltiples devices activos por estación; v2 device auxiliar (decisión abierta).

---

## 25. Riesgos y threat model

| Amenaza | Mitigación | Residual |
|---------|------------|----------|
| PIN shoulder surfing | timeout corto POS, bloqueo post-acción | Medio |
| Robo tablet con JWT device | revocación remota; operator session corta POS | Medio |
| Replay operator token | hash + expiry + single active | Bajo |
| Bypass frontend | RPC flags + station context | Bajo si OS7 |
| PIN asistencia reutilizado | tablas separadas | N/A si se cumple |
| Métricas KDS falsa por persona | modo equipo | Bajo |
| Auth OK / DB fail enrollment | compensación job + manual | Medio |
| 22 attendance pending spam | OS-A rechazo masivo | Operativo |

---

## 26. Decisiones abiertas — análisis pre-OS1

Solo estas permanecen abiertas. Las demás decisiones de negocio (§2) están **cerradas**.

### 26.1 Permisos financieros desde RRHH

| Opciones | A) Solo admin/gerente asigna Caja y supervisor financial. B) RRHH asigna todo con auditoría. C) RRHH propone; gerente aprueba. |
| **Recomendación** | **A** (default v1) — alinea con auditoría y riesgo financiero. |
| **Impacto técnico** | Matriz `set_profile_station_assignment` + RLS HR; sin cambio schema OS1. |
| **¿Bloquea OS1?** | **No** — aplazar a OS2/OS5. |

### 26.2 Expiración absoluta sesión operador POS

| Opciones | A) 8 h laborales. B) 12 h. C) Sin absoluta en v1 (solo idle). |
| **Recomendación** | **C para OS3**; añadir **B (12 h)** antes de `required` en OS7. |
| **Impacto** | Columna `absolute_expires_at` ya prevista; default NULL = desactivado. |
| **¿Bloquea OS1?** | **No**. |

### 26.3 Bloqueo Caja inmediato después de cobro

| Opciones | A) Bloqueo inmediato post-cobro (como POS post-envío). B) Delay 30 s. C) Configurable por estación. |
| **Recomendación** | **A** para OS5; documentar excepción si negocio pide B. |
| **Impacto** | Shell cash UI + hook post-RPC cobro. |
| **¿Bloquea OS1?** | **No**. |

### 26.4 Retención devices blocked/revoked

| Opciones | A) 24 meses. B) 7 años. C) Indefinido (append-only). |
| **Recomendación** | **A** operativo + archivo frío manual; revisar legal después. |
| **Impacto** | Job purge OS7+; OS1 solo INSERT. |
| **¿Bloquea OS1?** | **No**. |

### 26.5 Reset operativo diario (cron)

| Opciones | A) No reset automático v1. B) Cerrar operator sessions 04:00 GT. C) Cerrar device sessions (rechazado). |
| **Recomendación** | **A** v1; **B** opcional OS7 si negocio lo pide. |
| **Impacto** | Cron Edge/pg_cron. |
| **¿Bloquea OS1?** | **No**. |

### 26.6 Recuperación refresh token device perdido

| Opciones | A) Solo re-enrollment supervisado (recomendado v1). B) Recovery code one-time admin. C) Rotación remota sin físico (riesgo). |
| **Recomendación** | **A** — coherente con decisión 17 (no reemitir sesión). |
| **Impacto** | Flujo admin revoke + nuevo QR; documentación operativa. |
| **¿Bloquea OS1?** | **No** — definir runbook en OS1 docs. |

### 26.7 Producción: identidad individual en alguna acción

| Opciones | A) Equipo puro v1 (cerrado diseño). B) Responsable en batch bakery. C) PIN opcional por acción. |
| **Recomendación** | **A** hasta evidencia en OS6; spike bakery antes de cambiar schema. |
| **Impacto** | Posible columna `actor_profile_id` nullable en eventos OS6. |
| **¿Bloquea OS1?** | **No**. |

### 26.8 Device auxiliar (v2)

| Opciones | A) Mantener 1 active v1. B) Secondary read-only v2. C) Failover hot-standby. |
| **Recomendación** | **A** v1; **B** backlog v2. |
| **Impacto** | Relajar UNIQUE partial en v2. |
| **¿Bloquea OS1?** | **No**. |

---

## 28. Revisión pre-OS1 — gate de aprobación

### 28.1 Decisiones cerradas (extracto normativo)

| ID | Decisión |
|----|----------|
| C1 | Sistema unificado POS/KDS/Caja/Producción |
| C2 | Estación ≠ área ≠ dispositivo |
| C3 | 1 device active / estación v1 |
| C4 | Enrollment QR TTL 15 min; pending → authorize o **blocked** |
| C5 | PIN operativo 4 dígitos **separado** de asistencia (§8) |
| C6 | POS/Caja individual; KDS/Producción equipo (§12) |
| C7 | Idle POS 45 s / Caja 90 s con `interaction_hold` (§11) |
| C8 | Conservar areas, assignments, caja, F0A, attendance |
| C9 | Flags off/optional/required; backend enforcement |
| C10 | Rechazo device: pending→blocked, sin DELETE (§7.1) |

### 28.2 Decisiones abiertas (resumen)

| # | Tema | Bloquea OS1 |
|---|------|-------------|
| 26.1 | RRHH permisos financieros | No |
| 26.2 | Expiración absoluta POS | No |
| 26.3 | Bloqueo post-cobro | No |
| 26.4 | Retención blocked | No |
| 26.5 | Reset diario | No |
| 26.6 | Recovery refresh device | No |
| 26.7 | Producción individual | No |
| 26.8 | Device auxiliar v2 | No |

### 28.3 Recomendación de gate

**APROBAR OS1** — Ninguna decisión abierta bloquea foundation (schema estaciones, enrollment, admin, Auth técnica). Políticas PIN operador idle/KDS/rechazo quedan **especificadas** para fases OS2–OS5.

**Condición:** confirmar número migración **190+** en repo al iniciar implementación; flags permanecen `off` en prod hasta OS3+.

### 28.4 Alcance exacto OS1 (IN)

- Migración(es) `operational_stations`, `operational_station_devices`, `operational_station_enrollment_tokens`, `operational_station_events` (sin `operational_credentials` / operator sessions — **OS2/OS3**).
- RPC: provision/update station, create token, claim, authorize, reject_and_block, revoke, replace, list pending/blocked.
- Edge: enroll claim + complete (Auth técnica).
- UI: `/settings/operational-stations` CRUD + pending queue + blocked/historial + enrollment QR.
- Compensación Auth↔PG documentada + selftests enrollment.
- Feature flag `operational_stations_enabled=off` (lectura only).

### 28.5 Fuera de OS1 (OUT)

- PIN operativo y tablas `operational_credentials`, buckets (OS2).
- RRHH “Acceso operativo” (OS2).
- POS/Caja operator session, shell PIN, idle timers (OS3/OS5).
- KDS/Producción station mode en producción (OS4/OS6).
- Wrappers RPC 184–187 (OS3).
- Supervisor authorization consumo en KDS (OS4).
- Feature `required` / retiro acceso personal (OS7).
- OS-A asistencia reject masivo.
- Extensión agregados `/production/areas` (puede OS1.1 o OS4 — **opcional** si capacity; no bloqueante gate).

---

## 27. Referencias

- Auditoría: `docs/operational-stations-current-state-audit.md`
- POS detalle sesión/enrollment: `docs/pos-station-technical-design.md`
- Mesas: `docs/pos-table-service-lifecycle-technical-design.md`
- SQL desplegado: `184`–`187`
- Diagnóstico: `supabase/schema/diagnose_operational_stations_current_state.sql`

**Estado:** diseño v1.0.1 — revisión pre-OS1 completa. **No iniciar OS1 sin aprobación explícita de Juan Carlos / negocio.**
