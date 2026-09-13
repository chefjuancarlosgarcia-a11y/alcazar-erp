# Evidencia — corrección host Guatemala Stage FELplex

**Fecha:** 2026-09-13 (local)
**Proyecto Stage:** `tgrqarxfmpwgrkntvgma`
**Producción:** no involucrada (`lwpfrdnsiwtmyonwcduh` prohibida)

## Fuente

Confirmación **directa** del representante FELplex (**2026-09-12/13**), sin adjuntar conversación privada ni credenciales:

| Elemento | Valor confirmado |
|----------|------------------|
| Host Guatemala Stage | `https://felplex-gt.stage.plex.lat/` |
| `entity_id` Guatemala Stage | **`547`** |

La URL usada en bootstrap y allowlist previa:

`https://felplex.stage.plex.lat`

es **incorrecta** para GT Stage (host regional genérico / documentación legacy).

## Piloto HTTP único (2026-09-13 UTC) — resultado histórico

| Campo | Valor |
|-------|-------|
| Documento | `b8a0b098-8a4f-4e3a-a3e5-344c528ebec7` |
| Orden | `ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45` |
| Host del primer POST | **`https://felplex.stage.plex.lat`** (legacy) |
| POST FELplex | **1** (inferido por **1** fila en `pos_fel_attempts`) |
| HTTP | **404** |
| Causa raíz confirmada | Host Stage GT incorrecto en config/allowlist previa |
| Estado documento final | **`failed`** (sin reintento autorizado) |
| SAT | **No** emitido |
| Segundo POST / retry | **No** / **NOT EXECUTED** |

Confirmación de host/`entity_id` **no** revierte el `failed` del documento ni autoriza un segundo piloto HTTP.

## Cambio local (repo)

- Allowlist Edge: único host **`felplex-gt.stage.plex.lat`**, HTTPS; rutas acotadas a lo ya modelado (base `/`, certify `await`, GET/text, PDF/XML).
- Migración **`20260813140000`**: actualiza solo `billing_provider_configs.base_url` para `felplex_gt` / `stage` con guard de **exactamente 1 fila**.
- **`entity_id=547`**: **CONFIRMED** para Guatemala Stage (misma fuente FELplex); columna **no** modificada por la migración de host.

## Operaciones **no** realizadas con este commit

- Sin `db push` Stage, sin deploy Edge, sin reintento del documento fallido, sin activar gates, sin HTTP adicional, sin segundo piloto.
