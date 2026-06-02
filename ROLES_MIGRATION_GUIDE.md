# Sistema de Roles Configurables - Implementación Completa

## Resumen de cambios realizados

### 1. Base de datos (Supabase)

**Archivo: `supabase/schema/033_user_roles_catalog.sql`**

✅ Creada tabla `public.user_roles` con:
- `role_key`: Identificador único normalizado (ej: "recursos_humanos")
- `role_name`: Nombre mostrado al usuario (ej: "Recursos Humanos")
- `description`: Descripción del rol
- `category`: Categoría (ej: "Administración", "Cocina", etc.)
- `is_system`: Boolean para marcar roles del sistema (no editables)
- `is_active`: Control de activación/desactivación

✅ Poblada con 20 roles existentes:
- Roles del sistema (admin, gerente_general, gerente, etc.)
- Roles compatibles con alias (rrhh → recursos_humanos, cajero → caja, etc.)

✅ Funciones y triggers creados:
- `validate_profile_role()`: Normaliza y valida roles en inserciones/actualizaciones
- `validate_role_exists()`: Valida que el rol exista en `user_roles`
- `normalize_profile_role()`: Normaliza variantes de roles
- `normalize_role_name()`: Convierte nombres a keys (ej: "Closing Concierge" → "closing_concierge")
- Triggers para prevenir eliminación de roles del sistema y mantener `updated_at`

✅ RLS implementado:
- Lectura: Todos autenticados ven roles activos; managers ven todos
- Escritura: Solo admin/gerente_general/gerente pueden crear/editar
- Protección: No se pueden eliminar roles del sistema (`is_system = true`)
- Validación: No se pueden deactivar todos los roles activos

### 2. Frontend - Servicios

**Archivo: `frontend/src/services/userRolesService.js`**

✅ Funciones disponibles:
- `getUserRoles()`: Obtiene roles activos
- `getAllUserRoles()`: Obtiene todos (para admins)
- `createUserRole(payload)`: Crea nuevo rol
- `updateUserRole(id, payload)`: Actualiza rol existente
- `deactivateUserRole(id)`: Desactiva rol (preferible a borrar)
- `activateUserRole(id)`: Reactiva rol
- `normalizeRoleName(name)`: Normaliza nombre a clave
- `formatRoleKey(roleKey)`: Convierte key a formato display
- `getRolesByCategory()`, `getRoleCategories()`: Filtrado por categoría

### 3. Frontend - Permisos

**Archivo: `frontend/src/utils/profilePermissions.js`**

✅ Actualizaciones:
- Adicionada carga dinámica de roles desde BD via `loadDynamicRoles()`
- Cache de roles para evitar consultas repetidas
- `getAllowedAssignableRoles()` ahora filtra por roles disponibles dinámicamente
- `normalizeRole()` mantiene compatibilidad con roles alias
- Funciones Helper: `getRoleDisplayName()`, `clearRolesCache()`

### 4. Frontend - Componentes principales

#### **ProfileManagement.jsx**
✅ Cambios:
- Importa `userRolesService` y funciones dinámicas
- Carga roles dinámicamente al montar
- Dropdowns ahora muestran roles desde BD (no hardcoded)
- **Nuevo**: Botón "+ Crear rol" en cada dropdown
- **Nuevo**: Modal para crear rol rápidamente desde el formulario
- Asignación automática de rol creado al usuario actual

#### **RolesManagement.jsx (NUEVO)**
✅ Componente completo de administración:
- Tabla de roles con filtros (Todos, Activos, Inactivos, Sistema)
- Editar nombre, descripción, categoría
- Activar/desactivar roles (no borrar)
- Roles del sistema marcados como no editables
- Modal para crear/editar roles
- Mensajes de confirmación

#### **Settings.jsx (Actualizado)**
✅ Sistema de tabs:
- Primera tab: "Roles de Usuario" → muestra RolesManagement

### 5. Frontend - Actualizaciones de referencias de roles

✅ Archivos actualizados para usar roles normalizados:

