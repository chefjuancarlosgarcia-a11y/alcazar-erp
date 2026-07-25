# Auditoría — estado actual del sistema de estaciones operativas

**Fecha:** 2026-07-25
**Base de código:** worktree `alcazar-inventario-f0a-preprod` @ `a512a542…` (árbol funcional equivalente a `origin/main` @ `6ea392b0…`, tag `v0.6.0-pos-f0a-table-lifecycle`)
**Alcance:** inventario y gap analysis — **sin implementación** en el momento de la auditoría.
**Seguimiento:** decisiones de negocio cerradas y diseño unificado en `docs/operational-stations-technical-design.md` (2026-07-25).

### Snapshot remoto confirmado (diagnóstico read-only)

Ejecutado contra Supabase producción con `supabase/schema/diagnose_operational_stations_current_state.sql`:

| Métrica | Valor |
|---------|------:|
| `profiles_active` | 26 |
| `profiles_with_attendance_pin` | 25 |
| `attendance_credentials` | 30 |
| `attendance_devices` | 27 |
| `attendance_devices_authorized` | 5 |
| `attendance_devices_pending` | 22 |
| `attendance_devices_blocked` | 0 |
| `require_authorized_device` | true |
| `require_authorized_network` | false |
| `production_areas_active` | 7 |
| `user_production_area_assignments_active` | 13 |
| `cash_registers_active` | 1 |
| `cash_sessions_open` | 1 |
| `pos_orders_open` | 12 |

**Objetos operativos unificados:** no existen tablas `operational_stations`, dispositivos operativos, PIN operativo ni sesiones de operador (confirmado en JSON del diagnóstico).

**Implicación operativa:** 22 dispositivos de asistencia pendientes con `require_authorized_device=true` — riesgo de fricción en kioscos hasta autorizar o OS-A (rechazo/bloqueo masivo). Una caja activa y 12 órdenes POS abiertas — cualquier enforcement station-only debe planificarse con flags `optional` antes de `required`.

### Decisiones de negocio posteriores a la auditoría (cerradas)

Documento normativo: **`docs/operational-stations-technical-design.md`**. Síntesis:

1. Sistema **unificado** POS + KDS + Caja + Producción con estación lógica ≠ área ≠ dispositivo.
2. v1: **un dispositivo activo** por estación; dos pantallas = dos estaciones; historial de reemplazos.
3. Enrollment QR/código one-time (15 min); pending → Autorizar o Rechazar y bloquear; Auth técnica revocable; **sin** fingerprint como autoridad.
4. **PIN operativo separado** de asistencia (4 dígitos, generado, único activos, mostrar una sola vez).
5. **POS/Caja:** operador individual; **KDS/Producción:** modo **equipo** (sin operator session normal); supervisor PIN solo excepciones.
6. Conservar `areas`, `user_production_areas`, `cash_registers`/`cash_sessions`, F0A `owner_profile_id`, dominio `attendance_*` intacto.
7. Acceso personal legacy durante transición; station-only por módulo vía **backend** + flags `off|optional|required`.
8. KPI KDS por área/turno/equipo/estación — no atribución individual del ticket completo.

La auditoría §13 “propuesta mínima aditiva” queda **supersedida** por el diseño unificado OS0–OS7; la matriz de gaps de esta auditoría sigue válida como línea base “antes”.

### Verificación worktree vs main

```text
git fetch origin main
git diff --stat HEAD origin/main   → (sin diferencias de archivos)
```

La rama `test/f0a-preproduction` y `origin/main` difieren solo en el commit de merge; el contenido desplegado coincide con el release F0A + 184–187.

---

## 1. Resumen ejecutivo

**Hallazgo principal:** no existe un **catálogo unificado de “estaciones operativas”** (POS/KDS/caja/producción). Lo que Juan Carlos probablemente recuerda como “estaciones” combina **tres piezas independientes**:

