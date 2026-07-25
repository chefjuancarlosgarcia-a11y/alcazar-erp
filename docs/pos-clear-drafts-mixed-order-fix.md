# Hotfix 186 — «Anular pendientes» en órdenes mixtas

**Estado Supabase:** preparado localmente; **186 no aplicada**.  
**Orden reproducible Sim B:** `4e6ba009-84ae-421e-9c6b-3217b3863dca` — **no modificada** por este trabajo.

## Causa raíz

Doble bloqueo cuando la orden tiene ítems enviados + drafts:

1. **Frontend** `handleClearDraftItems` retornaba si `sentItems.length > 0`.
2. **RPC** `clear_pos_order_draft_items` rechazaba la orden si existía cualquier fila con `status <> 'draft'` y `<> 'cancelled'`.

El botón UI promete «Elimina solo productos aún no enviados», pero la lógica impedía exactamente el caso mixto.

## Comportamiento

| | Antes | Después (186 + frontend) |
|---|--------|---------------------------|
| Orden solo drafts | DELETE drafts + evento `draft_cleared` | Igual |
| Orden mixta (enviado + draft) | **Bloqueado** (mensaje autorización) | DELETE **solo** drafts |
| Ítems `sent_to_production` | No tocados (pero tampoco se podía limpiar draft) | **No tocados** |
| `production_tickets` | No tocados | **No tocados** |
| Inventario / `inventory_consumed` | No tocados | **No tocados** |
| `owner_profile_id` / `waiter_id` | No tocados | **No tocados** |
| Cancelar enviados | Flujo supervisor / legacy | **Sin cambio** |

## Draft vs enviado

| Concepto | Status típico | «Anular pendientes» |
|----------|---------------|---------------------|
| Draft | `draft` | **Elimina** (DELETE) |
| Enviado a cocina | `sent_to_production`, … | **No toca** |
| Cancelado histórico | `cancelled` | **No toca** |

## Archivos

| Archivo | Rol |
|---------|-----|
| `supabase/schema/186_fix_clear_pos_order_draft_items_mixed_order.sql` | Migración |
| `supabase/schema/186_test_clear_pos_order_draft_items.sql` | Tests (BEGIN/ROLLBACK) |
| `supabase/rollback/186_clear_pos_order_draft_items.rollback.sql` | Rollback forward RPC |
| `frontend/scripts/clearPosOrderDraftItems186.selftest.mjs` | Selftest estático |
| `frontend/src/pages/POS.jsx` | Quita guardia `sentItems` |

## Prueba reproducible (orden real — manual post-186)

**Pre (read-only):**

```sql
select poi.id, poi.status, poi.is_test_item, poi.production_ticket_id
from public.pos_order_items poi
where poi.order_id = '4e6ba009-84ae-421e-9c6b-3217b3863dca'::uuid
order by poi.created_at;
```

Esperado: 1× `sent_to_production` + 1× `draft`.

Tras aplicar 186 y pulsar «Anular pendientes» en POS (o RPC):

**Post (read-only):**

```sql
select count(*) filter (where status = 'draft') as drafts,
       count(*) filter (where status = 'sent_to_production') as sent_lines
from public.pos_order_items
where order_id = '4e6ba009-84ae-421e-9c6b-3217b3863dca'::uuid;
```

Esperado: `drafts = 0`, `sent_lines = 1`.

## Procedimiento de aplicación controlada

1. SQL Editor → `186_fix_clear_pos_order_draft_items_mixed_order.sql` → Run  
2. `186_test_clear_pos_order_draft_items.sql` → `failed = 0`  
3. Frontend local con cambio en `POS.jsx` (worktree F0A o repo principal)  
4. Sim B: orden mixta → «Anular pendientes» → verificar post-SQL arriba  
5. Confirmar KDS ticket del ítem enviado intacto  

## Rollback forward

1. SQL Editor → `supabase/rollback/186_clear_pos_order_draft_items.rollback.sql`  
2. Restaurar guardia `sentItems` en `POS.jsx` (ver comentario en rollback)  
3. No implica DROP ni pérdida de datos  

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Eliminar draft accidental en orden mixta | UI ya limita a drafts; opcional confirm dialog futuro |
| Solo arreglar frontend sin 186 | RPC seguiría fallando — aplicar ambos |
| Confundir con cancelación post-envío | Documentación; flujos supervisor sin cambio |

## Fuera de alcance

- Permisos rol **Caja** (hallazgo aparte)  
- **F0B**  
- Reversión **184** / **185**  
