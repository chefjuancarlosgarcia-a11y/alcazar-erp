# Fase 0 — Fundación del módulo de facturación electrónica

**Estado:** implementación aprobada  
**Migración:** `159_billing_foundation.sql`  
**Rollback:** `159_billing_foundation_rollback.sql` (mismo PR)

## Decisiones de arquitectura

| Tema | Decisión |
|------|----------|
| Dominio | Completamente agnóstico del certificador (`CanonicalInvoice`, campos de certificación genéricos) |
| Proveedor | Campos aislados: `provider_reference_id`, `provider_document_type`, `provider_response` |
| Multiempresa | `billing_legal_entities` desde Fase 0; FK en configs y documents |
| Credenciales | Supabase Vault únicamente — nunca API Keys en tablas ni env públicos |
| Emisión | Deshabilitada en Fase 0 (`emission_enabled` bloqueado) |
| Regresión | Cero cambios en POS, Caja, Inventario, Catering, Reportes, Producción |

## Ajustes incorporados (aprobación final)

1. **Dominio agnóstico** — sin columnas `sat_*` ni `felplex_*` en el modelo canónico.
2. **Multiempresa** — tabla `billing_legal_entities` + `legal_entity_id` en configs y documents.
3. **Observabilidad** — `billing_provider_status`, vista de conteos, RPC `get_billing_monitoring_summary()`.
4. **Versionado adapter** — `adapter_version` en `billing_providers` y en cada attempt.
5. **Auditoría config** — `billing_config_audit_log` en cada cambio de settings/config.
6. **Panel admin** — estado proveedor, última prueba, créditos, duración (lectura).
7. **Cero regresión** — solo archivos aditivos + tab Settings.

## Esquema principal

```
billing_legal_entities
billing_providers (+ adapter_version)
billing_provider_configs (+ legal_entity_id)
billing_documents (+ legal_entity_id, campos canónicos)
billing_document_lines
billing_certification_attempts (+ adapter_version)
billing_document_links
billing_config_audit_log
billing_provider_status
```

## Feature flag (`app_settings.billing_settings`)

```json
{
  "enabled": false,
  "emission_enabled": false,
  "provider_code": "felplex_gt",
  "environment": "stage",
  "default_document_type": "invoice",
  "degraded_mode_allow_sale": true,
  "auto_retry_enabled": false,
  "retry_max_attempts": 5,
  "retry_interval_minutes": 15,
  "timezone": "America/Guatemala"
}
```

## Edge Functions Fase 0

- `billing-test-connection` — prueba conectividad, actualiza `billing_provider_status`
- `_shared/billing/*` — puerto, adapter stub, BillingService

## Disciplina de implementación

Antes de cada commit: **auditoría de impacto** — verificar que ningún módulo existente (POS, caja, inventario, catering, reportes, producción) cambió comportamiento. Si hay cambio no previsto, detener y reportar.

## Implementación entregada (Fase 0)

### SQL
- `supabase/schema/159_billing_foundation.sql`
- `supabase/schema/159_billing_foundation_rollback.sql`

### Edge Functions
- `supabase/functions/_shared/billing/*` — puerto, adapter FELplex v1.0.0, BillingService
- `supabase/functions/billing-test-connection/index.ts`

### Frontend (aditivo)
- `frontend/src/services/billing/billingSettingsService.js`
- `frontend/src/components/billing/BillingSettingsPanel.jsx`
- `frontend/src/utils/billingConstants.js`, `billingPermissions.js`
- `frontend/src/pages/Settings.jsx` — tab Facturación electrónica (único archivo existente tocado)

### Docs
- `docs/billing/vault-setup.md`

### Ajustes aprobados reflejados

| Ajuste | Implementación |
|--------|----------------|
| Dominio agnóstico | `certification_*`, `document_url`; aislado: `provider_reference_id`, `provider_response` |
| Multiempresa | `billing_legal_entities` + FK en configs/documents/status |
| Observabilidad | `billing_provider_status`, vista conteos, `get_billing_monitoring_summary()` |
| Adapter version | `billing_providers.adapter_version`, attempts + status |
| Auditoría config | `billing_config_audit_log` + trigger en set/upsert |
| Panel admin | Estado, última prueba, créditos, pendientes/fallidos |
| Cero regresión | Sin cambios POS/Caja/Inventario/Catering/Reportes/Producción |

1. Migración 159 + rollback en repo
2. Vault: `billing_felplex_gt_stage`
3. Seed config provider (entity_id manual)
4. Deploy Edge Function
5. Panel Settings → Probar conexión
6. Regresión operativa
