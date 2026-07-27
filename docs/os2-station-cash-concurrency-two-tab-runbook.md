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

## Archivos

1. `supabase/schema/194_concurrency_test_setup.sql`
2. `supabase/schema/194_concurrency_test_worker_a.sql`
3. `supabase/schema/194_concurrency_test_worker_b.sql`
4. `supabase/schema/194_concurrency_test_verify_cleanup.sql`

## Orden (Juan Carlos)

### Pestaña 0 — Control

1. Pegar y ejecutar **setup** completo → fila `cc194_setup_ok`, `station_code = cc194-conc-lab`.
2. Dejar esta pestaña abierta para consultas:
   ```sql
   select worker, phase, updated_at from public.cc194_concurrency_heartbeat order by worker;
   ```

### Pestaña 1 — Worker A (primero)

3. Ejecutar **worker_a** → tarda ~8 s en transacción (normal).
4. En pestaña 0, refrescar heartbeat: debe pasar `starting` → `holding_lock` → `committed`.

### Pestaña 2 — Worker B (durante `holding_lock`)

5. **Mientras A sigue ejecutando** (fase `holding_lock`), ejecutar **worker_b** en pestaña 2.
   - B puede tardar hasta que A haga `COMMIT` (bloqueo en idempotency).
6. B debe terminar con `phase = replay_ok`.

### Pestaña 0 — Verificar y limpiar

7. Ejecutar **verify_cleanup** (una sola vez).
   - Esperado: `passed_total = 7`, `failed_total = 0`, escenarios incl. `single_idempotency_row`, `single_lab_mutation`, `conflict_fingerprint_raises`.
   - Al final del script: cleanup automático + `cc194_cleanup_done`.

## Resultado esperado

- **1** fila en `operational_station_cash_idempotency` con key `cc194-conc-key-001`.
- `mutation_count = 1` en lab (antes del cleanup).
- A y B: mismo JSON `completed` (B vía replay, sin segunda mutación).
- Conflicto: fingerprint alterno → mensaje `Conflicto de idempotencia:…`.

## STOP — no continuar a Edge si…

- Setup falla por falta de profile (resolver sesiones humanas abiertas o usar cuenta lab).
- Worker A termina antes de 8 s con error (no ejecutar B hasta corregir).
- Worker B obtiene NULL en begin (doble mutación).
- Verify muestra `failed_total > 0`.

## Recuperación si una pestaña falla

1. **A falló / pestaña cerrada:** ejecutar solo verify_cleanup (elimina fixture cc194) y repetir desde setup.
2. **B no llegó a ejecutarse:** si A ya hizo commit, B aún debe devolver replay; ejecute B una vez. Luego verify_cleanup.
3. **Quedaron tablas `cc194_*`:** ejecutar verify_cleanup (idempotente en cleanup).
4. **Duda de estado:**
   ```sql
   select count(*) from public.operational_station_cash_idempotency where idempotency_key like 'cc194-conc-%';
   select * from public.operational_stations where station_code = 'cc194-conc-lab';
   ```
   Si count > 0 o estación existe → verify_cleanup.

## Riesgos

- Usa un **profile real** solo como FK (no crea Auth user).
- Crea caja registradora **CC194 Test Register** (no Caja Principal).
- Monto simbólico **0.01** solo en payload de fingerprint (no inserta `cash_movements`).

## Recomendación

**Ejecutar** en remoto de staging/pre-prod con flag aún false, **antes** de Edge, si setup OK y hay profile disponible.
**No ejecutar** en horario pico si no hay profile sin sesión humana abierta.

Ver también: `docs/os2-station-cash-replay-terminal-runbook.md`.
