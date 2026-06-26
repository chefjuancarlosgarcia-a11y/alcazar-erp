# Finanzas — Fase 2 (Integraciones)

Conecta el módulo Finanzas con Compras, Catering y Caja para reducir doble digitación.

> Migración: `supabase/schema/130_finance_phase2_integrations.sql`  
> Aplicar después de `129_finance_cash_flow_hotfix.sql`.

## Módulos conectados

| Origen | Destino en Finanzas | Disparador |
|--------|---------------------|------------|
| Orden de compra recibida | Cuenta por pagar | Automático al pasar a `recibida_parcial` / `recibida_completa` |
| Orden de compra aprobada/recibida | Cuenta por pagar | Manual: **Enviar a cuentas por pagar** |
| Catering aprobado (cotización) | Cuenta por cobrar | Automático al aprobar cotización |
| Catering aprobado | Cuenta por cobrar | Manual: **Enviar a cuentas por cobrar** |
| Cierre de caja (`cash_sessions`) | Depósito bancario | Manual: **Registrar depósito** en `/cash-control` |

## Permisos

Sin cambios respecto a Fase 1 para ver Finanzas: **admin**, **gerente_general**, **contador**.

Consulta de estado financiero en origen:
- Compras: roles operativos de órdenes de compra
- Catering: roles de gestión catering
- Caja: operadores de caja (`cajero`, `caja`, etc.)

## Cómo probar

### Compras → Cuentas por pagar
1. Aplicar migración 130.
2. Recibir una orden de compra (estado `recibida_parcial` o `recibida_completa`).
3. Verificar en Finanzas → Cuentas por pagar el registro con origen **Ver origen**.
4. En Inventario → Órdenes, abrir la orden y revisar el bloque **Estado en Finanzas**.

### Catering → Cuentas por cobrar
1. En Catering, enviar y aprobar una cotización (**Cliente aprobó**).
2. Verificar cuenta por cobrar automática en Finanzas.
3. En la solicitud, confirmar badge **Cuenta por cobrar creada**.

### Caja → Banco
1. Ir a `/cash-control`, cerrar una sesión de caja.
2. En **Últimos cierres**, usar **Registrar depósito** (cuenta, monto, método).
3. Verificar movimiento en Finanzas → Bancos con origen cierre de caja.

### Dashboard pendientes
1. Finanzas → **Resumen** → bloque **Pendiente de enviar a Finanzas**.
2. Debe listar compras recibidas, caterings ganados y cierres sin depósito.

## Archivos principales

- `supabase/schema/130_finance_phase2_integrations.sql`
- `frontend/src/utils/financeIntegrations.js`
- `frontend/src/services/financeService.js`
- `frontend/src/components/FinanceIntegrationPanel.jsx`
- `frontend/src/components/FinanceOriginLink.jsx`

## Limitaciones (Fase 2)

- IVA en compras: se calcula 12% si la orden no trae IVA explícito.
- Caja local (`/cash`) en localStorage no se integra; solo cierres Supabase en `/cash-control`.
- Un depósito por cierre y método (efectivo/tarjeta/transferencia).
- Sin pólizas contables, debe/haber, SAT ni extractos bancarios.

## Fase 3 sugerida

- Pólizas automáticas desde operaciones financieras
- Integración Caja POS / localStorage
- Resumen diario POS en dashboard financiero
- Extractos bancarios y reportes fiscales

Ver también: [finance-phase1.md](./finance-phase1.md)
