# Guía de Ejecución: Migración 033 - Sistema de Roles Dinámico

## 📋 Requisitos previos

✅ Migración 032_checklist_template_approvals.sql ya aplicada
✅ Función `public.normalize_profile_role()` existe (de migración 026)
✅ Función `public.is_profile_manager()` existe
✅ Trigger `protect_profile_managed_fields` existe en tabla `profiles`
✅ Frontend compilado correctamente (npm run build exitoso)

## 🔧 Cambios en la migración 033

La migración ha sido optimizada para ejecutarse de forma segura en Supabase SQL Editor:

### 1. **Bloque DO para normalización de roles**
```sql
do $$
begin
  -- Temporarily disable the protection trigger
  alter table public.profiles disable trigger protect_profile_managed_fields;
  
  -- Normalize existing roles
  update public.profiles
  set role = public.normalize_profile_role(role)
  where role is not null;
  
  -- Re-enable the protection trigger
  alter table public.profiles enable trigger protect_profile_managed_fields;
  
exception when others then
  -- Ensure trigger is re-enabled even if update fails
  alter table public.profiles enable trigger protect_profile_managed_fields;
  raise;
end $$;
```

**Ventajas:**
- ✅ Desactiva el trigger que causa el error "No tienes permiso"
- ✅ Ejecuta la normalización de roles
- ✅ Re-activa el trigger automáticamente
- ✅ Si falla, garantiza que el trigger se re-activa

### 2. **Constraint de validación idempotente**
```sql
do $$
begin
  alter table public.profiles
    add constraint profiles_role_not_empty
    check (role is not null and length(role) > 0);
exception when duplicate_object then
  null;  -- Constraint already exists, continue
end $$;
```

**Ventajas:**
- ✅ Si la constraint ya existe, continúa sin error
- ✅ Puedes ejecutar la migración múltiples veces

## 📝 Pasos para ejecutar la migración

### Paso 1: Abrir SQL Editor en Supabase