1. **Dispositivos de marcaje de asistencia** (`attendance_devices` + UI en RRHH) — la única implementación real de *dispositivo autorizado + revocación + last_seen*.
2. **Áreas de producción / KDS** (`areas.is_production_area`, rutas `/production/kds/:areaId`) — filtro por área con sesión personal Supabase, no identidad de pantalla.
3. **Cajas registradoras lógicas** (`cash_registers` + `cash_sessions`) — entidad de negocio “caja”, no terminal física.

El documento `docs/pos-station-technical-design.md` describe un **modo estación POS compartida** (PIN operativo, enrollment JWT, tablas nuevas) **sin implementar en código ni SQL**.

**Reutilización recomendada:** patrón UX/PIN/dispositivo de asistencia **como referencia**, tablas `attendance_devices` + RPC de seguridad **solo para asistencia**, áreas KDS y asignaciones `user_production_areas`, gates `can_operate_*` y F0A `owner_profile_id`. **No reutilizar** `attendance_credentials` / PIN de 4 dígitos para POS/KDS (riesgo de mezcla de dominios y unicidad global).

**Diagnóstico remoto:** `supabase/schema/diagnose_operational_stations_current_state.sql` — **ejecutado y confirmado** (ver snapshot arriba).

---

## 2. Qué significa “estación” actualmente

| Uso en producto/código | Significado | ¿Dispositivo físico? |
|------------------------|-------------|----------------------|
| “Terminal de marcaje” / `/kiosk` | Tablet fija para asistencia | Sí (ID en `localStorage`) |
| “Dispositivos de marcaje” (RRHH) | Allowlist de `device_id` | Sí |
| “Área de producción” / KDS | Segmento de tickets por `area_id` | No — filtro lógico |
| “Caja principal” | Registro en `cash_registers` | No — caja lógica |
| `PosServiceTerminal` (componente) | Layout UI del POS clásico | No — nombre de componente |
| “Estaciones de trabajo” (texto en ProductionHub) | Áreas KDS listadas | No — copy UI |
| Diseño POS estación (doc v1.2) | Estación registrada + sesión operador | **Diseño futuro** |

---

## 3. Inventario frontend / backend

### 3.1 Tabla de entidades y funciones

| Entidad / función | Archivo / migración | Uso actual | Lógica vs físico | Auth | PIN | Revocación | Auditoría | Reutilizable | Riesgos |
|-------------------|---------------------|------------|------------------|------|-----|------------|-----------|--------------|---------|
| `attendance_devices` | `059_attendance_authorized_devices.sql` | Allowlist marcaje | Físico (ID cliente) | Anon/authenticated vía RPC | No | `block_attendance_device`, status | `attendance_security_events` | **Patrón** para device registry | Solo asistencia; ID en localStorage falsificable |
| Terminal asistencia | `AttendanceTerminal.jsx`, `/kiosk`, `/hr?section=asistencia` | Marcaje foto+PIN | Físico | Supabase anon OK en kiosk | Sí (4 díg) | Bloqueo dispositivo | Marcas + eventos | UX teclado PIN, cámara | No compartir PIN con POS |
| Admin dispositivos | `AttendanceDevicesManagement.jsx`, `/hr?section=dispositivosMarcaje` | Autorizar/bloquear tablets | Físico | admin/gerente_general | — | Sí | Lectura eventos | **UI admin dispositivos** | Prompts nativos; no QR enrollment |
| `attendance_credentials` | `019_attendance_terminal.sql` | PIN asistencia bcrypt | Persona | RPC managers | Hash | Cambio PIN | `updated_by` | **No** para operaciones POS | Unicidad global PIN 4 dígitos |
| `profiles.authorized_attendance_device` | `019`, UI ProfileManagement | Alerta si otro device | Hint por empleado | HR | — | Editable | `device_alert` en marcas | Opcional alerta | No es enforcement fuerte |
| Áreas producción | `003_areas.sql`, `078_*`, `ProductionAreasManagement.jsx` | Catálogo KDS | Lógica | Auth personal | No | Desactivar área | — | **Sí** extender metadata estación | No liga a device |
| KDS board | `Production.jsx`, `/production/kds/:areaId` | Tablero tickets | Filtro área | Auth personal | No | — | `auth.uid()` en envío POS | **Extender** con operator | Pantalla compartida = misma cuenta |
| `user_production_areas` | `078_production_areas_user_assignments.sql` | Quién ve qué área | Persona↔área | RLS manager | No | `is_active` | — | **Sí** para asignaciones | Rol + excepciones |
| `cash_registers` / `cash_sessions` | `045_cash_sessions_and_movements.sql` | Turno caja | Caja lógica | `opened_by` = profile | No | Cerrar sesión | Movimientos | Modelo turno, no terminal | Sin device_id |
| POS orden / mesa | `184`, `187`, `POS.jsx` | Servicio mesa | Mesa/servicio | `auth.uid()` + `owner_profile_id` | No | Liberar mesa RPC | Eventos orden | F0A ownership | Requiere sesión personal hoy |
| `can_operate_pos_orders()` | `046`, usado en 185–187 | Gate RPC POS | Rol | JWT usuario | No | — | — | Base para operator_token | Frontend POS_ROLES más estrecho |
| `can_operate_production_tickets()` | `009`, `078` | KDS update | Rol | JWT | No | — | — | Idem | No registra operador en ticket update |
| `production_tickets` | `009_production_tickets.sql` | Cola KDS | Por área | Lectura abierta; update gated | No | — | Timestamps | **Sí** | `waiter_id` al crear; updates sin actor |
| POS layout local | `POS.jsx` localStorage | Plano/categorías cache | Cliente | — | No | — | — | No para estación | Legacy híbrido |
| Diseño POS estación | `docs/pos-station-technical-design.md` | Spec | Futuro | JWT estación diseñado | PIN operativo diseñado | Diseñado | Diseñado | Roadmap | **No código** |

