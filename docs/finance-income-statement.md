# Estado de Resultados

El reporte usa cuentas de detalle ya contabilizadas. La sección no se deduce del código, del nombre, del padre, de la jerarquía ni de la naturaleza.

## Clasificación

Columna `finance_chart_accounts.income_statement_section`, nula al nacer. No hay backfill. Una cuenta inactiva conserva su sección y aparece si tiene movimientos en el periodo.

| Valor | Etiqueta | Tipo financiero |
| --- | --- | --- |
| operating_income | Ingresos operativos | income |
| sales_contra | Devoluciones y descuentos sobre ventas | income |
| other_income | Otros ingresos | income |
| cost_of_sales | Costo de ventas | cost |
| operating_expense_selling | Gastos de venta | expense |
| operating_expense_admin | Gastos administrativos | expense |
| operating_expense_other | Otros gastos operativos | expense |
| other_expense | Otros gastos | expense |
| income_tax | Impuesto sobre la renta | expense |

Las cuentas de activo, pasivo y patrimonio, y las cuentas acumuladoras, deben tener la sección nula. Una cuenta de detalle de resultados puede quedar sin sección; si tiene movimientos, el reporte queda incompleto.

## Fórmulas

Los ingresos operativos y los otros ingresos se miden como haber menos debe. Las demás secciones se miden como debe menos haber. Un importe negativo es un saldo contrario y se conserva.

- Ventas netas = ingresos operativos − devoluciones y descuentos
- Utilidad bruta = ventas netas − costo de ventas
- Gastos operativos = venta + administración + otros gastos operativos
- Utilidad operativa = utilidad bruta − gastos operativos
- Otros resultados = otros ingresos − otros gastos
- Utilidad antes de impuestos = utilidad operativa + otros resultados
- Resultado clasificado = utilidad antes de impuestos − impuesto sobre la renta

Si no hay cuentas de impuesto clasificadas, el impuesto es 0 y el reporte sigue completo, con la nota “Sin cuentas de impuesto clasificadas.”

## Completo e incompleto

Si alguna cuenta de ingreso, costo o gasto tiene movimientos en el alcance y no tiene sección válida:

- `report_complete` es falso
- `net_income` es nulo
- `classified_net_result` conserva el cálculo provisional
- se devuelven las cuentas no clasificadas, su debe, su haber, el movimiento neto (debe − haber) y la cantidad
- la etiqueta es “Resultado provisional de cuentas clasificadas”
- el CSV marca el documento como INCOMPLETO

Si no hay esos movimientos, `report_complete` es verdadero y `net_income` es igual al resultado clasificado. La etiqueta es “Utilidad neta” o “Pérdida neta” según el signo.

## Alcance

Solo partidas contabilizadas con `posted_at` menor o igual a la instantánea. No usa saldo inicial. Las reversiones contabilizadas entran como movimientos separados. El filtro de sucursal o centro de costo limita las líneas; no se describe como un descuadre.

El documento admite como máximo 2,000 cuentas de detalle. Si se excede, la consulta falla y no devuelve un reporte parcial.

## Catálogo e importación

El alta y la edición reciben `income_statement_section` dentro del mismo JSON. Si la clave no viene, el alta deja la sección nula y la edición conserva la existente, revalidándola contra el tipo. La columna opcional del archivo es `seccion_resultados`. Acepta el valor interno o la etiqueta española exacta. Una combinación inválida, un valor desconocido o una sección en una cuenta acumuladora rechazan esa fila. Una cuenta de resultados sin sección se importa con advertencia.
