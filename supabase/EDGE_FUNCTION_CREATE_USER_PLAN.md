# Plan: Edge Function `create-user`

## Objetivo

Crear usuarios Auth desde la aplicación sin exponer `service_role` en React ni en variables `VITE_*`.

## Fase actual

La pantalla **Gestión de usuarios** solo gestiona registros existentes en `public.profiles`. Para crear una cuenta nueva:

1. Admin crea el usuario en **Supabase Dashboard > Authentication > Users**.
2. El trigger `handle_new_user()` crea su `profile`.
3. Admin regresa al sistema, actualiza la lista y completa rol, área y estado.

## Fase siguiente

Crear una Edge Function denominada `create-user`.

Entrada esperada:

```json
{
  "email": "colaborador@empresa.com",
  "password": "Temporal123",
  "full_name": "Nombre Apellido",
  "username": "nombre.apellido",
  "role": "mesero",
  "area_id": "servicio",
  "area_name": "Servicio"
}
```

## Validaciones

- Requerir sesión autenticada.
- Consultar el profile del solicitante.
- Permitir ejecución solo a `admin` o `gerente_general`.
- Impedir que `gerente_general` cree o modifique un `admin`.
- Validar correo, rol permitido y unicidad de username.
- Registrar auditoría del usuario creador.

## Operación Servidor

La función deberá usar una variable secreta de entorno disponible solo en Supabase Functions:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Flujo:

1. Crear `auth.users` mediante Admin API en la Edge Function.
2. Crear o actualizar `public.profiles` con rol y área autorizados.
3. Marcar la contraseña como temporal mediante un campo o evento de seguridad futuro.
4. Devolver la contraseña temporal una sola vez al administrador solicitante.

## Regla De Seguridad

Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` en:

- `frontend/.env`
- variables con prefijo `VITE_`
- componentes React
- requests ejecutados desde el navegador

El frontend solo utilizará `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

