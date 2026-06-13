# Auditoría de código legacy — usuarios / RRHH (`seccionActiva === "usuarios"`)

Auditoría estática del frontend. Fecha: 2026-06-09.  
**Alcance:** bloque `UsersModule`, renderers HR legacy y dependencias en `LegacyInventoryApp.jsx`.  
**Sin cambios de código** — solo documentación para decidir la siguiente limpieza.

---

## Resumen

**Veredicto:** En el flujo normal de producción, la UI legacy de colaboradores / gestión de usuarios **no se renderizaba**.

**Estado actual (2026-06-09):** Bloque **eliminado**. Monolito **5,845 → 2,494** líneas (−3,351). Carpeta `frontend/src/modules/users/` retirada (−1,038 líneas adicionales).

El reemplazo oficial sigue siendo **`ProfileManagement.jsx`** (Supabase), montado desde **`HR.jsx`** cuando `section=usuarios`.

---

## Rutas revisadas

| Ruta | Componente actual | ¿Usa Legacy `usuarios`? | Estado |
|------|-------------------|-------------------------|--------|
| `/hr?section=usuarios` | `ProfileManagement.jsx` | **No** | **Vivo (moderno)** — default RRHH para roles admin/gerente/RRHH |
| `/hr?section=usuarios&profileId=…&mode=edit` | `ProfileManagement.jsx` | **No** | **Vivo** — deep link desde `MyProfilePanel` |
| `/hr` (sin section, rol RRHH/admin) | Redirect implícito → `usuarios` → `ProfileManagement` | **No** | **Vivo** |
| `/inventory?section=usuarios` | No existe en `allowedSections` → cae a `inventario` moderno | **No** | **Inalcanzable** como legacy usuarios |
| `/hr?section=reportesAsistencia` | `LegacyInventoryApp` → `AttendanceReportsModule` | No monta `UsersModule` | **Vivo** — distinto bloque legacy |
| Cualquier `/hr?section=…` no interceptado | `LegacyInventoryApp` fallback | Solo si `initialSeccion === "usuarios"` | **Inalcanzable** — `HR.jsx` intercepta `usuarios` antes del fallback |

**Cadena de enrutamiento verificada (`HR.jsx`):**

```35:57:frontend/src/pages/HR.jsx
  if (selectedSection === "usuarios") {
    return <ProfileManagement requestedProfileId={profileId} editRequested={editProfile} />
  }
  // ...
  return <Suspense ...><LegacyInventoryApp initialSeccion={selectedSection} hideLegacyNavigation focusEmployeeId={profileId} editFocusedEmployee={editProfile} /></Suspense>
```

`Inventory.jsx` **no** incluye `"usuarios"` en `allowedSections` — no hay entry point por inventario.

---

## Reemplazo en producción vs legacy

| Capacidad | Legacy (`UsersModule`) | Producción (`ProfileManagement`) |
|-----------|------------------------|----------------------------------|
| Listado / CRUD colaboradores | `users[]` en memoria (sin persistencia localStorage) | Supabase `profiles` + RLS |
| Auth / contraseñas | Hash local SHA-256, reset manual en modal | Supabase Auth + recovery |
| Horarios | Turnos embebidos en objeto usuario | `ScheduleManagement` + horarios en perfil |
| Dashboard KPIs RRHH | `renderHRDashboard` (alertas, clima, scores) | **No equivalente** — no bloquea limpieza |
| Perfil 8 tabs (docs, desempeño, carrera…) | `renderHRProfile` | Perfil Supabase (campos operativos, PIN asistencia, roles) |
| Solicitudes acceso / recovery | `accessRequests` + panel en gestión usuarios | Flujos Supabase / asistencia moderna |
| Datos demo | `MOCK_HR_EMPLOYEES` definido pero **nunca usado** | N/A |

**Conclusión funcional:** Lo operativo (altas, bajas, roles, PIN, horarios especiales) ya vive en Supabase. El legacy aporta sobre todo un **dashboard analítico** y perfiles enriquecidos con datos mock/ locales que no alimentan producción.

