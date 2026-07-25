# Runbook — Aplicación controlada OS1 (Migración 190 + Edge)

**Para:** Juan Carlos  
**Rama de código:** `feat/operational-stations-os1` (commit `8513c365…`)  
**PR:** [#8 Draft](https://github.com/chefjuancarlosgarcia-a11y/alcazar-erp/pull/8)  
**Estado de este documento:** preparación únicamente — **no ejecutar pasos remotos** hasta aprobar el gate final (J).

---

## Qué es OS1 y qué NO hace todavía

- **OS1** agrega tablas y funciones para **estaciones operativas** (POS/KDS/Caja/Producción como concepto de “terminal fija”), enrollment de dispositivos y un **feature flag apagado por defecto**.
- El **Supabase del ERP es compartido**: la vista previa de Vercel (PR #8) puede usar el **mismo backend** que producción.
- **Aplicar la migración 190 no activa POS/KDS/Caja** ni meseros ni PIN (eso es **OS2**).
- **Desplegar la Edge Function no es lo mismo** que fusionar (`merge`) la PR a `main`.
- **El flag `operational_stations_enabled` debe quedar en `false`** hasta que usted decida activarlo en una fase posterior.
- **No pulse “Restore”** en el backup de Supabase salvo emergencia extrema acordada con soporte.

---

## Respaldos y entorno (leer antes de cualquier gate)

| Tema | Qué significa |
|------|----------------|
| Backup diario | En Supabase Dashboard → **Project Settings → Database → Backups**: confirmar que hay un backup reciente (últimas 24 h). |
| Preflight | Ejecutar SQL de solo lectura y **guardar captura** del resultado (PDF o imagen). |
| Rollback | **Forward-only**: script `supabase/rollback/190_operational_stations_foundation.rollback.sql` apaga flag, revoca permisos y revoca dispositivos activos; **no borra tablas** (auditoría). |
| Auth | La migración **no modifica** usuarios Auth existentes; `complete` en Edge **sí crea** usuarios técnicos de dispositivo **solo cuando** usted complete un enrollment real (Gate H). |
| Merge | **No es obligatorio** mergear la PR para aplicar SQL o Edge; son pasos independientes de Vercel. |

---

## Secretos y CORS (preparados, no ejecutar aún)

**Nombre del secret en Supabase (Edge):** `OPERATIONAL_STATION_ENROLL_ORIGINS`

**Lista inicial exacta** (orígenes completos, separados por coma, sin espacios extra):

1. `http://localhost:5174` — desarrollo local OS1  
2. `https://alcazar-erp-git-feat-d39d70-chefjuancarlosgarcia-a11ys-projects.vercel.app` — Preview Vercel PR #8  
3. `https://alcazar-erp.vercel.app` — producción ERP (cuando use enrollment desde prod)

**Comando futuro** (ejemplo; **no ejecutar** hasta Gate D):

```bash
supabase secrets set OPERATIONAL_STATION_ENROLL_ORIGINS="http://localhost:5174,https://alcazar-erp-git-feat-d39d70-chefjuancarlosgarcia-a11ys-projects.vercel.app,https://alcazar-erp.vercel.app"
```

**Variables que Supabase inyecta solas en Edge:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

**Decisión `verify_jwt` — APROBADA (obligatoria antes de Gate E):**

> **Advertencia:** Nunca desplegar `operational-station-enroll` con `verify_jwt = false` sin mantener en código la validación interna de **`authorize`** (`auth.getUser()` + `is_operational_stations_admin`). CORS y secretos de enrollment **no sustituyen** autenticación administrativa.

- **Configuración aprobada:** `operational-station-enroll` → **`verify_jwt = false`**
- **Motivo:** `claim`, `status` y `complete` usan secretos rotados; el dispositivo aún **no** tiene JWT personal.
- **`authorize`:** la Edge valida JWT admin real dentro de la función; no confiar solo en la configuración global de Supabase.
- **Despliegue CLI futuro (Gate E):** incluir explícitamente **`--no-verify-jwt`** en el deploy de esta función.

---

## Primera estación propuesta (solo documentación — no crear aún)

| Campo | Valor |
|-------|--------|
| Nombre | POS Salón 1 |
| Tipo | POS |
| Ubicación | Primer nivel |
| Estado inicial | `draft` hasta iniciar prueba; pasar a `active` solo al autorizar enrollment |
| Máximo dispositivos activos | 1 (índice único en base de datos) |
| Dispositivo de prueba | Laptop de Juan Carlos (simulación) |
| Meseros / PIN | **No** — OS2 |

---

# Gates (paso a paso)

Detenerse en cualquier gate si el **resultado esperado** no coincide. Guardar **evidencia** (captura) en cada gate superado.

---

## Gate A — Backup + preflight

**Dónde:** Supabase Dashboard → **SQL Editor** → New query.

**Qué pegar:** contenido completo de  
`supabase/schema/diagnose_operational_stations_preflight_190.sql`

**Resultado esperado:**

- `os1_tables_missing`: las cuatro tablas en `true` (aún no existen).
- `os1_functions_missing.claim_station_enrollment`: `true`.
- `os1_index_missing`: `true`.
- `flag_row.enabled`: `false` (o fila aún no existe → cuenta como apagado).
- `ready_to_apply_190`: `true`.
- Si `os1_any_partial_object`: `true` sin migración planificada → **STOP** (190 a medias).
- Conteos `profiles_active`, `areas`, `cash_registers`, `pos_orders` — **anotar números** para comparar después (no son datos personales).

**Evidencia:** captura del JSON `detail`.

**Detenerse si:** alguna tabla OS1 ya existe sin plan acordado, o el flag ya está `true`.

**Rollback aplicable:** ninguno (solo lectura).

**NO hacer:** Restore, DELETE, ni aplicar 190 todavía.

---

## Gate B — Aplicar migración 190

**Dónde:** SQL Editor → New query.

**Qué pegar:** archivo completo  
`supabase/schema/190_operational_stations_foundation.sql`  
(desde la línea `begin;` hasta `commit;` inclusive).

**Resultado esperado:**

- Mensaje de éxito sin error rojo.
- Una sola transacción (si algo falla, **nada** debe quedar a medias).

**Evidencia:** captura “Success” + hora.

**Detenerse si:** cualquier error SQL.

**Rollback aplicable:** no automático; ver rollback forward-only y Gate J.

**NO hacer:** activar flag, crear estaciones, ni correr tests de negocio todavía.

---

## Gate C — Test SQL 190

**Dónde:** SQL Editor → **nueva** query.

**Qué pegar:**  
`supabase/schema/190_test_operational_stations_foundation.sql`

**Resultado esperado:**

- Varias filas con `scenario`, `passed`, `detail`, `total`, `passed_total`, `failed_total`.
- **`failed_total = 0`** en todas las filas (criterio de aprobación).
- Al final la sesión hace **ROLLBACK** del test (no deja datos de prueba).

**Criterio estricto:** `failed_total = 0`. Los escenarios `runtime_skipped_requires_edge_auth_*` deben aparecer con `passed = true` (skip documentado).

**Evidencia:** captura de la grilla completa.

**Detenerse si:** algún check falla.

**Rollback aplicable:** Gate J si la migración ya quedó aplicada pero los checks fallan.

**NO hacer:** COMMIT manual ni mezclar con otros scripts en la misma pestaña.

---

## Gate D — Configurar CORS / secrets

**Dónde:** Supabase Dashboard → **Edge Functions → Secrets** (o CLI vinculada al proyecto).

**Qué hacer:**

1. Crear secret `OPERATIONAL_STATION_ENROLL_ORIGINS` con la lista exacta de la sección anterior.
2. **Aún no desplegar** la función si no cerró la decisión `verify_jwt`.

**Resultado esperado:** secret visible en lista (valor oculto).

**Evidencia:** captura de nombre del secret (sin pegar el valor en chats públicos).

**Detenerse si:** falta el origen del Preview que usará Juan Carlos.

**Rollback aplicable:** borrar o vaciar secret (solo si no hay deploy); no afecta DB.

**NO hacer:** usar `*` ni reflejar cualquier `Origin`.

---

## Gate E — Deploy Edge Function

**Precondición:** decisión **`verify_jwt = false`** documentada y aceptada.

**Dónde:** máquina con Supabase CLI autenticada **o** Dashboard deploy (según su flujo habitual).

**Qué desplegar:** carpeta  
`supabase/functions/operational-station-enroll/`  
(incluye `index.ts`, `deno.json`, `deno.lock`).

**Comando CLI de referencia (Gate E):**

```bash
supabase functions deploy operational-station-enroll --no-verify-jwt
```

**Configuración JWT:** desactivar verificación JWT **solo para esta función** (equivalente al flag `--no-verify-jwt` anterior).

**Resultado esperado:** función `operational-station-enroll` en estado **Active**, versión nueva.

**Evidencia:** captura Dashboard + hash de commit desplegado.

**Detenerse si:** deploy falla o secrets faltantes.

**Rollback aplicable:** redeploy versión anterior si existía; si no, desactivar función.

**NO hacer:** confiar en que `verify_jwt=true` protege `authorize` sin validación interna (ya está en código, pero claim/status/complete se romperían).

---

## Gate F — Smoke técnico (solo lectura en DB)

**Dónde:** SQL Editor.

**Qué pegar:**  
`supabase/schema/diagnose_operational_stations_postflight_190.sql`

**Resultado esperado:**

- `four_tables_exist`: true  
- `rls_all_true`: true  
- `flag_enabled`: false  
- `initial_os1_counts`: stations/devices/enrollments/events = **0**  
- `claim_rpc_anon_denied`: true  
- `no_take_secret_rpc`: true  
- Conteos legacy (`pos_orders`, etc.) **iguales** a Gate A (±0 si hubo actividad normal del negocio).

**Smoke HTTP (opcional, sin enrollment real):**

- `OPTIONS` desde origen allowlist → respuesta CORS con `Vary: Origin`.
- `POST` con JSON inválido → 400 genérico, sin datos sensibles en respuesta.

**Evidencia:** captura postflight + (opcional) respuesta 400.

**Detenerse si:** RLS false, flag true solo, o anon puede ejecutar `claim`.

---

## Gate G — Crear primera estación (manual admin)

**Dónde:** ERP Preview PR #8 o local `localhost:5174` → **Configuración → Estaciones operativas** (solo visible para admin/gerente).

**Qué crear:** estación **POS Salón 1**, tipo POS, primer nivel, estado **`draft`** primero; revisar código generado.

**Resultado esperado:** estación listada; **0 dispositivos** activos.

**Evidencia:** captura pantalla lista de estaciones.

**Detenerse si:** UI no carga o error de permisos.

**Rollback aplicable:** dejar estación en `revoked`/`inactive` vía UI o RPC admin; no borrar filas.

**NO hacer:** activar feature flag global.

---

## Gate H — Enrollment laptop (flujo feliz)

**Precondición:** estación en `active` solo para la ventana de prueba.

**Pasos (alto nivel):**

1. Admin genera QR / token enrollment (token **una sola vez** en pantalla).
2. Laptop abre enlace con `#token=…` → **claim** → guardar `device_claim_secret` solo en memoria/sessionStorage (no en servidor).
3. Admin **authorize** con código de confirmación.
4. Laptop **complete** → recibe tokens Auth; dispositivo queda `active`.

**Resultado esperado:** un dispositivo `active`, enrollment `completed`, estación sigue con **máximo 1** activo.

**Evidencia:** captura estado admin + evento en log (sin pegar tokens en chat).

**Detenerse si:** complete falla repetidamente (revisar Edge logs sin secretos).

**Rollback aplicable:** `revoke_station_device` + rollback SQL si necesario; ban usuario técnico Auth en Dashboard.

**NO hacer:** compartir QR en canales públicos.

---

## Gate I — Rechazo / bloqueo / reemplazo

**Objetivo:** validar que un dispositivo **blocked** no completa; segundo activo en la misma estación **rechazado** por índice único.

**Pasos sugeridos:**

1. Admin **rechaza/bloquea** dispositivo de prueba pendiente o activo (según escenario).
2. Intentar **complete** de nuevo con secret viejo → debe fallar (replay).
3. Probar **replace** / nuevo enrollment según procedimiento admin.

**Resultado esperado:** errores genéricos; estados `blocked` / `replaced` en DB.

**Evidencia:** capturas admin + postflight counts (≤1 active).

**Detenerse si:** replay permite segundo activo.

---

## Gate J — Decisión aprobar o rollback

**Opción A — Aprobar OS1 en preproducción compartida**

- Migración 190 aplicada y estable.
- Edge desplegada con CORS y `verify_jwt=false`.
- Flag **sigue false** hasta decisión de negocio.
- PR #8 puede seguir en Draft hasta QA completo.

**Opción B — Rollback operativo (sin DROP)**

1. Ejecutar  
   `supabase/rollback/190_operational_stations_foundation.rollback.sql`
2. Desactivar o no usar Edge enrollment.
3. Documentar incidente y conservar tablas para auditoría.

**Evidencia:** acta breve: quién, cuándo, gates superados o no.

**NO hacer en rollback:** Restore completo de DB salvo desastre; no iniciar OS2.

---

## Archivos de referencia rápida

| Archivo | Uso |
|---------|-----|
| `190_operational_stations_foundation.sql` | Migración |
| `190_test_operational_stations_foundation.sql` | Tests post-migración |
| `diagnose_operational_stations_preflight_190.sql` | Gate A |
| `diagnose_operational_stations_postflight_190.sql` | Gate F |
| `190_operational_stations_foundation.rollback.sql` | Neutralizar OS1 |
| `supabase/functions/operational-station-enroll/` | Edge enrollment |

---

## Contacto técnico

Ante cualquier duda en un gate, **detenerse** y consultar al responsable técnico con: captura del gate, hora UTC, y mensaje de error exacto (sin tokens ni contraseñas).