### 3.2 Rutas relevantes

| Ruta | Componente | Módulo Auth |
|------|------------|-------------|
| `/kiosk` | `Kiosk` → `AttendanceTerminal` | Público (anon) |
| `/hr?section=asistencia` | `AttendanceTerminal` | `hr` |
| `/hr?section=dispositivosMarcaje` | `AttendanceDevicesManagement` | `hr` |
| `/hr?section=usuarios` | `ProfileManagement` | `hr` |
| `/production`, `/production/kds/:areaId` | Hub / KDS | `production` |
| `/production/areas`, `/production/assignments` | Admin áreas / asignaciones | `production` |
| `/pos` | `POS` | `pos` (rol frontend) |
| `/cash`, `/cash-control` | Caja | `cash` |

---

## 4. Modelo de datos actual

### 4.1 Tablas clave (resumen)

| Tabla | PK | FK / columnas importantes | Lectura / escritura | RLS | RPC principal | PIN | Identifica |
|-------|-----|---------------------------|------------------------|-----|---------------|-----|------------|
| `attendance_devices` | `id` | `device_id` unique, `status`, `last_seen_at`, `authorized_by` | Admin all; HR read | Sí | `get_or_register_*`, `authorize_*`, `block_*` | No | Dispositivo |
| `attendance_credentials` | `employee_id` | `pin_hash` (bcrypt) | service_role; vía RPC | Sí | `set_attendance_pin`, `register_attendance_mark` | **Hash** | Persona |
| `attendance_marks` | `id` | `device_id`, `photo_path`, `employee_id` | Managers + self read | Sí | `register_attendance_mark` | No | Persona + device snapshot |
| `attendance_security_events` | `id` | `event_type`, metadata | HR/admin read | Sí | `log_attendance_security_event` | No | Evento |
| `profiles` | `id` | `role`, `area_id`, `authorized_attendance_device` | Auth policies | Sí | muchas | No | Persona |
| `areas` | `id` | `is_production_area`, `active` | Authenticated | Sí | áreas POS/KDS | No | Área lógica |
| `user_production_areas` | `id` | `profile_id`, `production_area_id` | Self + managers | Sí | sync trigger profile | No | Persona↔área |
| `production_tickets` | `id` | `area_id`, `waiter_id`, `status` | Read all auth; update operators | Sí | `create_production_tickets_from_order` | No | Orden/área |
| `cash_registers` | `id` | `name`, `status` | Cash RPCs | Sí | open/close session | No | Caja lógica |
| `cash_sessions` | `id` | `cash_register_id`, `opened_by`, `closed_by` | Operators | Sí | cash RPCs | No | Turno + cajero |
| `pos_orders` | `id` | `owner_profile_id`, `waiter_id`, `table_id`, `status` | POS RLS | Sí | 184–187 RPCs | No | Orden/mesa |