---

## Secciones legacy revisadas

| Bloque | Ubicación aprox. | ¿Se renderiza en prod? | Riesgo de borrar |
|--------|------------------|------------------------|------------------|
| JSX `seccionActiva === "usuarios"` → `UsersModule` | L4052–4107 | **No** | **Bajo** |
| `UsersModule.jsx` + `usersHelpers.js` + `Users.css` | `frontend/src/modules/users/` (529 + 215 + 294 líneas) | **No** (solo import desde Legacy) | **Bajo** tras quitar montaje |
| `renderHRDashboard` | L2166–2198 | **No** | **Bajo** |
| `renderHRAlerts` | L2201–2223 | **No** | **Bajo** |
| `renderHRProfile` (+ tabs: docs, turnos, desempeño…) | L2392–2456 (+ helpers L2225–2390) | **No** | **Bajo** |
| `renderUserManagementView` + `renderAccessRequestsPanel` | L2503–2599 | **No** | **Bajo** |
| Formulario colaborador / handlers CRUD | L1586–1868, L1692–1830 | **No** | **Bajo** |
| Turnos en formulario usuario (`renderControlesTurno`, etc.) | L1404–2070 | **No** | **Bajo** |
| Modales crop foto + reset password | L3897–3987, handlers L2601–2845 | **No** | **Bajo** |
| CSS inline `.user-management-*` | L3848–3884 | **No** | **Bajo** |
| Estilos `profile*`, `hr*`, `userManagement*`, `crop*` | L4405–5530 (~1,125 líneas) | **No** (solo UI usuarios) | **Bajo** — auditar si algún estilo se reutiliza fuera del bloque |
| Constantes `HR_*`, helpers score/docs/alertas | L98–118, L450–640 | **No** en prod | **Bajo** |
| `MOCK_HR_EMPLOYEES` | L120–229 | **Nunca referenciado** | **Bajo** — basura segura |
| `focusEmployeeId` effect | L2917–2923 | **No** (`seccionActiva !== "usuarios"` en prod) | **Bajo** |
| Entrada `modulosDisponibles` key `"usuarios"` | L2870 | Solo `LegacySidebar` (oculto) | **Bajo** |
| Modal recuperación asistencia (`abrirRecuperacionAsistencia`) | L1870–1905, L3989–4012 | **Huérfano** — `abrirRecuperacionAsistencia` sin callers | **Bajo** |
| Variable `puedeAdministrarAccesos` | L2854 | **Sin uso** | **Bajo** |

**Entry points de `LegacyInventoryApp` (contexto):**

| Archivo | Secciones que montan Legacy | ¿Puede llegar a `usuarios`? |
|---------|----------------------------|----------------------------|
| `Inventory.jsx` | `areas`, `ordenes`, `proveedores` | **No** |
| `HR.jsx` | Fallback (p. ej. `reportesAsistencia`) | **No** — `usuarios` interceptado arriba |

---

## Referencias encontradas

| Referencia | Archivo | Uso actual | Acción sugerida |
|------------|---------|------------|-----------------|
| `/hr?section=usuarios` | `Sidebar.jsx` L40 | → `ProfileManagement` | Correcto — no tocar |
| `/hr?section=usuarios&profileId=…` | `MyProfilePanel.jsx` L236–239 | → `ProfileManagement` | Correcto |
| “Gestión de usuarios” | `UserProfileDropdown.jsx` L180 | → `/hr?section=usuarios` | Correcto |
| `import UsersModule` | `LegacyInventoryApp.jsx` L6 | Solo rama `usuarios` | Eliminar con bloque |
| `focusEmployeeId` prop | `HR.jsx` L57 | Pasado al fallback Legacy; effect legacy solo corre con `seccionActiva === "usuarios"` | Eliminar prop/effect al limpiar usuarios |
| `seccionActiva === "usuarios"` | `LegacyInventoryApp.jsx` L4052 | Sin ruta prod | Candidato eliminación |
| `setSeccionActiva("usuarios")` | — | **No encontrado** en frontend | Confirma inalcanzabilidad por navegación interna |
| `react-easy-crop` | `LegacyInventoryApp.jsx` L3–4 | Solo crop de avatar colaborador | Quitar import tras limpieza |

