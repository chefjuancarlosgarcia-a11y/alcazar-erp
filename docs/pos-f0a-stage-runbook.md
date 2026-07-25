# F0A — Runbook Stage (no producción)

Ejecutar solo en **Stage** con SQL Editor o service_role. No aplicar en producción hasta aprobación.

## 1. Diagnóstico previo

```sql
-- Si 184 aún no aplicada, columnas owner pueden no existir — omitir errores o usar consultas básicas:
select count(*) as total_orders from public.pos_orders;
select count(*) as waiter_id_null from public.pos_orders where waiter_id is null;
```

Tras tener funciones (o post-184):

```sql
select * from public.diagnose_pos_order_owner_integrity() order by check_code;
select count(*) as orphan_rows from public.diagnose_pos_order_owner_orphans();
```

## 2. Aplicar migración

Ejecutar completo:

`supabase/schema/184_pos_order_owner_f0a.sql`

## 3. Diagnóstico posterior

```sql
select * from public.diagnose_pos_order_owner_integrity() order by check_code;
select count(*) as orphan_rows from public.diagnose_pos_order_owner_orphans();
-- Detalle técnico (solo Stage): select * from public.diagnose_pos_order_owner_orphans() limit 20;
```

Verificar:

- `owner_waiter_mismatch` = 0
- `open_orders_owner_null` revisado (aceptable solo si waiter huérfano)

## 4. Pruebas SQL / RLS

Ejecutar (QA only):

`supabase/schema/184_test_pos_order_owner_f0a.sql`

Esperado: todas las filas `passed = true`.

Prueba manual RLS (sesión mesero autenticada):

```sql
-- Debe fallar:
update public.pos_orders set waiter_id = auth.uid() where id = '<order_id>';
-- Si cambia waiter_id a otro valor distinto, debe fallar POS_ORDER_OWNER_IMMUTABLE
```

## 7. Criterios de aprobación Stage (obligatorios para producción)

Stage solo se considera **exitoso** si se cumplen **todos** los ítems. Hasta entonces **F0B permanece bloqueada**.

| # | Criterio | Cómo verificar | Evidencia esperada |
|---|----------|----------------|-------------------|
| 1 | **Cero pérdidas o cambios de órdenes** | Comparar conteos pre/post migración | `total_orders` idéntico; ningún `id` desaparecido; `status`, `total`, `table_id` sin drift masivo |
| 2 | **Huérfanos identificados y explicados** | Diagnóstico + nota escrita | Conteo `waiter_id_orphan_*`; lista acotada de `order_id` si aplica; explicación (perfil eliminado, legacy, etc.) |
| 3 | **Todas las pruebas SQL/RLS aprobadas** | `184_test_pos_order_owner_f0a.sql` + UPDATE bloqueado | `failed = 0`; `POS_ORDER_OWNER_IMMUTABLE` en intento directo |
| 4 | **Orden nueva: owner = waiter** | Crear orden en POS + query | `owner_profile_id = waiter_id = auth.uid()` del creador |
| 5 | **Otro mesero ayuda sin apropiarse** | Mesero B agrega ítem a mesa de A | `owner_profile_id`/`waiter_id` siguen siendo A; ítem/evento registran actor B (`created_by` / flujo actual) |
| 6 | **KDS, cuenta y cobro OK** | Flujo completo una mesa | Envío producción, solicitar cuenta / caja, cobro parcial o total sin error |
| 7 | **Ranking mismos totales** | Comparar ranking mes actual pre/post | Misma suma `total_sales` por mesero; solo cambia agrupación interna si owner≠waiter (no debe ocurrir post-backfill) |
| 8 | **Sin errores nuevos en Operations Center** | Revisar OC durante y 30 min post | Sin alertas/spikes nuevos ligados a POS, owner, ranking |

### Consultas de evidencia

**Integridad pre/post (guardar snapshot antes de 184):**

```sql
select count(*) as total_orders from public.pos_orders;
select status, count(*) from public.pos_orders group by 1 order by 1;
select coalesce(sum(total), 0) as sum_total_paid
from public.pos_orders where status = 'paid';
```

**Tras migración — mismas consultas + diagnóstico:**

```sql
select * from public.diagnose_pos_order_owner_integrity() order by check_code;
select count(*) as orphan_rows from public.diagnose_pos_order_owner_orphans();
```

**Orden nueva (reemplazar UUIDs):**

```sql
select id, waiter_id, owner_profile_id, waiter_name, status, created_at
from public.pos_orders
where id = '<order_id>'
  and owner_profile_id = waiter_id;
```

**Ayuda entre meseros (orden creada por A, ítem agregado por B):**

```sql
select o.id, o.owner_profile_id, o.waiter_id, oi.id as item_id, oi.created_at
from public.pos_orders o
join public.pos_order_items oi on oi.order_id = o.id
where o.id = '<order_id>'
order by oi.created_at desc
limit 5;
-- owner_profile_id debe seguir siendo A; created_by en eventos refleja B si aplica
```