### 4.2 Equivalencias solicitadas

| Concepto objetivo | ¿Existe? | Equivalente actual |
|-------------------|----------|-------------------|
| `operational_stations` | **No** | Fragmentado: `areas` (KDS), `cash_registers`, diseño doc POS |
| `station_devices` | **Parcial** | Solo `attendance_devices` (dominio asistencia) |
| `employee_station_assignments` | **Parcial** | `user_production_areas` + `profiles.area_id` + rol |
| `operational_pins` | **No** | Solo `attendance_credentials` (asistencia) |
| `station_sessions` | **No** | `cash_sessions` (otro significado) |
| `operator_sessions` | **No** | — |
| `station_events` | **Parcial** | `attendance_security_events` |

---

## 5. Terminal y PIN de asistencia

### 5.1 Flujo

1. **Rutas:** `/kiosk` (kiosco) o `/hr?section=asistencia`.
2. **Dispositivo:** `getOrCreateAttendanceDeviceId()` → `localStorage` key `attendanceKioskDeviceId` (`frontend/src/utils/attendanceDevice.js`).
3. **Registro:** RPC `get_or_register_attendance_device` → fila `pending` en `attendance_devices`.
4. **Autorización:** Admin en **Dispositivos de marcaje** (`authorize_attendance_device`) o desactivar `require_authorized_device` en settings.
5. **Empleado:** lista vía `get_attendance_terminal_profiles()` (sin PIN; solo `pin_configured`).
6. **PIN:** teclado numérico 4 dígitos en UI → `register_attendance_mark` valida con `crypt(p_pin, credential.pin_hash)`.
7. **Evidencia:** foto obligatoria (`uploadAttendanceEvidence` + `photo_path`).
8. **Config PIN:** `ProfileManagement` → sección “PIN de marcaje” → `set_attendance_pin` (HR/admin/gerente según `can_manage_attendance_for_profile`).
9. **Dispositivo preferido empleado:** campo `authorized_attendance_device` (texto libre); mismatch marca `device_alert` en la marca.

### 5.2 Seguridad

| Control | Estado |
|---------|--------|
| PIN en claro en BD | **No** — solo `pin_hash` (bcrypt) |
| Unicidad PIN | **Sí** — global entre activos (`set_attendance_pin`, `validate_attendance_pin_available`) |
| Rate limit / lockout PIN | **No encontrado** en frontend ni SQL |
| Revocación terminal | **Sí** — `blocked` + settings |
| `auth.uid()` en marcaje | Opcional en `created_by`; validación principal es PIN + device |
| Auditoría | Marcas + `attendance_security_events` |

### 5.3 Reutilizar vs no

| Reutilizar UX/patrón | Reutilizar misma tabla/PIN |
|----------------------|----------------------------|
| Teclado PIN, flujo “mostrar una vez”, admin dispositivos, eventos seguridad, local device_id + allowlist | **No** `attendance_credentials` para POS/KDS/caja |

**Riesgo POS/KDS con PIN asistencia:** mismo espacio 4 dígitos, misma unicidad, distinto propósito (laboral vs operativo), mayor superficie si un PIN filtra entre dominios. **Recomendación:** PIN operativo **separado** (como ya indica `pos-station-technical-design.md`).

---

## 6. KDS y producción

### 6.1 Respuestas directas