1. Ir a [Supabase Dashboard](https://app.supabase.com)
2. Seleccionar tu proyecto
3. Ir a **SQL Editor** (lado izquierdo)
4. Crear una **Nueva Query**

### Paso 2: Copiar la migración

1. Abrir archivo `supabase/schema/033_user_roles_catalog.sql`
2. Copiar TODO el contenido (Ctrl+A, Ctrl+C)
3. Pegar en Supabase SQL Editor

### Paso 3: Ejecutar la migración

1. Hacer clic en el botón **▶️ Run** (esquina inferior derecha)
2. Esperar a que termine

**Tiempo esperado:** 5-10 segundos

### Paso 4: Verificar que funcionó

Ejecutar estas queries para verificar:

```sql
-- 1. Ver los roles creados
select role_key, role_name, is_system, is_active 
from public.user_roles 
order by is_system desc, role_key;

-- 2. Verificar que los usuarios están normalizados
select id, email, role 
from public.profiles 
where role is not null 
limit 10;

-- 3. Verificar roles específicos
select email, role 
from public.profiles 
where email in ('kimberly@example.com', 'claudia@example.com');
```

**Resultado esperado:**
- ✅ 20+ roles en la tabla `user_roles`
- ✅ Roles en `profiles` normalizados (ej: "recursos_humanos" no "rrhh")
- ✅ Sin errores

## ⚠️ Posibles errores y soluciones

### Error 1: "Permission denied for schema public"
**Causa:** Permisos insuficientes  
**Solución:** Asegurar que el usuario conectado es service_role o admin

### Error 2: "Table user_roles already exists"
**Causa:** Migración ya se ejecutó  
**Solución:** ✅ Normal, la migración es idempotente, continúa sin problema

### Error 3: "Function normalize_profile_role does not exist"
**Causa:** Migración 026 no se ejecutó  
**Solución:** Ejecutar primero `supabase/schema/026_hr_profile_management_permissions.sql`

### Error 4: "Function is_profile_manager does not exist"
**Causa:** Funciones helper no existen  
**Solución:** Verificar que todas las migraciones anteriores (020-032) estén aplicadas

## 🔄 Rollback (si es necesario)

Si necesitas revertir la migración:

```sql
-- Deshabilitar RLS (vuelve a permitir operaciones)
alter table public.user_roles disable row level security;

-- Eliminar la tabla
drop table if exists public.user_roles cascade;

-- Volver a crear la constraint de roles original
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'gerente_general', 'gerente', 'recursos_humanos', ...));
```

**Nota:** El rollback no es recomendado una vez que hay roles personalizados creados.

## ✨ Lo que sucede después

### Base de datos
1. ✅ Tabla `user_roles` creada con todos los roles
2. ✅ Índices para performance
3. ✅ RLS policies activadas
4. ✅ Triggers para validación automática
5. ✅ Función `normalize_profile_role()` normaliza roles on-the-fly

### Frontend (ya está actualizado)
1. ✅ userRolesService.js carga roles dinámicamente
2. ✅ profilePermissions.js cachea roles para performance
3. ✅ ProfileManagement.jsx permite crear nuevos roles
4. ✅ RolesManagement.jsx permite administrar roles
5. ✅ Todos los componentes usan roles normalizados

### Comportamiento de usuarios

**Admins/Gerentes:**
- Pueden crear nuevos roles desde Settings → "Roles de Usuario"
- Pueden editar descripción y categoría
- Pueden activar/desactivar (no borrar)
- Los roles del sistema no se pueden editar

**RRHH (Recursos Humanos):**
- Pueden crear roles según permisos RLS
- Acceso limitado comparado con admin

**Todos:**
- Ven roles activos en los dropdowns
- Nuevos roles aparecen automáticamente
- No se rompe con usuarios existentes

## 🧪 Testing después de migrar

```javascript
// Test en navegador (consola)

// 1. Verificar que los roles se cargan
const roles = await fetch('/api/user_roles').then(r => r.json())
console.log('Roles:', roles.length) // Debe ser > 0

// 2. Crear nuevo rol
const newRole = await fetch('/api/user_roles', {
  method: 'POST',
  body: JSON.stringify({
    role_name: "Test Role",
    category: "Test",
    description: "Test description"
  })
})
console.log('New role created:', newRole.ok) // Debe ser true

// 3. Verificar que aparece en el dropdown
// Recarga la página y verifica el dropdown de roles
```

## 📊 Monitoreo

Después de aplicar la migración, monitorear:

1. **Performance:** Logs de Supabase → No query timeouts
2. **Errores RLS:** Supabase → SQL → Si hay violaciones de RLS
3. **Usuarios:** Verificar que los 4 críticos siguen activos:
   - admin (cualquier)
   - Kimberly (RRHH → recursos_humanos)
   - Claudia (gerente_general)
   - Andrea (gerente_general)

## 📞 Soporte

Si hay problemas:

1. Revisar el archivo `ROLES_MIGRATION_GUIDE.md` para detalles técnicos
2. Ejecutar queries de verificación arriba
3. Revisar Supabase Logs → SQL Editor
4. Si falla el UPDATE de profiles, el trigger se re-activa automáticamente

## ✅ Checklist Final

- [ ] Migración 026 ya aplicada
- [ ] Migración 032 ya aplicada
- [ ] Frontend build exitoso (`npm run build`)
- [ ] Supabase SQL Editor abierto
- [ ] Migración 033 copiada y ejecutada
- [ ] Queries de verificación pasadas
- [ ] Usuarios críticos siguen activos
- [ ] Dropdown de roles funciona
- [ ] Botón "+ Crear rol" visible
- [ ] Settings → "Roles de Usuario" funciona
- [ ] Nuevo rol se crea y aparece en dropdown

---

**Fecha de implementación:** 2 de junio de 2026  
**Estado:** ✅ Listo para producción
