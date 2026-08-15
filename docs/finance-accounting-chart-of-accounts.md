# Catálogo contable — Fase 1 (núcleo contable)

Documentación de la primera fase del módulo contable dentro de Finanzas. Esta fase **no** genera partidas, no calcula impuestos, no contabiliza órdenes de compra, no produce libros ni estados financieros, y **no se aplica automáticamente** a Stage ni Producción.

## Objetivo

Plan de cuentas jerárquico importable por CSV/Excel, administrable desde Finanzas y preparado para partidas contables en fases posteriores.

## Modelo de datos

Tabla: `finance_chart_accounts` (migración `supabase/schema/202_finance_accounting_chart_of_accounts.sql`).

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `id` | uuid | Identificador |
| `code` | text | Código único (texto, no numérico) |
| `name` | text | Nombre de la cuenta |
| `parent_id` | uuid | Padre en la jerarquía |
| `level` | smallint | Nivel (1 = raíz) |
| `financial_type` | text | Clasificación financiera |
| `natural_balance` | text | Naturaleza deudora/acreedora |
| `account_kind` | text | `header` (acumuladora) o `detail` (detalle) |
| `accepts_entries` | boolean | Si acepta movimientos contables |
| `is_active` | boolean | Activa/inactiva (sin borrado físico) |
| `description` | text | Notas |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal |
| `created_by` / `updated_by` | uuid | Usuario creador/modificador |

Alcance organizacional: **single-tenant** (código único global, sin empresa/sucursal en esta fase).

## Valores permitidos

### `financial_type` / `tipo_financiero`

- `asset` — Activo
- `liability` — Pasivo
- `equity` — Patrimonio
- `income` — Ingreso
- `cost` — Costo
- `expense` — Gasto

### `natural_balance` / `naturaleza`

- `debit` — Deudora
- `credit` — Acreedora

### `account_kind` / `tipo_cuenta`

- `header` — Acumuladora (no acepta movimientos)
- `detail` — Detalle (puede aceptar movimientos)

### `acepta_movimientos`

- `true`, `1`, `si`, `sí`, `yes` → sí (solo válido en cuentas `detail`)
- Cualquier otro valor → no

## Plantilla CSV

Columnas (encabezados en español):

| Columna | Obligatorio | Ejemplo |
| --- | --- | --- |
| `codigo` | Sí | `1.01` |
| `nombre` | Sí | `Caja` |
| `codigo_padre` | No | `1` |
| `tipo_financiero` | Sí | `asset` |
| `naturaleza` | Sí | `debit` |
| `tipo_cuenta` | Sí | `detail` |
| `acepta_movimientos` | Recomendado | `true` |
| `descripcion` | No | `Caja general` |

Los códigos se leen como **texto** (se conservan ceros a la izquierda y puntos). Se eliminan espacios exteriores.

También se acepta **XLSX** usando la librería `xlsx` ya presente en el frontend.

## Flujo de importación

1. **Seleccionar archivo** — CSV o Excel.
2. **Validación** — Cliente + RPC `preview_finance_chart_accounts_import`:
   - Campos obligatorios
   - Duplicados en archivo
   - Códigos ya existentes en BD
   - Padre en BD o en el mismo archivo
   - Valores permitidos
   - Ciclos jerárquicos
   - Acumuladoras que aceptan movimientos
3. **Confirmación** — RPC `import_finance_chart_accounts` (transaccional, fail-closed).

Si hay errores bloqueantes, **no se inserta ninguna fila**.

## Permisos

| Rol | Ver catálogo | Administrar / importar |
| --- | --- | --- |
| `admin` | Sí | Sí |
| `contador` | Sí | Sí |
| `gerente_general` | Sí | No |
| Otros | No | No |

Funciones SQL:

- `can_view_finance()` — lectura (existente)
- `can_manage_accounting_catalog()` — crear, editar, activar/desactivar, importar

**Corrección incluida:** el rol `contador` existía en RLS de Finanzas pero faltaba en `user_roles`; la migración 201 lo registra de forma aditiva.

RLS en `finance_chart_accounts`: SELECT con `can_view_finance()`, INSERT/UPDATE con `can_manage_accounting_catalog()`.

## Validaciones de negocio

- Código único global
- Padre válido; sin ciclos; no auto-referencia
- Cuentas con hijos deben permanecer `header`
- `header` → `accepts_entries = false`
- Desactivación conserva historial (no hay DELETE en UI ni RPC)

## Interfaz

Ruta: `/finance?tab=catalogo`

Incluye: encabezado, descarga de plantilla, importación (3 pasos), alta/edición manual, búsqueda, filtros, tabla con sangría por nivel, activar/desactivar.

## Capa de servicio

- `frontend/src/services/financeChartAccountsService.js` — RPCs Supabase
- `frontend/src/utils/financeChartAccountsValidation.js` — validación cliente
- `frontend/src/utils/financeChartAccountsConstants.js` — tipos y etiquetas

## Cómo probar localmente

1. Aplicar migraciones hasta `202_finance_accounting_chart_of_accounts.sql` en Supabase local/dev (no Stage/Prod).
2. Asignar rol `admin` o `contador` a un usuario activo.
3. `cd frontend && npm run dev`
4. Ir a **Finanzas → Catálogo contable**.
5. Descargar plantilla, completar con cuentas reales de tu plan contable, importar.
6. Ejecutar pruebas unitarias:

```bash
node --test frontend/src/utils/financeChartAccountsValidation.test.js
```

7. Verificación SQL (no es migración — ejecutar manualmente tras aplicar 202):

```bash
# Supabase SQL Editor, o psql contra dev local
# supabase/schema/202_test_finance_chart_accounts.sql
```

8. Verificación CSV/XLSX local:

```bash
cd frontend && node scripts/audit-chart-accounts-import-format.mjs
```

9. Lint y build:

```bash
cd frontend && npm run lint && npm run build
```

## Aplicación de migraciones vs pruebas

En este repositorio las migraciones se aplican **manualmente** siguiendo runbooks (`docs/*-runbook.md`). Solo deben aplicarse archivos de esquema **productivos** numerados, por ejemplo:

- `202_finance_accounting_chart_of_accounts.sql` — **sí aplicar** en dev/stage cuando corresponda.

**No aplicar como migración** (verificación o lab local):

- `*_test_*.sql` — pruebas con `BEGIN … ROLLBACK`
- `*_lab_*.sql` — fixtures/runtime de laboratorio
- `diagnose_*.sql` — scripts de diagnóstico

El test del catálogo contable está en `supabase/schema/202_test_finance_chart_accounts.sql`.

## Limitaciones de esta fase

- Sin partidas contables ni tablas de diario
- Sin integración con bancos, AP, compras o POS
- Sin eliminación física desde UI
- Sin multi-empresa / multi-sucursal
- Sin catálogo SAT ni reglas fiscales

## Pendiente — Fase 2 (referencia)

- Partidas contables (journal entries)
- Vinculación con operaciones del ERP
- Libro diario / mayor
- Estados financieros
- Reglas de cierre contable