- **¿“KDS Cocina” es estación real?** **No.** Es un **filtro de `production_tickets.area_id`** en `/production/kds/:areaId`. La pantalla usa la **sesión Supabase del usuario logueado**.
- **¿Identidad persistente del dispositivo?** **No** en KDS/producción.
- **¿Extender sin reemplazar?** **Sí** — conservar `areas` + `user_production_areas` + rutas; añadir capa device/operator encima.

### 6.2 Selección de área

| Mecanismo | Detalle |
|-----------|---------|
| URL | `:areaId` en `/production/kds/:areaId` |
| Rol | `canSelectKDSArea` → admin, gerente_general, supervisor, gerente_operaciones ven todas |
| Asignación | `user_production_areas` + fallback rol→área en `kds.js` |
| localStorage | Legacy en utilidades KDS (`productionTickets`, `users`) — no ruta principal Supabase |
| Realtime | `production_tickets`, `production_ticket_items` |

### 6.3 Acciones y actor

- Cambios de estado: `updateProductionTicketStatusRemote` con usuario autenticado; **no hay columna `operator_id` en ticket** al actualizar.
- Creación tickets desde POS: `waiter_id = auth.uid()` en RPC (`009`); alineable con F0A `owner_profile_id` en orden, no en ticket update.

### 6.4 Administración

- **Áreas:** `/production/areas` — CRUD áreas producción (admin/gerente_general).
- **Asignaciones:** `/production/assignments` — `user_production_areas`.
- **No hay** UI “estación KDS” con enrollment.

---

## 7. POS y caja

### 7.1 POS personal

- **Frontend:** `POS_ROLES = ["admin","gerente_general","supervisor","mesero","caja"]` — excluye `cajero` y `servicio` aunque backend **`can_operate_pos_orders()`** sí incluye `cajero`, `caja`, `mesero`, `servicio`, `supervisor`, `admin`, `gerente_general` (`046_pos_customers_sales_channels.sql`).
- **F0A:** `owner_profile_id` inmutable en orden; actor en eventos sigue ligado a `auth.uid()` en RPC 187.
- **187:** `open_pos_table_service`, `release_pos_table_service` — requieren `can_operate_pos_orders()` y reglas mesa/servicio.

### 7.2 RPC candidatas a `operator_token` (modo estación, futuro)

Sin modificar hoy — candidatas naturales por uso operativo en piso:

- `send_pos_order*` / producción (`185`+)
- `clear_pos_order_draft_items` (`186`)
- `open_pos_table_service`, `release_pos_table_service` (`187`)
- Pagos / cierre orden (migraciones POS/cash existentes)
- `create_production_tickets_from_order` (envío cocina)

Modo personal seguiría pasando solo JWT; modo estación añadiría validación de sesión operador en RPC (feature flag server-side, diseñado en doc POS estación).

### 7.3 Caja

- **`cash_registers`:** entidad nombrada (seed “Caja Principal”).
- **`cash_sessions`:** `opened_by` / `closed_by` → `profiles.id`; **sin** `device_id`.
- **Frontend `Cashier.jsx`:** opera con sesión auth (sin localStorage terminal en grep).
- **Concepto terminal física en caja:** **no existe**.

---

## 8. Configuración “estaciones” que ya existe (evidencia UI)

### 8.1 Dispositivos de marcaje (la más cercana a “estaciones”)

- **Ruta:** `/hr?section=dispositivosMarcaje`
- **Título UI:** “Dispositivos de marcaje” — *“Autoriza tablets o terminales del restaurante.”*
- **Acciones:** listar pending/authorized/blocked; autorizar (prompt nombre); bloquear; renombrar; toggles:
  - Requerir dispositivo autorizado
  - Requerir red/IP autorizada
  - Lista IPs permitidas
- **Quién administra:** `admin`, `gerente_general` (HR lectura).
- **Efecto real:** **Sí** — gate en `register_attendance_mark` → `assert_attendance_device_can_mark`.

### 8.2 Áreas de producción (estaciones de trabajo KDS)

