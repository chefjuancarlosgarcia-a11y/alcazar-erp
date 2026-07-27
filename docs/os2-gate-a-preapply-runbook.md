# OS2 Caja — Gate A–K runbook (193 / 194)

Worktree: `C:\Users\chefj\alcazar-inventario-os1`
Branch: `feat/operational-stations-os2-cash`
Draft PR: [#9](https://github.com/chefjuancarlosgarcia-a11y/alcazar-erp/pull/9)

**Estado remoto (actualizado):** 190/191/192 + **193 aplicadas**; **194 falló y fue revertida** (transacción); **195 pendiente**; Edge no desplegada; `operational_stations_enabled = false`; sin PIN operativo real. **193 remoto** puede seguir con `public.digest` / `crypt` sin calificar hasta aplicar **195** (canónica 193 ya usa `extensions.*` solo para instalaciones nuevas).

**Orden apply recomendado:** preflight 194 (rollback limpio) → 194 corregida → postflight 194 → **195 forward-fix pgcrypto** → test/postflight 195 → **tests runtime 194** (replay/concurrencia) → Edge/PIN.

**Regla:** No avanzar de gate si hay fila con `is_blocker = true` en el diagnóstico correspondiente (salvo gate informativo explícito).

---

## Gate A — Preflight read-only (remoto SQL Editor)

| Paso | Acción |
|------|--------|
| Archivo | `supabase/schema/diagnose_operational_operator_access_preflight_193.sql` |
| Comando | Pegar y ejecutar **un solo** script en Supabase SQL Editor (proyecto remoto). |
| Extra OS1 ACL | `supabase/schema/diagnose_operational_stations_function_acl_190.sql` — revisar `access_ok = false` en funciones OS1. |
| Extra estado | `supabase/schema/diagnose_operational_stations_current_state.sql` (opcional, sin PII). |

**Resultado esperado**

- Todas las filas OS1 / ausencia 193–194 / compatibilidad con `is_blocker = false`.
- `baseline_counts_non_sensitive`: informativo (`is_blocker = false`).
- `flag_operational_stations_disabled`: `detail.enabled = false`.

**STOP**

- Cualquier `is_blocker = true` (p. ej. tablas 193 ya presentes, ≠1 caja cash active, ≠1 dispositivo active, register inactivo, flag ya true).

**Rollback / forward-fix**

- No aplica DDL en Gate A. Corregir datos OS1 (estación, dispositivo, register) o aplicar 191/192 faltantes antes de 193.

**Evidencia**

- Export CSV/JSON del result set (`gate_code`, `is_blocker`, `detail`).
- Captura de ACL 190 sin filas bloqueantes.

---

## Gate B — Aplicar migración 193

| Paso | Acción |
|------|--------|
| Archivo | `supabase/schema/193_operational_operator_access_foundation.sql` |
| Comando | Ejecutar script completo una vez (contiene `begin`/`commit` único). |
| Rollback file | `supabase/rollback/193_operational_operator_access_foundation.rollback.sql` (solo si falla post-apply o rollback planificado). |

**Resultado esperado**

- Commit sin error; cuatro tablas OS2; RPC verify/touch/lock/admin; flag sigue false.

**STOP**

- Error en transacción, objeto parcial, o pepper insert conflict no resuelto.

**Evidencia**

- Mensaje “Success” del editor + timestamp.

---

## Gate C — Test + postflight 193

| Paso | Acción |
|------|--------|
| Test | `supabase/schema/193_test_operational_operator_access.sql` |
| Postflight | `supabase/schema/diagnose_operational_operator_access_postflight_193.sql` |

**Resultado esperado**

- Test: todas las filas `ok = true`; termina en `ROLLBACK` (no persiste `test_*` si el editor envuelve en transacción — el script ya hace `rollback`).
- Postflight: sin blockers; `flag_still_disabled`; `ready_for_194` con idempotency ausente.

**STOP**

- Cualquier `ok = false` o postflight blocker (RLS off, pepper/lookup helpers expuestos a `authenticated`).

**Rollback**

- `supabase/rollback/193_operational_operator_access_foundation.rollback.sql`

**Evidencia**

- Export test + postflight.

---

## Gate D — Preflight 194 (antes de aplicar)

| Paso | Acción |
|------|--------|
| Archivo | `supabase/schema/diagnose_station_cash_preflight_194.sql` |

**Resultado esperado**

- 193 presente; wrappers/helpers 194 ausentes; flag false; RPC humanos 045 existentes.

**STOP**

- Blockers en preflight 194 o Gate C incompleto.

---

## Gate E — Aplicar migración 194

| Paso | Acción |
|------|--------|
| Archivo | `supabase/schema/194_station_cash_operator_wrappers.sql` |
| Rollback | `supabase/rollback/194_station_cash_operator_wrappers.rollback.sql` |

**Resultado esperado**

- Tabla idempotency + wrappers cliente; `resolve_*` / `*_impl` / bind / replay **sin** EXECUTE para `authenticated`.

**STOP**

- Error SQL o grants incorrectos detectados en postflight.

---

## Gate F — Test + postflight 194 + concurrencia

| Paso | Acción |
|------|--------|
| Test wrappers | `supabase/schema/194_test_station_cash_operator_wrappers.sql` |
| Test replay ACL | `supabase/schema/194_test_station_cash_replay_terminal.sql` |
| Postflight | `supabase/schema/diagnose_station_cash_postflight_194.sql` |
| Concurrencia | `docs/os2-station-cash-replay-terminal-runbook.md` — **dos conexiones**, fixtures UUID, **no** usar Caja Principal productiva para mutaciones. |

**Resultado esperado**

- Tests: `ok = true` en todos los escenarios; `ROLLBACK` al final.
- Postflight: wrappers granted, internals denied.
- Runbook concurrencia: replay terminal idempotente sin filas huérfanas.

**STOP**

- Fallo replay-first order, impl ejecutable por cliente, idempotency counts anómalos post-fixture.

**Nota (pgcrypto 193 remoto):** Los tests **estructurales** de 194 (wrappers, ACL, replay terminal sin crypto 193) pueden correr tras Gate E. Escenarios **runtime** que ejecuten `verify_operational_pin_for_device` / hashing 193 deben correr **después de Gate F2 (195)**.

**Evidencia**

- Exports tests + postflight + notas runbook concurrencia.

---

## Gate F2 — Forward-fix 195 (pgcrypto en RPC 193)

| Paso | Acción |
|------|--------|
| Preflight | `supabase/schema/diagnose_operational_operator_pgcrypto_preflight_195.sql` |
| Migración | `supabase/schema/195_fix_operational_operator_pgcrypto_schema.sql` |
| Test | `supabase/schema/195_test_operational_operator_pgcrypto_schema.sql` |
| Postflight | `supabase/schema/diagnose_operational_operator_pgcrypto_postflight_195.sql` |
| Rollback | `supabase/rollback/195_fix_operational_operator_pgcrypto_schema.rollback.sql` (no-op intencional; no downgrade seguro) |

**Resultado esperado**

- Preflight: 194 presente; legacy `public.digest` o `crypt` sin `extensions.` en cuerpos 193; `ready_to_apply_195` sin blocker.
- 195: `CREATE OR REPLACE` de cuatro RPC; cero filas/PIN/pepper/flag tocados.
- Test: cero `public.digest` en `pg_get_functiondef`; runtime smoke `extensions.digest/crypt/hmac` en `BEGIN`/`ROLLBACK`.
- Postflight: sin legacy pgcrypto en funciones afectadas.

**STOP**

- Aplicar 195 antes de 194; o legacy aún presente post-195; o test runtime smoke falla.

**No reaplicar** `193_operational_operator_access_foundation.sql` en remoto solo por este fix.

---

## Gate G — Deploy Edge `operational-station-access`

| Paso | Acción |
|------|--------|
| Directorio | `supabase/functions/operational-station-access/` |
| Comando local (validación previa) | `deno check --config supabase/functions/operational-station-access/deno.json supabase/functions/operational-station-access/index.ts` |
| Deploy remoto | `supabase functions deploy operational-station-access` con **verify JWT habilitado** en el proyecto (no desplegar con `--no-verify-jwt`). |
| Secretos | `OPERATIONAL_STATION_ENROLL_ORIGINS` alineado con preview/prod enroll origins. |

**Resultado esperado**

- Función desplegada; POST exige `Authorization: Bearer` (device user JWT).

**STOP**

- Deploy sin JWT verify; CORS allowlist vacía en prod.

**Housekeeping**

- No commitear `supabase/functions/operational-station-access/node_modules/` (cache Deno). Eliminar local: `Remove-Item -Recurse -Force supabase/functions/operational-station-access/node_modules` (opcional). Añadir `.gitignore` local con `node_modules/` y `.deno/` **en commit separado** si se desea.

---

## Gate H — CORS / JWT smoke (sin PIN real)

| Paso | Acción |
|------|--------|
| Método | `OPTIONS` + `POST` desde origin allowlisted **sin** body PIN válido. |
| Body | `{ "action": "verify_pin", "module": "cash", "pin": "000000" }` con JWT de dispositivo enrollado. |

**Resultado esperado**

- 401 sin Bearer; 400 genérico con PIN inválido (no filtrar existencia de usuario); CORS headers solo en origins permitidos.

**STOP**

- 200 con PIN dummy; leak de stack trace; CORS `*` en prod.

---

## Gate I — PIN temporal + assignment

| Paso | Acción |
|------|--------|
| RPC | `admin_set_operational_pin(profile_id, pin)` + `admin_assign_operational_station(profile_id, station_id, true)` vía usuario **operational access admin** (ERP), no SQL manual con PIN en ticket. |
| Rotación | Documentar destrucción del PIN temporal post-smoke. |

**Resultado esperado**

- Assignment activo para perfil de prueba; PIN **nunca** en logs/chat.

**STOP**

- PIN en plaintext en DB (postflight 193 debe mostrar solo hash/lookup).

---

## Gate J — Smoke Caja Principal (sin dinero real)

| Paso | Acción |
|------|--------|
| UI | Preview Vercel + ruta estación caja (`StationCashEntry` / device route). |
| Flujo | Device JWT → PIN operador → context → abrir turno **monto 0** → lock session. |
| Idempotencia | Repetir misma acción con mismo `x-idempotency-key` (sessionStorage intent). |

**Resultado esperado**

- Una sesión open por caja; cierre solo opener o supervisor+; ventas acotadas a register de estación.

**STOP**

- Doble open; movimiento en register ajeno; idle no expira ~90s sin actividad humana.

---

## Gate K — Flag / Preview / merge

| Decisión | Criterio |
|----------|----------|
| `operational_stations_enabled` | Mantener **false** hasta sign-off explícito producto + evidencia Gates A–J. |
| Preview | PR #9 green (Vercel + selftests CI si aplica). |
| Merge | Solo tras Gates B–J completos en staging/remoto acordado. |

**Evidencia final**

- Checklist firmado, exports pre/post flight, hash commit desplegado.

---

## Orden de aplicación SQL (resumen)

1. Gate A diagnose preflight 193 (+ ACL 190)
2. `193_operational_operator_access_foundation.sql`
3. `193_test_*` + postflight 193
4. preflight 194
5. `194_station_cash_operator_wrappers.sql`
6. `194_test_*` + postflight 194 + runbook concurrencia
7. Edge deploy → smoke → PIN → caja smoke → flag decision

---

## Validaciones locales (sin remoto)

Desde `C:\Users\chefj\alcazar-inventario-os1\frontend`:

```powershell
node scripts/operationalStationsOs2.selftest.mjs
node scripts/operationalStationsOs2Cash.selftest.mjs
node scripts/operationalStationsOs2Idle.selftest.mjs
node scripts/operationalStationsOs2Idempotency.selftest.mjs
node scripts/operationalStationsOs2ReplayTerminal.selftest.mjs
npm run build
```

```powershell
deno check --config supabase/functions/operational-station-access/deno.json supabase/functions/operational-station-access/index.ts
git diff --check
git status
```

Confirmar `node_modules` bajo Edge **untracked** y **not staged**.

---

## Auditoría estática migraciones (referencia)

| Criterio | 193 | 194 |
|----------|-----|-----|
| `begin`/`commit` único | Sí | Sí |
| Additive / no toca 045 lógica | Sí | Sí (wrappers) |
| PIN plaintext | No (hash + lookup) | N/A |
| Rate limit persistente | `operational_pin_attempt_buckets` | N/A |
| Token operador | Solo hash en sesión | Bind/replay internal |
| Idle 90s | Sí en verify/touch | Extiende en mutaciones |
| Flag OS | No activa | No activa |
| RLS tablas nuevas | Sí | Idempotency RLS |
| attendance_credentials | Sin modificar | Sin modificar |

Tests SQL: 193/194/replay usan `BEGIN`/`ROLLBACK`; no `COMMIT`. Replay terminal test no inserta fixtures (solo ACL/orden); concurrencia con datos en runbook aparte. **Gap menor:** tests 193/194 no agregan fila única `total/passed/failed` (solo filas por escenario).
