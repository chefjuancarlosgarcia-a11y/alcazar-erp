# Edge Function Secrets — credenciales FELplex

Las API Keys **nunca** se almacenan en `app_settings`, tablas SQL, variables `VITE_*` ni en el repositorio.

La Edge Function `billing-test-connection` lee la key con `Deno.env.get(...)` en tiempo de ejecución.

## 1. Crear secretos en Supabase

**Dashboard:** Project Settings → **Edge Functions** → **Secrets**

| Nombre | Valor |
|--------|-------|
| `FELPLEX_GT_STAGE_API_KEY` | API key FELplex **stage** (string plano, sin JSON) |
| `FELPLEX_GT_PRODUCTION_API_KEY` | API key FELplex producción (cuando corresponda) |

**CLI** (alternativa):

```bash
supabase secrets set FELPLEX_GT_STAGE_API_KEY=tu-api-key-de-felplex-stage
```

Local (desarrollo):

```bash
# supabase/functions/.env — no commitear
FELPLEX_GT_STAGE_API_KEY=tu-api-key-de-felplex-stage
```

```bash
supabase functions serve billing-test-connection --env-file supabase/functions/.env
```

Los cambios en secrets de producción **no requieren redeploy** de la función.

## 2. Configurar proveedor en el ERP

1. Ajustes → **Facturación electrónica**
2. Entorno: Stage o Production
3. **ID empresa FELplex:** valor proporcionado por FELplex (`entity_id`)
4. Guardar configuración
5. **Probar conexión**

La tabla `billing_provider_configs` guarda solo el **nombre lógico** del secret (`FELPLEX_GT_STAGE_API_KEY`), no el valor.

## 3. Rotación

1. Actualizar el valor en Dashboard → Edge Functions → Secrets (o `supabase secrets set`)
2. Probar conexión desde Settings
3. No hace falta cambiar filas en la base de datos si el nombre del secret se mantiene

## 4. Acceso

- Solo la Edge Function `billing-test-connection` (service role + JWT admin) usa la API key
- El frontend nunca recibe ni envía la key
- Migración `160_billing_edge_secrets.sql` elimina la dependencia de Supabase Vault