---

## Infraestructura compartida — **no borrar en Fase usuarios**

Estos elementos pertenecen al **shell legacy** que aún sirve órdenes, proveedores, áreas y reportes de asistencia:

| Elemento | Motivo |
|----------|--------|
| `usuarioActual` + pantalla login legacy (L3827–3843) | Gate de todo `LegacyInventoryApp` cuando no hay sesión local |
| `iniciarSesion` / `cerrarSesion` | Auth local para secciones legacy vivas |
| `users` state + `usuariosAutorizados` embebidos | Login legacy (aunque `users[]` inicia vacío y no persiste en localStorage) |
| `getUserAuth`, `hashPassword`, migración contraseñas (L1205–1237) | Usados por `iniciarSesion` |
| `hasRole`, `puedeVerReportesRRHH` | Permisos de secciones legacy aún vivas |
| `useAuth()` / `authenticatedUser` | Puente parcial para órdenes de compra (`purchaseOrderRole`) |

**Nota arquitectónica:** Un usuario con sesión Supabase pero **sin** `usuarioActual` en `localStorage` puede ver la pantalla “Iniciar sesión” legacy al entrar a `/inventory?section=ordenes`. Eso es independiente del bloque `usuarios`, pero conviene resolverlo en una fase posterior (puente Supabase → shell legacy o retiro del gate local).

---

## Caminos de usuario en producción

| Origen | ¿Llega a legacy `usuarios` / `UsersModule`? |
|--------|---------------------------------------------|
| Sidebar “Colaboradores” | **No** → `ProfileManagement` |
| `/hr` default (roles RRHH) | **No** → `ProfileManagement` |
| `UserProfileDropdown` / `MyProfilePanel` | **No** → `ProfileManagement` |
| `Inventory.jsx` | **No** — no expone section `usuarios` |
| `HR.jsx` fallback Legacy | **No** — `usuarios` interceptado |
| `LegacySidebar` tab RRHH | **No** — oculto (`hideLegacyNavigation=true`) |
| Deep link manual `/hr?section=usuarios` vía Legacy | **Imposible** — `HR.jsx` no llega al fallback |
| Hipotético `initialSeccion="usuarios"` directo al componente | **Sí** — solo import programático / dev; no hay ruta |

---

## Estimación de líneas eliminables

| Área | Líneas aprox. |
|------|---------------|
| Montaje JSX + import `UsersModule` | ~60 |
| Renderers HR (`renderHR*` cluster) | ~500 |
| Handlers formulario / CRUD / turnos / crop / reset | ~900 |
| State + computed `hrEmployees*` + effects | ~200 |
| Helpers módulo (`HR_*`, score, docs, alertas, `MOCK_HR_*`) | ~320 |
| Estilos profile/hr/userManagement/crop | ~1,125 |
| Modales JSX + CSS inline user-management | ~90 |
| Archivos `modules/users/*` | **1,038** |
| **Total estimado** | **~3,200–3,500** (−55% adicional sobre monolito; −~40% repo legacy usuarios incl. módulo) |

Tras limpieza proyectada: monolito ~**2,300–2,500** líneas (antes de extraer órdenes/áreas/reportes).

---

## Veredicto

### Seguro para eliminar (flujo producción normal)

- Todo el cluster **`UsersModule`** y renderers HR asociados.
- Carpeta **`frontend/src/modules/users/`** completa.
- **`MOCK_HR_EMPLOYEES`** (código muerto adicional).
- Modal recuperación asistencia huérfano (`abrirRecuperacionAsistencia` sin callers).
- Entrada `"usuarios"` en `modulosDisponibles` / `moduleContext`.
- Props `focusEmployeeId` / `editFocusedEmployee` si solo servían a perfil legacy (validar que `reportesAsistencia` no los use — hoy el effect exige `seccionActiva === "usuarios"`).

