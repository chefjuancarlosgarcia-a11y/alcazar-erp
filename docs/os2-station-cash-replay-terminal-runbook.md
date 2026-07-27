# OS2 Caja — replay idempotente con sesión terminal (post-apply)

Aplicar **después** de `194_station_cash_operator_wrappers.sql` en un entorno de prueba (no Caja Principal remota).

## Estados terminales que permiten **solo consultar** un `completed` previo

- `sale_complete`
- `shift_close`
- `manual_lock`, `expired` (u otra revocación): solo si existe fila `operational_station_cash_idempotency` con
  `idempotency_status = completed` vinculada al mismo `operator_session_id` derivado del hash del token en el dispositivo.

La razón de revocación **no basta**; debe existir la fila completed + coincidencia de fingerprint/operation/key/device/token.

## Escenarios manuales obligatorios (dos fases)

1. **Venta perdida post-commit**
   Ejecutar `record_station_cash_sale` con clave K hasta commit OK; simular pérdida de respuesta; confirmar
   `operational_operator_sessions.revoke_reason = sale_complete`; reintentar **misma** K → mismo JSON, sin nuevo
   `cash_movements`, sin extender `idle_expires_at`.

2. **Cierre perdido post-commit**
   Igual con `close_station_cash_session` y `shift_close`.

3. **Sesión terminal + clave nueva**
   Tras sale_complete/shift_close, llamada con clave K2 → `Operacion no permitida.` (sin mutación).

4. **Misma K, payload distinto**
   → `Conflicto de idempotencia: la clave ya se usó con otra operación.`

5. **Concurrencia misma K** (requiere **dos conexiones** SQL o dos clientes)
   - Conexión A: inicia mutación, detiene antes de commit (o usa `pg_sleep` en prueba controlada).
   - Conexión B: misma K → bloqueo `FOR UPDATE` en idempotency hasta commit de A; luego B recibe completed sin segunda mutación.

## ACL

Verificar:

```sql
select not has_function_privilege('authenticated', 'public.station_cash_create_movement_impl(text, text, numeric, text, text, uuid, text, boolean, boolean)', 'EXECUTE');
```

Automatizado en `194_test_station_cash_replay_terminal.sql`.
