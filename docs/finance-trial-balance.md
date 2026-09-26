# Balanza de Comprobación

Reporte de solo lectura sobre partidas ya contabilizadas. La primera versión lista cuentas de detalle. No suma cuentas padre y no muestra una agrupación jerárquica. `parent_id` y `parent_code` viajan solo como metadatos para una versión futura.

No modifica Libro Diario, Libro Mayor ni el selector de cuentas de Partidas.

## Alcance

- Origen: `finance_journal_entries`, `finance_journal_lines` y `finance_chart_accounts`.
- Entran solo partidas con `status = 'posted'` y `posted_at <= snapshot_at`.
- Borradores, enviadas y aprobadas sin contabilizar quedan fuera.
- Una reversión contabilizada entra como partida propia. No se netea antes de sumar.
- La ventana efectiva es la intersección del periodo y las fechas.
- El saldo inicial toma movimientos anteriores al inicio efectivo, con el mismo filtro de sucursal y centro de costo, sin limitarlos al `period_id`.
- Si no hay fecha de inicio efectiva, el saldo inicial es cero.
- Una línea dentro de las fechas pero de otro periodo no es saldo inicial ni movimiento.

## Fórmulas

Naturaleza tomada de `finance_chart_accounts.natural_balance`.

```text
deudora:  saldo_firmado = suma_debe - suma_haber
acreedora: saldo_firmado = suma_haber - suma_debe
```

El saldo inicial usa las sumas anteriores al inicio. El saldo final suma el movimiento del periodo con el mismo criterio de naturaleza.

Un saldo ocupa una sola columna:

- magnitud menor que 0.005: ambas columnas en cero;
- saldo positivo de naturaleza deudora: columna deudora;
- saldo positivo de naturaleza acreedora: columna acreedora;
- saldo negativo: la magnitud va a la columna contraria y la cuenta queda marcada como saldo contrario.

No se oculta el saldo contrario y no se convierte el mismo importe a valor absoluto en las dos columnas. El debe y el haber del periodo sí pueden coexistir.

Una cuenta está en cero cuando el saldo inicial, el debe y el haber del periodo están por debajo de 0.005. Esas cuentas se ocultan salvo que se pida incluirlas. Una cuenta con saldo inicial y sin movimiento del periodo no está en cero.

## Totales

Los totales se calculan sobre el conjunto de control, antes de la búsqueda y de la paginación. La búsqueda por código o nombre solo filtra las filas visibles.

```text
diferencia = total_deudor - total_acreedor
cuadrada = las tres diferencias (inicial, periodo y final) tienen magnitud menor que 0.005
```

`is_square` es falso si queda cualquier diferencia. Un filtro de sucursal o centro de costo puede descuadrar la balanza porque separa líneas de una misma partida. La interfaz muestra esa diferencia y no la fuerza a cero.

## RPC

`get_finance_trial_balance(p_from_date date, p_to_date date, p_period_id uuid, p_branch_id uuid, p_cost_center_id uuid, p_search text, p_include_zero_accounts boolean, p_page integer, p_page_size integer, p_snapshot_at timestamptz) returns jsonb`

`SECURITY DEFINER`, `STABLE`, `search_path` vacío. Exige `auth.uid()` y `can_view_accounting()`. `EXECUTE` queda solo para `authenticated`.

El predicado de sucursal reutiliza `accounting_journal_branch_scope()` tal como está: no amplía el acceso respecto de Diario y Mayor.

## CSV

Exporta el conjunto filtrado completo con el mismo snapshot. Lleva BOM UTF-8, escape CSV y neutralización de fórmulas. Los totales se rotulan como totales del alcance completo. Si hay más de 10 000 cuentas filtradas, la exportación se aborta y no descarga un archivo parcial.

## Migración

`supabase/schema/216_finance_trial_balance.sql`. El rollback elimina únicamente esa función. No borra partidas ni toca Diario o Mayor.
