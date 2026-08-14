# FELplex Stage — billing bootstrap runbook

**Proyecto Stage autorizado:** `tgrqarxfmpwgrkntvgma`  
**Proyecto prohibido:** `lwpfrdnsiwtmyonwcduh` (Producción)  
**Estado de ejecución:** **NOT EXECUTED IN STAGE**  
**Artefactos:** `supabase/stage-fixtures/felplex_gt_billing_bootstrap.sql`  
**Rollback:** `supabase/stage-fixtures/felplex_gt_billing_bootstrap.rollback.sql`

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

## 5. Aplicación manual en Stage (cuando se autorice)

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

- **NOT EXECUTED IN STAGE** al momento de versionar este runbook
- Sin SQL automático en migraciones
- Sin lectura de secretos Edge
- Sin HTTP FELplex
- Sin Producción
