# FELplex Stage — billing bootstrap runbook

**Proyecto Stage autorizado:** `tgrqarxfmpwgrkntvgma`
**Proyecto prohibido:** `lwpfrdnsiwtmyonwcduh` (Producción)
**Estado de ejecución:** **EXECUTED SUCCESSFULLY IN STAGE — 2026-09-10**
**Evidencia oficial:** [2026-09-10-stage-billing-bootstrap.md](evidence/felplex/2026-09-10-stage-billing-bootstrap.md)
**Artefactos:** `supabase/stage-fixtures/felplex_gt_billing_bootstrap.sql`
**Rollback:** `supabase/stage-fixtures/felplex_gt_billing_bootstrap.rollback.sql`

---

## 0. Registro de ejecución (2026-09-10)

| Campo | Valor |
|-------|-------|
| Commit repo de referencia | `143b744c9252ed2eb0c984c211a32399d790a1a1` |
| SHA256 fixture ejecutado | `02C6C657523D9AE6006D02DC63B01162F5EAFCBD0AC19DB2273CD54F23F48780` |
| Filas creadas | 4 (`billing_legal_entities`, `billing_providers`, `billing_provider_configs`, `billing_provider_status`) |
| `connection_status` inicial | `unknown` |
| Interruptores FEL | Permanecieron apagados (`emission_enabled`, `auto_issue_paid_orders`, `formal_contingency_enabled` = false) |
| HTTP FELplex | No |
| Edge deploy | No |
| Certificación | No |
| Producción | No involucrada |

Antes del 2026-09-10 este runbook declaraba **NOT EXECUTED IN STAGE**; la ejecución única autorizada cerró ese estado.

---

## 1. Propósito

Preparar en Supabase Stage la configuración billing mínima para que el runtime FELplex pueda resolver:

| Campo | Valor Stage |
|-------|-------------|
| Entidad legal ERP | `code=default`, NIT `326070`, nombre **Pruebas Gran Alcazar** |
| Catálogo proveedor | `felplex_gt` |
| ID empresa FELplex | `547` |
| Base API | `https://felplex.stage.plex.lat` |
| Nombre lógico secreto Edge | `FELPLEX_GT_STAGE_API_KEY` (valor **no** en SQL) |

**No** habilita emisión FEL, HTTP FELplex, Edge deploy ni certificación.

---

## 2. Por qué no es una migración

Los valores (`547`, NIT Stage, URL Stage, entidad legal Stage) **no deben** viajar en `supabase/migrations/` hacia Producción.
Este bootstrap es un **fixture Stage-only** versionado en `supabase/stage-fixtures/`.

---

## 3. Precondiciones (Stage)

| Elemento | Valor esperado |
|----------|----------------|
| `fel_emission_config id=1` | `environment=stage`, `emission_enabled=false`, `auto_issue_paid_orders=false`, `formal_contingency_enabled=false` |
| `billing_legal_entities` | 0 filas **o** fila `code=default` compatible |
| `billing_providers` | 0 filas **o** catálogo `felplex_gt` compatible |
| `billing_provider_configs` | 0 filas **o** config `felplex_gt/stage` compatible |
| Edge secret | `FELPLEX_GT_STAGE_API_KEY` ya guardado manualmente (**no verificar valor**) |
| Documentos FEL | Ninguno en `certified`/`processing` para rollback seguro |

---

## 4. Validación local (antes de aplicar en Stage)

```bash
node scripts/validate-felplex-stage-billing-bootstrap.mjs
node scripts/validate-felplex-migration-safety.mjs
npm run test:felplex-1a
```

---

## 5. Aplicación manual en Stage (referencia histórica / re-ejecución idempotente)

**Estado actual:** ya aplicado el 2026-09-10 (ver §0). Re-ejecutar solo bajo runbook de recuperación y con snapshot previo.

1. Confirmar enlace CLI a `tgrqarxfmpwgrkntvgma` (solo operador autorizado).
2. Abrir SQL Editor Stage con rol privilegiado.
3. Ejecutar **completo** `supabase/stage-fixtures/felplex_gt_billing_bootstrap.sql`.
4. Verificar filas (solo campos no sensibles):

```sql
select code, legal_name, tax_id, is_default, is_active
from public.billing_legal_entities
where code = 'default';

select code, name, adapter_key, is_active
from public.billing_providers
where code = 'felplex_gt';

select provider_code, environment, entity_id, base_url, secret_env_var, is_default, is_active
from public.billing_provider_configs
where provider_code = 'felplex_gt' and environment = 'stage';

select connection_status
from public.billing_provider_status st
join public.billing_provider_configs cfg on cfg.id = st.provider_config_id
where cfg.provider_code = 'felplex_gt' and cfg.environment = 'stage';
```

5. **No** activar `fel_emission_config.emission_enabled`.
6. **No** activar `FELPLEX_HTTP_ENABLED` ni `FELPLEX_CONTRACT_HTTP_CONFIRMED` en Edge.

---

## 6. Rollback manual (Stage)

Ejecutar `supabase/stage-fixtures/felplex_gt_billing_bootstrap.rollback.sql` solo si:

- Interruptores FEL siguen en `false`;
- No hay documentos FEL `certified`/`processing`;
- No hay `billing_documents` ni `billing_certification_attempts` dependientes.

**No ejecutado** tras el bootstrap del 2026-09-10.

---

## 7. NIT Stage `326070`

- Almacenado como **texto** `"326070"` sin guiones.
- Es el NIT proporcionado para la cuenta FELplex Stage.
- **No** autoriza Producción; antes de Producción verificar RTU y cuenta productiva con operador/FELplex.

---

## 8. Qué sigue (fuera de este bootstrap)

| Paso | Responsable | Notas |
|------|-------------|-------|
| Habilitar emisión | Runbook FEL separado | `fel_emission_config.emission_enabled=true` |
| Habilitar HTTP | Runbook contrato Guatemala | Edge env + prueba controlada |
| Certificación POS | Edge + Stage | Requiere orden pagada + documento FEL |

---

## 9. Confirmaciones de alcance

- **EXECUTED SUCCESSFULLY IN STAGE — 2026-09-10** (evidencia enlazada arriba)
- Sin SQL automático en migraciones
- Sin lectura de secretos Edge en documentación
- Sin HTTP FELplex asociado al bootstrap
- Sin Producción
