# Auditoría y limpieza — legacy Usuarios/RRHH

Documento de seguimiento para la fase usuarios. La auditoría detallada vive en [legacy-dead-code-audit-usuarios.md](./legacy-dead-code-audit-usuarios.md).

---

## Resultado

| Métrica | Valor |
|---------|-------|
| Monolito antes | 5,845 líneas |
| Monolito después | **2,494** líneas |
| Eliminadas (monolito) | **3,351** |
| Eliminadas (`modules/users/`) | **1,038** |
| Total retirado (fase) | **~4,389** líneas |
| Reducción acumulada vs 11,539 | **~78.4%** |
| Build | OK (`npm run build`) |

---

## Eliminado

- Rama JSX `seccionActiva === "usuarios"` y wiring `UsersModule`
- Carpeta `frontend/src/modules/users/` (`UsersModule.jsx`, `usersHelpers.js`, `Users.css`)
- Renderers HR: dashboard, perfil, gestión usuarios, alertas, documentos, desempeño, capacitaciones, asistencia, incidentes, timeline, carrera, clima
- `MOCK_HR_EMPLOYEES`, constantes `HR_*`, helpers score/docs/alertas
- State/handlers: formulario colaborador, turnos en formulario, crop foto, reset password, `accessRequests`, modales huérfanos
- Estilos `profile*`, `hr*`, `userManagement*`, `crop*`, `schedule*` (formulario usuario)
- Imports `react-easy-crop` desde Legacy (sigue en `MyProfilePanel.jsx`)
- Entrada `"usuarios"` en `modulosDisponibles` / `moduleContext`

---

## Conservado

- Login legacy: `usuarioActual`, `iniciarSesion`, `cerrarSesion`, `users`, `getUserAuth`, `hashPassword`
- Secciones vivas: órdenes (`PurchaseOrdersModule`), proveedores (`SuppliersModule`), áreas, reportes asistencia
- `ProfileManagement.jsx` (producción en `/hr?section=usuarios`)

---

## Validación

| Ruta | Esperado |
|------|----------|
| `/hr?section=usuarios` | `ProfileManagement.jsx` |
| `/inventory?section=ordenes` | Legacy + órdenes |
| `/inventory?section=proveedores` | Legacy + proveedores |
| `/inventory?section=areas` | Legacy + áreas |
| Login legacy | Pantalla “Iniciar sesión” si no hay `usuarioActual` |

*Limpieza: 2026-06-09*