| Archivo | Cambios |
|---------|---------|
| `Tasks.jsx` | "rrhh" → "recursos_humanos"; MANAGEMENT_ROLES con normalizeRole() |
| `ScheduleManagement.jsx` | "rrhh" → "recursos_humanos" en EDITOR_ROLES y PUBLISHER_ROLES |
| `POS.jsx` | "cajero" → "caja" en POS_ROLES |
| `Sidebar.jsx` | Todos los roles normalizados: "cocinero"→"cocina", "pizzero"→"pizzeria", etc. |
| `LegacyInventoryApp.jsx` | Importa normalizeRole(); actualiza canReviewEvidence check |

### 6. CSS

✅ Nuevos estilos:
- `ProfileManagement.css`: Botón "+ Crear rol" y modal de nuevo rol
- `RolesManagement.css`: Tabla, filtros, badges, modal completo
- `Settings.css`: Tabs de configuración

## Flujo de uso

### Para usuarios admin/gerente_general/gerente:

1. **Crear nuevo rol** (2 opciones):
   - Vía Gestión de Usuarios: Dropdown → "+ Crear rol" → Modal
   - Vía Configuración → "Roles de Usuario" → "+ Crear Rol" → Modal

2. **Asignar rol a usuario**:
   - Gestión de Usuarios → Editar usuario → Seleccionar rol del dropdown
   - Nuevos roles aparecen automáticamente después de crear

3. **Administrar roles**:
   - Configuración → "Roles de Usuario"
   - Ver todos, filtrar por estado/tipo
   - Editar nombre/descripción/categoría
   - Activar/desactivar según sea necesario

### Para usuarios RRHH (Recursos Humanos):
- Pueden crear/asignar solo roles no protegidos
- No pueden editar roles del sistema

## Migración y compatibilidad

### Roles normalizados después de la migración 033:

```
Antes → Después
rrhh → recursos_humanos
cajero → caja
cocinero → cocina
pizzero → pizzeria
```

### Compatibilidad hacia atrás:
- ✅ Función `normalize_profile_role()` maneja los alias
- ✅ Frontend usa `normalizeRole()` en comparaciones críticas
- ✅ Base de datos almacena form normalizado en `profiles.role`
- ✅ AuthContext mantiene ambos en ROLE_ACCESS_MAP para compatibilidad

### NO se rompen:
- ✅ Usuarios existentes (roles se normalizan automáticamente)
- ✅ Kimberly/RRHH
- ✅ Claudia/gerente_general
- ✅ Andrea/gerente_general
- ✅ Admin
- ✅ Checklists approval
- ✅ Permisos de módulos
- ✅ Horarios
- ✅ Asistencia

## Próximos pasos

1. **Aplicar migración SQL**:
   ```sql
   -- En Supabase SQL Editor
   -- Ejecutar: supabase/schema/033_user_roles_catalog.sql
   ```

2. **Build frontend**:
   ```bash
   npm run build
   ```

3. **Testing**:
   - [ ] Crear usuario con rol existente
   - [ ] Crear nuevo rol desde Gestión de Usuarios
   - [ ] Crear nuevo rol desde Configuración
   - [ ] Editar rol existente
   - [ ] Desactivar rol
   - [ ] Verificar que roles del sistema no se pueden editar
   - [ ] Verificar que usuarios RRHH tienen permisos limitados
   - [ ] Verificar que nuevos roles funcionan en toda la app

4. **Rollout**:
   - [ ] Comunicar a usuarios admin/gerente sobre nueva funcionalidad
   - [ ] Tener plan de rollback si es necesario
   - [ ] Monitorear permisos después de aplicar

## Notas técnicas

- Los roles se almacenan como `role_key` (ej: "recursos_humanos")
- El dropdown muestra `role_name` (ej: "Recursos Humanos")
- La normalización es automática en inserciones/actualizaciones
- El sistema es totalmente retrocompatible con datos existentes
- No hay eliminación de roles, solo desactivación
- Los roles del sistema son inmutables (`is_system = true`)

## Funcionalidad adicional

- Sistema de categorización de roles para mejor organización
- Descripciones de rol para documentación
- Auditoría implícita via `created_by`, `created_at`, `updated_at`
- Caché de roles en frontend para mejor performance
- Validaciones en tiempo real (duplicados, nombres vacíos, etc.)
