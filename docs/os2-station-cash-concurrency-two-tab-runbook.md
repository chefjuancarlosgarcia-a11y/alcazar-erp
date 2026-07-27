# CC194 — Concurrencia idempotencia 194 (dos pestañas SQL Editor)

Prueba **real** de `station_cash_idempotency_begin` / `complete` con dos conexiones Supabase.
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
- Tres pestañas del SQL Editor (0 = control, 1 = A, 2 = B).
- UUID fijos del lab (válidos RFC): register `19400000-…-0001`, station `…-0002`, device `…-0003`, operator session `…-0004`.

## Archivos

| Script | Cuándo |
|--------|--------|
| `194_concurrency_test_cleanup_only.sql` | Reset / fallo de setup / duda de estado (sin lab) |
| `194_concurrency_test_setup.sql` | Inicio de corrida |
| `194_concurrency_test_worker_a.sql` | Pestaña 1 |
| `194_concurrency_test_worker_b.sql` | Pestaña 2 |
| `194_concurrency_test_verify_cleanup.sql` | Final de corrida exitosa (verificar + limpiar) |

## Recuperación (setup falló o estado desconocido)

El **setup** usa `BEGIN` … `COMMIT`. Si hay error, no hay commit de fixtures (salvo ejecutar cleanup explícito).

1. Ejecutar **`194_concurrency_test_cleanup_only.sql`** (idempotente; no requiere tablas `cc194_*`).
2. Confirmar `status = cc194_cleanup_done`, `cleanup_required = false`.
3. Ejecutar **setup** de nuevo.
4. Solo entonces **Worker A** y **Worker B**.

**No** usar `verify_cleanup` como primer paso si el lab nunca existió: devolverá `cc194_lab_missing_use_cleanup_only` (sin error 42P01) pero el propósito es **`cleanup_only`**.

## Prueba completa (orden feliz)

### Pestaña 0 — Control

1. (Opcional) `cleanup_only` si hubo intento previo.
2. Ejecutar **setup** → `cc194_setup_ok`, `station_code = cc194-conc-lab`.
3. Consulta heartbeat:
   ```sql
   select worker, phase, updated_at from public.cc194_concurrency_heartbeat order by worker;
   ```

### Pestaña 1 — Worker A (primero)

4. Ejecutar **worker_a** (~8 s en transacción).
5. Heartbeat: `starting` → `holding_lock` → `committed`.

### Pestaña 2 — Worker B (durante `holding_lock`)

6. Con A en `holding_lock`, ejecutar **worker_b**.
7. B termina con `phase = replay_ok`.

### Pestaña 0 — Verificar y limpiar

8. Ejecutar **verify_cleanup**.
   - **Exportar/capturar** el grid de escenarios (`passed_total`, `failed_total`) antes de cerrar el resultado; el script borra fixtures al continuar.
   - Esperado con lab completo: `passed_total = 7`, `failed_total = 0`.
   - Cierre: `cc194_cleanup_done`.

## Fallo de Worker A o B (lab ya existente)

- **A falló antes de commit:** `cleanup_only` o `verify_cleanup` (ambos limpian al final).
- **A commit OK, B no corrido:** ejecutar B una vez; luego `verify_cleanup`.
- **Verify con fallos:** revisar escenarios; luego `cleanup_only` para reset.

## Resultado esperado (corrida OK)

- **1** fila idempotency con key `cc194-conc-key-001`.
- `mutation_count = 1` en lab (antes del cleanup).
- A y B: mismo JSON `completed`.
- Conflicto fingerprint alterno en verify.

## STOP — no continuar a Edge si…

- Setup falla por falta de profile.
- Worker B obtiene NULL en begin.
- Verify (con lab presente) muestra `failed_total > 0` en escenarios de concurrencia.

## Riesgos

- Profile real solo como FK (sin Auth user nuevo).
- Caja registradora **CC194 Test Register** aislada.
- Monto **0.01** solo en payload de fingerprint (no `cash_movements`).

## Recomendación

Ejecutar en remoto con flag false, **antes** de Edge, tras `cleanup_only` + setup OK.

Ver también: `docs/os2-station-cash-replay-terminal-runbook.md`.
