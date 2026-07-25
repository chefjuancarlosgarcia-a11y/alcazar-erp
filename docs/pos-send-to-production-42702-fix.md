# Fix 42702 — `send_pos_order_to_production` alias ambiguity

**Fecha:** 2026-07-18  
**Contexto:** Simulación B F0A — envío a cocina falló en preprod compartida.  
**Migración preparada:** `supabase/schema/185_fix_send_pos_order_product_ambiguity.sql`  
**Estado Supabase:** **no aplicada** (solo preparación local).

## Causa raíz

En la versión desplegada (cuerpo de **`157_pos_implementation_mode.sql`**, no **`158`**):

```sql
declare
  product public.pos_products;  -- variable PL/pgSQL
...
from public.pos_order_items order_item
join public.pos_products product on product.id = order_item.product_id
```

PostgreSQL no puede resolver `product.id`: puede referirse a la **variable record** o al **alias de tabla**. Error **`42702: column reference "product.id" is ambiguous`**.

Colisiones en **`send_pos_order_to_production`** (157):

| Ubicación | Patrón conflictivo |
|-----------|-------------------|
| Loop reserva inventario (~718) | `join public.pos_products product` |
| Loop consumo inventario (~807) | `join public.pos_products product` |

## Definición canónica en repo

| Archivo | Rol |
|---------|-----|
| `010_pos_orders.sql` | Definición original |
| `041`, `051`, `131`, `012` | Evoluciones históricas |
| **`157_pos_implementation_mode.sql`** | **Desplegada en preprod** (con bug) |
| **`158_fix_pos_kds_product_id_ambiguity.sql`** | Fix ya escrito en repo, **no aplicado** en cloud |
| **`185_fix_send_pos_order_product_ambiguity.sql`** | Re-emisión post-184 para trazabilidad |

## Decisión de corrección

**Opción mínima solicitada:** renombrar alias SQL `product` → `catalog_product` (2 joins).

**Opción aplicada en 185:** reemitir el fix de **158** (`v_product` + alias `pop`/`poi`/`ar`).

| Criterio | Solo `catalog_product` | Fix 158 / 185 |
|----------|------------------------|---------------|
| Elimina 42702 | Sí | Sí |
| Riesgo de regresión futura | Medio (variable sigue `product`) | Bajo |
| Diff vs desplegado | ~4 líneas | ~renombre sistemático |
| Ya revisado en repo | No | Sí (158) |

`evaluate_pos_inventory_deduction(product, order_item)` usa la **variable** PL/pgSQL — no el alias; renombrar solo el alias habría bastado para compilar, pero **`v_product` + `pop`** evita toda la clase de colisión.

## Otras ambigüedades revisadas

| Función | Resultado |
|---------|-----------|
| `send_pos_order_to_production` | **Corregida en 185** |
| `consume_recipe_inventory` (157) | Variable `product`, sin alias `product` en SQL → **OK** |
| `get_pos_implementation_dashboard` (157) | Alias `product` solo en subquery SQL sin variable homónima → **OK** |
| `area`, `detail`, `ingredient` en 157 | Sin colisión con alias homónimo en la misma consulta → **OK** |

## Hallazgo separado (fuera de alcance)

Permisos rol **Caja** vs `can_operate_pos_orders()` — no modificado en 185.

## Archivos nuevos

- `supabase/schema/185_fix_send_pos_order_product_ambiguity.sql`
- `supabase/schema/185_test_send_pos_order_production_fix.sql`
- `frontend/scripts/sendPosOrderProduction185.selftest.mjs`
- `docs/pos-send-to-production-42702-fix.md` (este archivo)

## SQL read-only — orden fallida Mesa M1 / comanda `7747300A`

En UI, **Comanda No.** = primeros **8 caracteres** del UUID de `pos_orders.id` (`PosTicketPanel.jsx`).

```sql
-- 1) Localizar orden (ajustar filtros si hace falta)
select
  o.id,
  left(o.id::text, 8) as comanda_prefix,
  o.table_id,
  o.table_name,
  o.status,
  o.sent_at,
  o.created_at,
  o.updated_at
from public.pos_orders o
where left(o.id::text, 8) ilike '7747300a'
  and (
    o.table_name ilike '%m1%'
    or o.table_id ilike '%m1%'
  )
order by o.updated_at desc;

-- 2) Sustituir el UUID del paso 1 en los filtros siguientes (ej. '7747300a-....')
select
  poi.id as order_item_id,
  poi.status,
  poi.is_test_item,
  poi.inventory_consumed,
  poi.production_ticket_id,
  poi.product_name,
  poi.quantity,
  poi.updated_at
from public.pos_order_items poi
where poi.order_id = '00000000-0000-0000-0000-000000000000'::uuid  -- ← reemplazar
order by poi.created_at;

-- 3) Tickets KDS parciales (esperado: 0 filas tras fallo atómico)
select
  pt.id as ticket_id,
  left(pt.id::text, 8) as ticket_prefix,
  pt.order_id,
  pt.table_name,
  pt.area_name,
  pt.status,
  pt.created_at
from public.production_tickets pt
where pt.order_id = '00000000-0000-0000-0000-000000000000'  -- ← reemplazar (text)
order by pt.created_at desc;

-- 4) Eventos recientes de la orden
select
  e.event_type,
  e.description,
  e.created_at
from public.pos_order_events e
where e.order_id = '00000000-0000-0000-0000-000000000000'::uuid  -- ← reemplazar
order by e.created_at desc
limit 20;

-- 5) Resumen atómico
select
  o.id,
  o.status,
  count(poi.id) filter (where poi.status = 'draft') as draft_items,
  count(poi.id) filter (where poi.status <> 'draft') as non_draft_items,
  count(distinct pt.id) as kds_tickets
from public.pos_orders o
left join public.pos_order_items poi on poi.order_id = o.id
left join public.production_tickets pt on pt.order_id = o.id::text
where o.id = '00000000-0000-0000-0000-000000000000'::uuid  -- ← reemplazar
group by o.id, o.status;
```

**Esperado tras fallo 42702:** `draft_items >= 1`, `kds_tickets = 0`, sin eventos `ticket_created` / `sent_to_production` de ese intento.

## Procedimiento para aplicar y re-probar Sim B

1. SQL Editor → pegar **`185_fix_send_pos_order_product_ambiguity.sql`** → Run.
2. Ejecutar **`185_test_send_pos_order_production_fix.sql`** → `failed = 0`.
3. Re-ejecutar SQL read-only § orden fallida → confirmar ítem aún `draft`, 0 tickets.
4. Reintentar envío a cocina desde POS (Sim B) — **solo tras aprobación explícita**.
5. Verificar ticket KDS + ítems `sent_to_production` + sin consumo inventario si `is_test_item`.

**Rollback:** re-aplicar cuerpo 157 no es deseable; forward-only: mantener 185 o restaurar desde backup pre-185 si fuera necesario.

## F0A / F0B

- **F0A (184):** no revertida por este cambio.
- **F0B:** no iniciada.