- **Ruta:** `/production/areas`
- **Campos:** id/slug, nombre, descripción, sort, activo.
- **Efecto:** define qué áreas aparecen en hub KDS; **no** enrollment de pantalla.

### 8.3 Asignaciones producción

- **Ruta:** `/production/assignments`
- **Efecto:** limita qué KDS ve un colaborador (si no es manager).

### 8.4 Cajas

- Gestión en módulo cash / SQL seed; no UI dedicada “terminal caja” encontrada en rutas principales.

---

## 9. Autorización de dispositivos (transversal)

| Mecanismo | Asistencia | POS/KDS/Caja |
|-----------|------------|--------------|
| `device_id` persistente local | **Sí** (`attendanceKioskDeviceId`) | **No** |
| Fingerprint | No | No |
| QR / enrollment code | No | Diseño doc POS (Edge enroll) |
| Usuario técnico Supabase por estación | No | Diseño doc |
| Refresh token estación | No | Diseño doc |
| Revocación remota | **Sí** (block device) | No |
| `last_seen_at` | **Sí** | No |
| Trusted browser genérico | No | No |

**Modelo mínimo recomendado (conceptual):** estación lógica 1:N dispositivos autorizados + sesión operador PIN — **alineado con diseño POS estación**, no con estado actual KDS/caja.

**Cardinalidad ejemplo KDS Cocina (pantalla + tablet):** hoy **no modelable**; solo múltiples browsers con la **misma cuenta** o cuentas distintas.

---

## 10. Recursos Humanos / edición de usuario

- **Página:** `/hr?section=usuarios` → `ProfileManagement.jsx`
- **Secciones actuales:** datos personales, rol, área, estado cuenta, contacto, **PIN de marcaje** (4 dígitos, generar/mostrar/copiar), dispositivo autorizado de asistencia (texto), expediente/reactivación (PIN debe reconfigurarse al reactivar).
- **Servicios:** Supabase profiles + `attendanceService` (`set_attendance_pin`, `set_attendance_device`, validación unicidad).
- **Quién edita:** según rol HR/admin (`can_manage_attendance_for_profile`, permisos perfiles en migraciones 026+).

### Propuesta sección “Acceso operativo” (evaluación, sin implementar)

| Campo propuesto | Encaje actual |
|-----------------|---------------|
| PIN operativo Sí/No | **Nuevo** — no existe |
| Generar / restablecer / bloquear PIN | Patrón similar a PIN asistencia pero **tabla/RPC distintas** |
| Estaciones/tipos permitidos | Combinar rol + `user_production_areas` + futuro catálogo |
| Áreas KDS permitidas | **Ya** `user_production_areas` |
| Puede operar POS/Caja/Producción | Parcialmente rol + `can_operate_*`; frontend `ROLE_PERMISSIONS` |
| Historial último acceso | **No** operativo; asistencia tiene marcas/eventos |

**Regla PIN:** cumplir — nunca mostrar hash; PIN plano solo al generar (hoy asistencia permite “Mostrar PIN” en formulario de edición mientras el operador HR lo tenga en memoria de sesión — **no** leer de BD).

### Asignaciones: A vs B vs C

| Opción | Ajuste al sistema |
|--------|-------------------|
| A. Solo rol | Ya parcial (`can_operate_*`, `ROLE_PERMISSIONS`, mapeo rol→área en `kds.js`) |
| B. Solo explícitas | Parcial (`user_production_areas`) |
| **C. Rol default + excepciones** | **Recomendado** — ya ocurre en producción (trigger sync `area_id` + tabla asignaciones); extender a POS/caja/estaciones |

---

## 11. Matriz de acceso actual

Leyenda: **FP** = permiso frontend (`AuthContext` módulo); **BE** = función SQL / RLS representativa; **inc** = inconsistencia conocida.

