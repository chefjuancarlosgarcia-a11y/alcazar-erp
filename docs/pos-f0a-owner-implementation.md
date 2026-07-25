# F0A — Propiedad de orden POS (implementado, pendiente Stage)

**Diseño:** `docs/pos-station-technical-design.md` v1.2.1 §20 F0A  
**Auditoría correctiva:** `docs/pos-f0a-corrective-audit.md`  
**Runbook Stage:** `docs/pos-f0a-stage-runbook.md`  
**Migración:** `supabase/schema/184_pos_order_owner_f0a.sql`

## Qué cambió

| Área | Cambio |
|------|--------|
| Schema | `owner_profile_id` (FK RESTRICT), backfill, triggers guard/sync |
| Ranking | `coalesce(owner_profile_id, waiter_id)` |
| RLS INSERT | owner null o = auth.uid() |
| Frontend | `owner_profile_id` en INSERT; **POS_ROLES sin cambio** (cajero/servicio revertidos) |

## Qué NO incluye F0A

- `set_pos_order_owner_internal` (eliminada; F0B)
- Transferencias, estaciones, PIN
- Alineación global de permisos POS (documentada como deuda)

## Diagnóstico

Solo **service_role** o SQL Editor (postgres):

```sql
select * from public.diagnose_pos_order_owner_integrity() order by check_code;
```

Script: `supabase/schema/diagnose_pos_order_owner_backfill.sql`

## Pruebas locales

```bash
node frontend/scripts/posOrderOwnerF0a.selftest.mjs
cd frontend && npm run build
```

Tests SQL (Stage/QA, no prod):

`supabase/schema/184_test_pos_order_owner_f0a.sql`

## Estado

**No aplicar 184 en prod.** Stage pendiente con criterios §7 de [`pos-f0a-stage-runbook.md`](pos-f0a-stage-runbook.md).

**F0B:** bloqueada hasta F0A aprobada en Stage.
