# Libro Mayor

Migración `supabase/schema/215_finance_general_ledger.sql`. No está aplicada en Stage ni en Producción por este cambio. No inserta filas en `supabase_migrations.schema_migrations`.

Numeración reservada, no incluida en esta rama:

| Número | Uso |
|--------|-----|
| 208 | Libro Diario |
| 209 | ACL del Libro Diario |
| 210 | Reservado; no reutilizar |
| 211 | POS/Caja |
| 212 | RLS de pagos por sesión |
| 213 | Reservado para suspensión médica IGSS |
| 214 | Reservado para bloqueo de aprobación IGSS |
| 215 | Libro Mayor |

## Dónde vive

Finanzas → Reportes contables → Libro Mayor.

El Libro Diario permanece en su pestaña. El selector de cuentas de Partidas no cambia: sigue exigiendo cuenta activa, de detalle y con `accepts_entries = true`.

## Cuentas consultables

El selector del Mayor lista cuentas con `account_kind = 'detail'`, aunque estén inactivas o ya no acepten movimientos. Una cuenta de encabezado no se ofrece ni la acepta el RPC.

La pantalla marca `Inactiva` y `No acepta movimientos` y permite consultar el Mayor.

## Alcance

Sucursal y centro de costo se aplican al saldo inicial, a los movimientos y al saldo final.

| Sucursal | Centro de costo | Etiqueta |
|----------|-----------------|----------|
| no | no | Mayor global de la cuenta |
| sí | no | Mayor por sucursal |
| no | sí | Mayor por centro de costo |
| sí | sí | Mayor por sucursal y centro de costo |

Solo entran partidas `posted` con `posted_at <= snapshot_at`, dentro de `accounting_journal_branch_scope()`. Las reversiones se muestran como movimientos propios y no se netean.

## Periodo y fechas

Si hay periodo y también fecha inicial o final, la ventana es la intersección:

- inicio efectivo = máximo entre el inicio del periodo y la fecha inicial, cuando la fecha inicial existe;
- fin efectivo = mínimo entre el fin del periodo y la fecha final, cuando la fecha final existe.

Si el inicio efectivo queda después del fin efectivo, la consulta se rechaza con: `El periodo contable y el rango de fechas no se intersectan.`

Si la fecha inicial es posterior a la fecha final: `La fecha desde no puede ser posterior a la fecha hasta.`

El saldo inicial suma los movimientos contabilizados de la misma cuenta y el mismo alcance de sucursal y centro de costo con `entry_date` anterior al inicio efectivo. No se limita al `period_id` seleccionado. Si no hay inicio efectivo, el saldo inicial es cero.

Un movimiento dentro de las fechas pero de otro periodo no entra al saldo inicial ni a los movimientos del periodo.

## Fórmulas

El movimiento con signo usa `finance_chart_accounts.natural_balance`, no el tipo financiero.

- Naturaleza deudora: `débito − crédito`.
- Naturaleza acreedora: `crédito − débito`.
- Positivo: saldo del lado natural (`Deudor` o `Acreedor`).
- Cero: `Cero`.
- Negativo: lado contrario, marcado `Contrario a la naturaleza`. El signo no se elimina.

```
saldo_inicial = suma(movimiento_con_signo) donde fecha < inicio_efectivo
saldo_acumulado(fila) = saldo_inicial + suma(movimiento_con_signo de las filas del libro completo hasta esta fila)
debe_periodo = suma(débito de todos los movimientos del alcance)
haber_periodo = suma(crédito de todos los movimientos del alcance)
saldo_final = saldo_inicial + suma(movimiento_con_signo del alcance)
```

Orden del libro: `entry_date`, `entry_number`, `line_number`, `line_id`.

## Búsqueda

La búsqueda se aplica después de calcular el libro. Compara número de partida, referencia de partida, referencia de línea, descripción de partida y concepto de línea.

Cada fila visible conserva el saldo acumulado que tenía en el libro completo. Debe, haber y saldo final no se recalculan con las coincidencias. La cantidad de coincidencias se muestra aparte.

La paginación recorre las coincidencias. El saldo de la página 2 ya incluye los movimientos anteriores del libro, aunque no estén en la página.

## CSV

UTF-8 con BOM. Reutiliza el escape y la neutralización de fórmulas del Libro Diario. Incluye saldo inicial, filas exportadas, totales del periodo y saldo final del alcance completo. Si hubo búsqueda, el archivo lo indica y no presenta la suma de coincidencias como saldo final. Tope de exportación: 10000 filas visibles. Si el snapshot cambia durante la exportación, se aborta.

## RPC

`get_finance_general_ledger(p_account_id uuid, p_from_date date, p_to_date date, p_period_id uuid, p_branch_id uuid, p_cost_center_id uuid, p_search text, p_page integer, p_page_size integer, p_snapshot_at timestamptz) returns jsonb`

Archivo: `supabase/schema/215_finance_general_ledger.sql`.

Prueba: `supabase/schema/215_test_finance_general_ledger.sql`, dentro de `BEGIN` … `ROLLBACK`.

Rollback: `supabase/rollback/215_finance_general_ledger.rollback.sql`. Elimina solo la función. No borra partidas ni movimientos. El reporte se calcula al consultar, así que no hay un resultado almacenado que recuperar. Volver a aplicar 215 recrea el RPC. El rollback no concede permisos.

Permiso: `can_view_accounting()`. `search_path` vacío. `SECURITY DEFINER`. `EXECUTE` revocado a `public`, `anon` y `service_role`; concedido a `authenticated`. No depende de las migraciones reservadas 213 ni 214.

La respuesta trae cuenta, alcance, ventana efectiva, saldo inicial y final con lado y contrario, debe y haber del periodo, `movement_count`, `match_count`, `search_applied`, página de filas con `running_balance`, y `snapshot_at`.

## Alcance de sucursales

`accounting_journal_branch_scope()` está definido en el motor de partidas y hoy devuelve `null`. Ese valor significa que no hay restricción por sucursal. Libro Mayor usa el mismo predicado que Libro Diario:

- si el alcance es null, no filtra sucursales;
- si la línea no tiene sucursal, permanece visible;
- si hay un arreglo de sucursales, solo entran esas líneas.

Este trabajo no amplía esa función. Libro Mayor no concede más acceso que Libro Diario.

Deuda técnica de seguridad: cuando existan usuarios contables restringidos por sucursal, hay que implementar `accounting_journal_branch_scope()` de verdad. Hasta entonces, admin, contador y gerente general activos ven todas las sucursales en Diario y en Mayor.