| Rol | POS personal FP | KDS FP | Área KDS | Producción FP | Caja FP | Asistencia | BE POS | BE KDS | BE Caja | Inc |
|-----|-----------------|--------|----------|---------------|---------|------------|--------|--------|---------|-----|
| admin | Sí | Sí | Todas | Sí | Sí | HR + terminal | Sí | Sí | admin | — |
| gerente_general | Sí | Sí | Todas | Sí | Sí | HR + terminal | Sí | Sí | admin | — |
| supervisor | Sí | Sí | Todas | Sí | Sí | vía HR según ruta | Sí | Sí | supervisor | — |
| mesero | Sí | No | Asignación si existiera | No | No | Sí módulo hr | Sí | inc | no | FP KDS off |
| caja | Sí | No | — | No | Sí | Sí | Sí | no | operator | — |
| cajero | **No** FP | No | — | No | Sí | Sí | **Sí BE** | no | operator | **POS FP vs BE** |
| servicio | **No** FP | No | — | No | No | Sí | **Sí BE** | no | no | **POS FP vs BE** |
| cocinero/cocina | No | Sí | Rol→cocina / asignación | Sí | No | Sí | no | Sí | no | — |
| pizzero/pizzeria | No | Sí | pizzeria | Sí | No | Sí | no | Sí | no | — |
| barista/bartender | No | Sí | barra/cafeteria | Sí | No | Sí | no | Sí | no | — |
| encargado_area | No | Sí | Asignación | Sí | No | Sí | no | Sí | no | — |
| gerente_operaciones | No | Sí | Todas | Sí | No | según HR | no | Sí | no | POS FP off |
| rrhh / recursos_humanos | No | No | — | No | No | Sí (+ dispositivos read) | no | no | no | — |
| colaborador | No | No | — | No | No | Sí | no | no | no | — |

Roles listados provienen de `ROLE_PERMISSIONS` y `LEGACY_ROLE_NAMES` en `frontend/src/context/AuthContext.jsx` y gates SQL citados.

---

## 12. Gap analysis

| Capacidad | Clasificación |
|-----------|---------------|
| Catálogo estaciones unificado | **No existe** |
| Tipo estación (POS/KDS/caja) | **No existe** |
| Área KDS asignada | **Existe** — `areas` + rutas |
| Dispositivo autorizado (global) | **Parcial** — solo asistencia |
| Enrollment | **No** (asistencia: auto-register pending) |
| Revocación remota | **Parcial** — asistencia |
| PIN operativo | **No** |
| Rate limit PIN | **No** |
| Asignación empleado–estación | **Parcial** — producción |
| Operator session | **No** |
| Auditoría station + operator | **Parcial** — asistencia + POS owner/actor parcial |
| Acceso station-only | **No** |
| Fallback administrador | Implícito roles admin |
| Feature flag estación | **No** (doc diseño) |
| Realtime multi-dispositivo | KDS tickets **Sí**; estaciones **No** |

---

## 13. Propuesta mínima aditiva (post-auditoría, sin implementar)

Alineada a hallazgos + `pos-station-technical-design.md`:

1. **Conservar** áreas KDS, asignaciones, dispositivos asistencia (dominio separado).
2. **Añadir** catálogo `operational_stations` + `station_devices` (patrón `attendance_devices` generalizado).
3. **Añadir** PIN operativo **distinto** de asistencia + sesión operador de corta duración.
4. **Shell UI** “Estación operativa” con auto-route por tipo (POS/KDS/caja).
5. **Feature flag** dual: personal JWT vs estación.
6. **RPC:** parámetro opcional `operator_session_id` / token validado server-side (lista §7.2).

### Fases (solo planificación)

| Fase | Contenido |
|------|-----------|
| **A** | Foundation dispositivos + PIN operativo + auditoría |
| **B** | POS estación ( enrollment + operator en RPC POS ) |
| **C** | KDS por área con sesión operador (mantener URL área) |
| **D** | Caja / producción interna |
| **E** | Enforcement station-only tras pruebas |

---

## 14. Riesgos

