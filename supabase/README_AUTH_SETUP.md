# Configuracion de Supabase Auth

## Ejecutar el esquema

1. Abre el proyecto en Supabase Dashboard.
2. Ve a **SQL Editor**.
3. Ejecuta `schema/001_profiles.sql`.
4. Verifica que exista `public.profiles` con RLS habilitado.
5. Para habilitar Gestión de usuarios y acceso de RRHH a datos básicos, ejecuta `schema/002_profile_management_policies.sql`.
6. Si la base ya existía antes del rol de almacén, ejecuta `schema/015_warehouse_manager_role.sql`.
7. Para registrar precio de compra, ejecuta `schema/016_inventory_purchase_price.sql`.
8. Para que la carga inicial afecte sólo Almacén, ejecuta `schema/017_inventory_initial_stock_warehouse_only.sql`. Este archivo también repara la columna de precio de compra si el paso anterior falló.
9. Para habilitar notificaciones de órdenes de compra y el rol Gerente, ejecuta `schema/018_purchase_order_notifications.sql`.
10. Para habilitar la terminal de marcaje con PIN y foto obligatoria, ejecuta `schema/019_attendance_terminal.sql`.
11. Para habilitar horarios semanales, publicación, comparativo de asistencia y planilla, ejecuta `schema/020_employee_schedules.sql`.

El trigger `handle_new_user()` crea un perfil cuando se agrega un usuario en Authentication. Por seguridad, los roles privilegiados no se aceptan desde metadata pública; deben asignarse desde administración.

## Crear el primer administrador

1. En Supabase Dashboard, abre **Authentication > Users > Add user**.
2. Crea el usuario con correo electrónico y contraseña.
3. Abre **Table Editor > profiles**.
4. Edita el registro recién creado:
   - `role`: `admin`
   - `full_name`: `Administrador`
   - `username`: `admin`
   - `status`: `active`
5. Ingresa a la aplicación con el correo y la contraseña creados.

## Variables del frontend

Configura `frontend/.env`:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICA
```

Reinicia Vite después de modificar `.env`.

## Recuperación de contraseña

En **Authentication > URL Configuration** de Supabase, agrega como redirect URL la dirección pública de la aplicación seguida de `/update-password`, por ejemplo:

```text
http://localhost:5173/update-password
https://TU-DOMINIO/update-password
```

El login envía el correo mediante `resetPasswordForEmail` y la pantalla `/update-password` actualiza la clave con `updateUser`.

## Roles soportados

`admin`, `gerente_general`, `gerente`, `encargado_almacen`, `rrhh`, `supervisor`, `cajero`, `mesero`, `cocinero`, `pizzero`, `barista`, `bartender`, `repostero`, `panadero`, `colaborador`.

## Seguridad inicial

- Cada usuario puede leer su propio perfil.
- `admin` y `gerente_general` pueden leer y editar todos los perfiles.
- `encargado_almacen` puede crear y editar productos, ajustar existencias, importar archivos y administrar imagenes del inventario, sin administrar perfiles.
- Un usuario común solo puede actualizar `email`, `phone` y `avatar_url` de su propio perfil.
- Estado, rol, área, usuario y datos laborales están protegidos por trigger.

Los módulos de inventario, POS, producción, caja, tareas y recetas siguen usando persistencia local temporal en esta etapa.

La creación de usuarios desde la aplicación se implementará con una Edge Function segura. Consulta `EDGE_FUNCTION_CREATE_USER_PLAN.md`.

## Referencias

- [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