### Mantener por ahora

- Login legacy (`usuarioActual`, `iniciarSesion`, `users` mínimo para auth embebida).
- `AttendanceReportsModule` y resto de secciones legacy vivas.

### No requiere redirect adicional

A diferencia de inventario/recetas/requisición, **`/hr?section=usuarios` ya resuelve a Supabase**. No hace falta guard de redirect en `HR.jsx` para usuarios.

---

## Recomendación — Fase usuarios (limpieza conservadora)

1. **Eliminar por bloques** (orden sugerido):
   - Rama JSX `seccionActiva === "usuarios"` y `import UsersModule`.
   - Eliminar carpeta `frontend/src/modules/users/`.
   - Renderers `renderHR*` y helpers exclusivos (grep previo por nombre).
   - Handlers colaborador / turnos-form / crop / password reset / `accessRequests`.
   - State HR (`currentHRView`, `userForm`, `hrFilters`, etc.).
   - Estilos `profile*`, `hr*`, `userManagement*`, modales crop/password.
   - Constantes `MOCK_HR_EMPLOYEES`, `HR_PERFORMANCE_FIELDS`, `HR_DOCUMENT_TYPES` si no quedan referencias.
   - Quitar `react-easy-crop` del import si no hay otro uso.
2. **Conservar** login legacy y funciones usadas por `iniciarSesion` (`getUserAuth`, hash, etc.).
3. **Post-limpieza:** `npm run build`, smoke test:
   - `/hr?section=usuarios` (listado, editar perfil, crear usuario).
   - `/inventory?section=ordenes`, `proveedores`, `areas`.
   - `/hr?section=reportesAsistencia`.
4. **Opcional posterior:** puente Supabase → `usuarioActual` para retirar pantalla login duplicada.

---

## Archivos auditados

- `frontend/src/pages/HR.jsx` — intercepta `usuarios` → Supabase
- `frontend/src/pages/Inventory.jsx` — sin section `usuarios`
- `frontend/src/pages/ProfileManagement.jsx` — reemplazo producción (1,301 líneas)
- `frontend/src/components/Sidebar.jsx` — link Colaboradores
- `frontend/src/components/UserProfileDropdown.jsx` — gestión usuarios
- `frontend/src/components/MyProfilePanel.jsx` — deep link perfil
- `frontend/src/modules/LegacyInventoryApp.jsx` — bloque usuarios / HR legacy
- `frontend/src/modules/users/UsersModule.jsx`
- `frontend/src/modules/users/usersHelpers.js`
- `frontend/src/modules/users/Users.css`

*Auditoría: 2026-06-09. Limpieza aplicada: 2026-06-09. Relacionada con `docs/legacy-dead-code-audit.md` (inventario/recetas/requisición).*

---

## Limpieza completada (2026-06-09)

| Métrica | Valor |
|---------|-------|
| Líneas monolito antes | 5,845 |
| Líneas monolito después | **2,494** |
| Eliminadas (monolito) | **3,351** |
| Eliminadas (`modules/users/`) | **1,038** |
| Reducción acumulada vs referencia (11,539) | **~78.4%** |
| Build | OK |
| Bundle Legacy (gzip) | ~31 kB (antes ~53 kB) |

**Archivos tocados:**
- `frontend/src/modules/LegacyInventoryApp.jsx` — eliminación principal
- `frontend/src/modules/users/` — carpeta retirada (3 archivos)
- `frontend/src/pages/HR.jsx` — props `focusEmployeeId` / `editFocusedEmployee` retiradas del fallback Legacy

**Conservado:** `usuarioActual`, `iniciarSesion`, `cerrarSesion`, `users` + `getUserAuth` + `hashPassword` (login legacy); órdenes, proveedores, áreas, reportes asistencia.

**Smoke test sugerido:** `/hr?section=usuarios` (ProfileManagement); `/inventory?section=ordenes|proveedores|areas`; login legacy en secciones Legacy; `/hr?section=reportesAsistencia`.
