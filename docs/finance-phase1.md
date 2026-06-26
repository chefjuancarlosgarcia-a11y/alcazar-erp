# Finanzas — Fase 1

Control financiero operativo del ERP Alcázar. Inspirado en funciones útiles de Millenium 2000, con lenguaje simple y conectado a la data real del sistema.

## Qué incluye esta fase

- **Resumen:** dinero disponible, por cobrar, por pagar, flujo neto, cobros/pagos del periodo, vencidos.
- **Bancos:** cuentas bancarias, saldos y movimientos manuales.
- **Cuentas por pagar:** registro manual, pagos parciales/totales, enlace opcional a banco.
- **Cuentas por cobrar:** registro manual, cobros parciales/totales, enlace opcional a banco.
- **Flujo de caja:** entradas/salidas/neto/saldo acumulado por día.
- **Conciliación bancaria básica:** marcar movimientos, comparar saldo del banco vs sistema, cerrar periodo.

## Migración Supabase

Archivo: `supabase/schema/128_finance_phase1.sql`

> Nota: el número 126 ya estaba usado por reclutamiento; esta fase usa **128**.

Aplicar en el SQL Editor de Supabase después de `127_recruitment_list_purge_hotfix.sql`.

## Permisos

| Rol | Ver módulo | Configurar bancos | Registrar pagos/cobros | Conciliar |
|-----|------------|-------------------|------------------------|-----------|
| admin | Sí | Sí | Sí | Sí |
| gerente_general | Sí | No | Sí | Ver + marcar |
| contador | Sí | Sí | Sí | Sí |

Frontend:
- `frontend/src/utils/financePermissions.js`

Backend:
- `can_view_finance()`, `can_manage_finance()`, `can_reconcile_finance()`

El módulo **no aparece** en sidebar ni rutas para otros roles.

## Flujo de prueba manual

1. Aplicar migración 128.
2. Iniciar sesión como **admin**.
3. Ir a **Finanzas → Bancos** y crear una cuenta con saldo inicial.
4. Registrar un movimiento manual (entrada y salida).
5. Crear una **cuenta por pagar** y registrar un pago parcial/total.
6. Crear una **cuenta por cobrar** y registrar un cobro.
7. Revisar **Resumen** y **Flujo de caja** con filtro de fechas.
8. En **Conciliación**, cargar mes/año, ingresar saldo final del estado de cuenta, marcar movimientos y cerrar cuando la diferencia sea 0.

## Limitaciones (Fase 1)

- Sin contabilidad de debe/haber, pólizas, libro diario/mayor ni estados financieros oficiales.
- Sin carga automática de extractos bancarios.
- Sin integración automática con Compras, Catering, Caja o POS (helpers preparados en `financeIntegrations.js`).
- Sin integración SAT.
- No se eliminan registros financieros; pagos/cobros y movimientos quedan auditables.

## Próximas fases sugeridas

1. **Fase 2:** pólizas automáticas desde operaciones financieras (diseño contable).
2. **Integraciones:** compras → payables, catering → receivables, cierre de caja → depósitos.
3. **Fase 3:** extractos bancarios, activos fijos, reportes fiscales.

## Archivos principales

- `supabase/schema/128_finance_phase1.sql`
- `frontend/src/pages/Finance.jsx`
- `frontend/src/modules/finance/FinanceDashboard.jsx`
- `frontend/src/modules/finance/Finance.css`
- `frontend/src/services/financeService.js`
- `frontend/src/utils/financePermissions.js`
Ver también: [finance-phase2-integrations.md](./finance-phase2-integrations.md) para integraciones con Compras, Catering y Caja.
