# Libro Diario (Fase A — Finanzas)

## Objetivo

Reporte contable **Libro Diario** que lista líneas de partidas **contabilizadas** (`status = posted`) con filtros, paginación y totales calculados en servidor.

No incluye: Libro Mayor, Balanza, EEFF, saldos iniciales, carga histórica ni automatizaciones operativas.

## Partidas incluidas

| Incluidas | Excluidas |
|-----------|-----------|
| `posted` | `draft`, `pending_approval`, `approved` |
| Partida original contabilizada | |
| Partida de reversión contabilizada | |

Las reversiones **no se netean**: original y reversión aparecen con sus débitos/créditos y afectan los totales.

## RPC

**Nombre:** `get_finance_general_journal`

**Migración:** `supabase/schema/208_finance_general_journal.sql`

**Permiso:** `can_view_accounting()` (roles activos: admin, contador, gerente_general).

### Parámetros

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `p_from_date` | date | Fecha contable desde |
| `p_to_date` | date | Fecha contable hasta |
| `p_period_id` | uuid | Periodo contable |
| `p_branch_id` | uuid | Filtro por sucursal (línea) |
| `p_cost_center_id` | uuid | Filtro por centro de costo (línea) |
| `p_account_id` | uuid | Cuenta del catálogo |
| `p_search` | text | Búsqueda literal en partida, cuenta y línea |
| `p_page` | integer | Página (≥ 1) |
| `p_page_size` | integer | Tamaño (1–500) |
| `p_snapshot_at` | timestamptz | Snapshot opcional (`posted_at <= snapshot_at`); si es null, usa `now()` |

### Respuesta JSON

```json
{
  "rows": [
    {
      "line_id": "uuid",
      "entry_id": "uuid",
      "entry_date": "2026-08-01",
      "entry_number": "JE-2026-0001",
      "entry_reference": "",
      "entry_description": "",
      "line_number": 1,
      "account_id": "uuid",
      "account_code": "1.01",
      "account_name": "Caja",
      "line_description": "",
      "line_reference": "",
      "branch_id": null,
      "branch_code": null,
      "branch_name": null,
      "cost_center_id": null,
      "cost_center_code": null,
      "cost_center_name": null,
      "debit": 100.00,
      "credit": 0.00,
      "is_reversal": false,
      "reversal_of_id": null,
      "reversal_of_entry_number": null,
      "reversed_by_entry_id": null
    }
  ],
  "total_rows": 1,
  "total_entries": 1,
  "total_debit": 100.00,
  "total_credit": 100.00,
  "difference": 0.00,
  "page": 1,
  "page_size": 50,
  "total_pages": 1,
  "snapshot_at": "2026-08-01T12:00:00+00:00"
}
```

### Orden

1. `entry_date ASC`
2. `entry_number ASC`
3. `line_number ASC`

Los totales corresponden al **conjunto filtrado completo** bajo el mismo `snapshot_at`, no solo a la página visible.

### Búsqueda (`p_search`)

Busca de forma literal (case-insensitive) en:

- número de partida
- referencia de partida
- descripción de partida
- código de cuenta
- nombre de cuenta
- descripción de línea
- referencia de línea

## UI

- Finanzas → **Reportes contables** → **Libro Diario**
- Otros reportes visibles como **Próximamente**
- Clic en número de partida → `/finance?tab=partidas&entry={entry_id}`; al cerrar el detalle se elimina `entry` de la URL

## Snapshot

- Cada carga inicial (filtros nuevos, página 1, Actualizar) obtiene un `snapshot_at` nuevo del servidor.
- Paginación dentro de la misma vista reutiliza el `snapshot_at` para consistencia.
- Exportación CSV fija el snapshot en la primera solicitud y reutiliza el mismo en todas las páginas; filas y totales pertenecen al mismo snapshot.

## Exportación CSV

- Respeta filtros activos y snapshot de exportación
- Exporta todo el conjunto filtrado (paginación interna hasta 500/request)
- Límite: **10 000 líneas**
- UTF-8 con BOM, escape CSV, neutralización de fórmulas
- Incluye fila de totales generales del snapshot

## Permisos y alcance por sucursal

- Autorización vía `can_view_accounting()`
- `accounting_journal_branch_scope()` hoy retorna **NULL** → sin restricción adicional por sucursal
- **Riesgo futuro:** operación multisucursal real requiere definir alcance explícito

## Limitaciones actuales

- Solo partidas `posted`
- Sin PDF
- Sin Libro Mayor / Balanza / EEFF
- Exportación acotada a 10 000 líneas
- Sidebar sin enlace directo a Reportes (acceso vía pestaña Finanzas)

## Aplicación futura en Stage

Orden obligatorio (209 **no** está aplicada todavía en Stage hasta que el operador ejecute el paso 3):

1. Aplicar foundation 202–204 si aún no está en el entorno
2. Aplicar `208_finance_general_journal.sql` en Stage
3. Aplicar `209_finance_general_journal_helper_acl.sql` en Stage — **corrección ACL obligatoria** posterior a 208; idempotente
4. Ejecutar `209_test_finance_general_journal_helper_acl.sql` en transacción de verificación (10 escenarios, BEGIN/ROLLBACK)
5. Reanudar postcheck del runner 208 (`-ResumeAfterApply`; no re-aplica 208 ni 209)
6. Ejecutar `208_test_finance_general_journal.sql` y smoke según runner
7. Validar UI en Preview Stage

### Corrección ACL 209

- **Helper** `finance_general_journal_row_to_json`: exclusivamente interno; sin EXECUTE para `PUBLIC`, `anon`, `authenticated` ni `service_role`
- **RPC principal** `get_finance_general_journal`: accesible por rol `authenticated` (vía JWT de usuario)
- Si Stage ya tiene 208 COMMIT pero el postcheck detectó EXECUTE expuesto en el helper, aplicar **solo** la migración 209 (sin re-ejecutar 208)

## Rollback

- **209 ACL:** `supabase/rollback/209_finance_general_journal_helper_acl.rollback.sql` — **deliberadamente bloqueado** (fail-closed). No concede EXECUTE al helper ni muta objetos. Restaurar el ACL anterior reintroduciría una exposición de seguridad; requiere autorización humana, auditoría de impacto y una migración correctiva nueva.
- **208 completo:** `supabase/rollback/208_finance_general_journal.rollback.sql` en Stage con guards de entorno configurados — usar para eliminar Libro Diario por completo.

El rollback 208 elimina `get_finance_general_journal` y el helper JSON. No modifica tablas 202–204.
