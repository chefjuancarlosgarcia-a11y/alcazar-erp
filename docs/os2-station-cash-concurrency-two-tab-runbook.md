# CC194 — Concurrencia idempotencia 194 (dos sesiones SQL Editor)

Prueba **real** de `station_cash_idempotency_begin` / `complete` con dos conexiones Supabase independientes.
**No** usa estación cash productiva, dispositivo enrollado real ni wrappers con `auth.uid()`.

## Qué queda probado vs pendiente

| Capa | Esta prueba | Pendiente (post-Edge) |
|------|-------------|------------------------|
| `FOR UPDATE` + una fila `completed` | Sí | — |
| Misma key + fingerprint → una mutación | Sí (contador lab) | — |
| Misma key + fingerprint distinto → conflicto | Sí (verify) | — |
| `create_station_cash_movement` / `record_station_cash_sale` | No | JWT dispositivo + token operador |
| `resolve_station_cash_operator_context` | No | Smoke autenticado |

El SQL Editor corre como **postgres**: puede invocar helpers internos revocados a `authenticated`. Eso es intencional; **no** simula bypass inseguro en wrappers cliente.

## Requisitos previos

- 193 / 194 / 195 aplicadas; tests estructurales OK.
- Al menos un `profiles.status = 'active'` **sin** `cash_sessions.status = 'open'` (solo FK de sesión operador lab; no se abre caja humana).
- **Dos navegadores** con sesión SQL Editor independiente (no solo pestañas del mismo navegador):
  - **Google Chrome** — Control + Worker A
  - **Microsoft Edge** — Worker B
- UUID fijos del lab: register `19400000-…-0001`, station `…-0002`, device `…-0003`, operator session `…-0004`.

## Archivos

| Script | Cuándo |
|--------|--------|
| `194_concurrency_test_cleanup_only.sql` | Reset / fallo de setup / duda de estado (sin lab) |
| `194_concurrency_test_setup.sql` | Inicio de corrida |
| `194_concurrency_test_worker_a.sql` | Chrome — Worker A |
| `194_concurrency_test_worker_b.sql` | Edge — Worker B |
| `194_concurrency_test_verify_cleanup.sql` | Final (verificar + limpiar, **un solo grid**) |

## Recuperación (setup falló o estado desconocido)

El **setup** usa `BEGIN` … `COMMIT`. Si hay error, no hay commit de fixtures.

1. **`194_concurrency_test_cleanup_only.sql`**
2. Confirmar `status = cc194_cleanup_done`, `cleanup_required = false`
3. **Setup** de nuevo
4. Worker A (Chrome) y Worker B (Edge)

## Prueba completa (orden feliz)

### Chrome — Control

1. (Opcional) `cleanup_only`
2. **Setup** → `cc194_setup_ok`
3. Abrir pestaña SQL con **worker_a** precargado (no ejecutar aún)
4. Heartbeat (opcional):
   ```sql
   select worker, phase, updated_at from public.cc194_concurrency_heartbeat order by worker;
   ```

### Edge — Worker B (precarga)

5. Abrir pestaña SQL con **worker_b** precargado (no ejecutar aún).

### Concurrencia (ventana ~8 s)

6. **Chrome:** Run **worker_a** (transacción ~8 s).
7. Cuando heartbeat muestre `holding_lock`, **Edge:** Run **worker_b** (una sola vez).
8. **No** volver a ejecutar worker_a.

### Chrome — verify_cleanup

9. Ejecutar **verify_cleanup**.
   - Supabase muestra **una tabla** con columnas: `scenario`, `passed`, `detail`, `total`, `passed_total`, `failed_total`, `cleanup_status`, `cleanup_required`.
   - Esperado corrida OK: `passed_total = 7`, `failed_total = 0`, `cleanup_status = cc194_cleanup_done`, `cleanup_required = false`.

## Fallo de Worker A o B (lab ya existente)

- **A falló:** `cleanup_only` o `verify_cleanup` (limpia aunque `passed=false` en escenarios).
- **A OK, B no corrido:** ejecutar B en Edge; luego `verify_cleanup`.
- **Verify con fallos:** revisar `failed_total`; `cleanup_only` para reset.

## Resultado esperado (corrida OK)

- **1** fila idempotency con key `cc194-conc-key-001`.
- `mutation_count = 1` en lab (capturado antes del cleanup en verify).
- A y B: mismo JSON `completed`.
- Conflicto fingerprint alterno en verify.

## STOP — no continuar a Edge productivo si…

- Setup falla por falta de profile.
- Worker B obtiene NULL en begin.
- `failed_total > 0` en verify_cleanup (escenarios de concurrencia).

## Riesgos

- Profile real solo como FK (sin Auth user nuevo).
- Caja registradora **CC194 Test Register** aislada.
- Monto **0.01** solo en payload de fingerprint (no `cash_movements`).

## Recomendación

Ejecutar en remoto con flag false, **antes** de Edge JWT, tras `cleanup_only` + setup OK.

Ver también: `docs/os2-station-cash-replay-terminal-runbook.md`.