1. **Pantallas compartidas** con un solo login Supabase — attribution incorrecta (waiter/owner vs actor real).
2. **Reutilizar PIN asistencia** — conflicto unicidad y blast radius.
3. **Inconsistencia POS_ROLES frontend vs `can_operate_pos_orders`** — usuarios bloqueados en UI pero autorizados en API (o viceversa).
4. **device_id en localStorage** — no prueba criptográfica de hardware (aceptable para asistencia con allowlist; replicar conscientemente).
5. **Sin rate limit PIN** — fuerza bruta 4 dígitos en terminal expuesto.
6. **localStorage POS** — plano legacy; no mezclar con verdad de estación.
7. **Big-bang** — doc diseño advierte rollout gradual; mantener acceso personal hasta Fase E.

---

## 15. Preguntas de negocio abiertas

1. ¿Una tablet POS debe ser **una estación** con múltiples meseros por PIN, o varias estaciones lógicas?
2. ¿KDS compartido exige **logout personal** hoy o se tolera cuenta genérica “Cocina”?
3. ¿Caja requiere **terminal física** identificada además del cajero?
4. ¿Supervisor debe autorizar **apertura de turno estación** diaria (como diseño POS estación)?
5. ¿Asignaciones KDS estrictas por persona o por rol con excepciones (recomendación técnica: C)?
6. ¿Integrar dispositivos asistencia y operativos en **una sola UI admin** o mantener dominios separados?

---

## 16. Diagnóstico remoto

- **Archivo:** `supabase/schema/diagnose_operational_stations_current_state.sql`
- **Contenido:** un JSON con conteos, RLS flags, existencia de tablas objetivo, settings asistencia (sin hashes).
- **Estado:** **ejecutado** — snapshot en sección “Snapshot remoto confirmado” al inicio de este documento.

---

## 17. Archivos inspeccionados

### Git / docs

- `docs/pos-station-technical-design.md`
- `docs/pos-f0a-owner-implementation.md`
- `docs/pos-table-service-lifecycle-technical-design.md`

### Frontend (principal)

- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/routes/ProtectedRoute.jsx`
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/utils/attendanceDevice.js`
- `frontend/src/utils/kds.js`
- `frontend/src/services/attendanceService.js`
- `frontend/src/services/posOrdersService.js`
- `frontend/src/services/productionAreasService.js`
- `frontend/src/services/productionTicketsService.js`
- `frontend/src/services/cashService.js`
- `frontend/src/components/AttendanceTerminal.jsx`
- `frontend/src/components/PosServiceTerminal.jsx`
- `frontend/src/pages/Kiosk.jsx`
- `frontend/src/pages/HR.jsx`
- `frontend/src/pages/ProfileManagement.jsx`
- `frontend/src/pages/AttendanceDevicesManagement.jsx`
- `frontend/src/pages/POS.jsx` (grep localStorage, POS_ROLES)
- `frontend/src/pages/Production.jsx`
- `frontend/src/pages/ProductionHub.jsx`
- `frontend/src/pages/ProductionAreasManagement.jsx`
- `frontend/src/pages/Cashier.jsx`

### Supabase schema (principal)

- `019_attendance_terminal.sql`
- `023_public_attendance_kiosk.sql`
- `059_attendance_authorized_devices.sql`
- `078_production_areas_user_assignments.sql`
- `009_production_tickets.sql`
- `010_pos_orders.sql`
- `045_cash_sessions_and_movements.sql`
- `046_pos_customers_sales_channels.sql` (`can_operate_pos_orders`)
- `155_attendance_mark_permission.sql` (muestreo permisos cadena)
- `184_pos_order_owner_f0a.sql`
- `187_pos_table_service_lifecycle.sql`

### Creados / actualizados en auditoría y diseño (solo documentación)

- `docs/operational-stations-current-state-audit.md` (este archivo)
- `supabase/schema/diagnose_operational_stations_current_state.sql`
- `docs/operational-stations-technical-design.md` (diseño unificado OS0, post-auditoría)

---

**Confirmación:** cero implementación funcional, cero SQL remoto ejecutado, cero commit, push o deploy en esta tarea.