**Ranking pre/post (mes en curso):**

```sql
select profile_id, display_name, total_sales, order_count
from public.get_waiter_sales_ranking(current_date, false)
order by rank_position;
```

Exportar resultado **antes** y **después** de 184; totales por `profile_id` deben coincidir.

### Regresión POS manual (checklist)

- [ ] Mesero A abre mesa → crea orden  
- [ ] Mesero A agrega productos draft  
- [ ] Mesero B (misma estación/sesión legacy) agrega producto a la misma mesa  
- [ ] Propietario sigue siendo A (consulta SQL arriba)  
- [ ] Enviar a KDS — ticket visible, sin duplicado  
- [ ] Solicitar cuenta / enviar a caja  
- [ ] Cobro en `/cash` — orden pasa a pagada o parcial según flujo  
- [ ] Operations Center — sin errores nuevos  

### Plantilla de reporte Stage (completar y adjuntar)

```
Entorno Stage: ___________
Fecha migración 184: ___________
Ejecutor: ___________

1. total_orders pre: ___  post: ___  OK/FAIL
2. orphans: count ___  explicación: ___________
3. 184_test failed: ___  OK/FAIL
4. orden nueva owner=waiter: OK/FAIL  order_id: ___
5. ayuda mesero B sin robar owner: OK/FAIL  order_id: ___
6. KDS / cuenta / cobro: OK/FAIL  notas: ___________
7. ranking totales iguales: OK/FAIL  delta: ___________
8. Operations Center limpio: OK/FAIL  notas: ___________

Decisión: APROBAR PROD / NO APROBAR
F0B: BLOQUEADA hasta aprobación explícita post-Stage
```

## 8. Rollback forward-only (si falla)

No DROP columnas. Migración forward `184_rollback_pos_order_owner_f0a.sql` (crear solo si necesario):

- Drop triggers guard/sync
- Restaurar policy INSERT anterior
- Restaurar `get_waiter_sales_ranking` desde 048
- Columna `owner_profile_id` puede permanecer nullable

## 9. Verificación manual POS (acceso roles)

1. Login mesero → crear orden en mesa  
2. Agregar producto draft  
3. Verificar en BD: `owner_profile_id = waiter_id = mesero.id`  
4. Login cajero → confirmar **no** accede a UI POS (mensaje permiso)  
5. Login servicio → confirmar **no** accede a UI POS  

## 10. Puerta a producción

- **Producción:** solo tras checklist §7 completo + reporte firmado.  
- **F0B:** no iniciar hasta aprobación explícita de F0A en Stage.

---

## 11. Fase 187 — ciclo base mesa (preparada, no aplicada)

**Estado:** código y SQL listos en repo principal; **no aplicado** en Supabase remoto ni portado al worktree F0A (`alcazar-inventario-f0a-preprod`).

### Archivos

| Archivo | Propósito |
|---------|-----------|
| `supabase/schema/187_pos_table_service_lifecycle.sql` | RPC open/release, idempotencia, índice UNIQUE parcial |
| `supabase/schema/diagnose_pos_table_service_lifecycle_187.sql` | Diagnóstico read-only pre-índice |
| `supabase/schema/187_test_pos_table_service_lifecycle.sql` | Tests A1–A17 (BEGIN/ROLLBACK) |
| `supabase/rollback/187_pos_table_service_lifecycle.rollback.sql` | Rollback forward-only |
| `frontend/src/services/posOrdersService.js` | `openPosTableService`, `releasePosTableService` |
| `frontend/src/pages/POS.jsx` | Zombie `pendiente_cierre`, open RPC, liberar mesa |
| `frontend/src/components/PosTicketPanel.jsx` | Salir de vista, Liberar mesa |
| `frontend/scripts/posTableServiceLifecycle187.selftest.mjs` | Selftest estático offline |

### Secuencia controlada (tras `APLICAR 187 EN PREPRODUCCIÓN`)

1. Ejecutar diagnóstico read-only y exportar resultados (duplicados, evidencia `4e6ba009-…`).
2. Si Q3 duplicados = 0: aplicar `187_pos_table_service_lifecycle.sql` completo.
3. Ejecutar `187_test_pos_table_service_lifecycle.sql` → `failed = 0` (runtime RPC requiere sesión autenticada; estáticos pasan como postgres).
4. Selftests: `node frontend/scripts/posTableServiceLifecycle187.selftest.mjs`, F0A, 185, 186.
5. Portar **solo frontend 187** al worktree F0A; validar L3 manual con supervisor sobre orden evidencia (sin modificarla automáticamente).

### Gate

Frase requerida: **`APLICAR 187 EN PREPRODUCCIÓN`**. No aplicar 188 ni 189 en la misma ventana.
