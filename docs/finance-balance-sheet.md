# Balance General

Reporte de solo lectura a una fecha de corte. Entra en Reportes contables cuando el RPC `get_finance_balance_sheet` y la pantalla están desplegados juntos.

## Alcance

- Solo partidas `posted`, con `entry_date <= cutoff_date` y `posted_at <= snapshot_at`.
- La fecha de corte es obligatoria. No hay filtro de periodo.
- Sucursal y centro de costo son opcionales y advierten que el filtro puede descuadrar el balance.
- El resultado acumulado es el residual histórico de todas las cuentas detalle de ingreso, costo y gasto. No depende de `income_statement_section` y no detecta asientos de cierre.
- El rótulo de esa línea es “Resultado acumulado pendiente de cierre”.

## Clasificación

`finance_chart_accounts.balance_sheet_section` es nullable y no tiene backfill. Solo un detalle de activo, pasivo o patrimonio puede tener una sección compatible: activo corriente, activo no corriente, pasivo corriente, pasivo no corriente o patrimonio. Encabezados e ingresos, costos y gastos permanecen en NULL.

## Ecuación

Los subtotales visibles son clasificados. La diferencia y el estado Cuadrado o Descuadrado usan los totales de control, que suman también los saldos sin sección. Si `report_complete` es false, el rótulo es “Balance provisional” y los subtotales clasificados no se presentan como la ecuación completa.

## Migración

`218_finance_balance_sheet.sql` reemplaza las cinco funciones jsonb del catálogo y conserva `income_statement_section`. No modifica 202–217 ni escribe `schema_migrations`. El rollback restaura esas cinco funciones desde 217.
