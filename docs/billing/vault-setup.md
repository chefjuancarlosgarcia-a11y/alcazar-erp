# Supabase Vault — credenciales FELplex

Las API Keys **nunca** se almacenan en `app_settings`, tablas SQL ni variables `VITE_*`.

## 1. Habilitar Vault

En Supabase Dashboard → **Database → Extensions**, habilita **Vault** (si no está activo).

## 2. Crear secretos

SQL (ejecutar como superuser / SQL Editor):

```sql
select vault.create_secret(
  '<API_KEY_FELPLEX_STAGE>',
  'billing_felplex_gt_stage',
  'FELplex API Key — entorno stage'
);

-- Produccion (cuando corresponda):
-- select vault.create_secret('<API_KEY_PROD>', 'billing_felplex_gt_production', 'FELplex API Key — produccion');
```

## 3. Configurar proveedor en el ERP

1. Ajustes → **Facturación electrónica**
2. Entorno: Stage
3. ID empresa FELplex: valor proporcionado por FELplex
4. Guardar configuración
5. **Probar conexión**

## 4. Rotación

1. `vault.create_secret` con nuevo valor y nombre `_v2`
2. Actualizar `vault_secret_name` en configuración del proveedor
3. Probar conexión
4. Eliminar secreto anterior cuando esté validado

## 5. Acceso

Solo la Edge Function `billing-test-connection` (service role) invoca `get_billing_vault_secret`.
