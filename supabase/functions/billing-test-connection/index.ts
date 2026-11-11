import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { BillingService } from "../_shared/billing/BillingService.ts"
import type { ProviderConfigRow } from "../_shared/billing/types.ts"
import { billingCorsHeaders, billingJson } from "../_shared/billing/cors.ts"

type RequestBody = {
  provider_code?: string
  environment?: string
  legal_entity_id?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: billingCorsHeaders })
  }
  if (req.method !== "POST") {
    return billingJson({ ok: false, error: "Metodo no permitido." }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return billingJson({ ok: false, error: "Supabase no configurado." }, 500)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return billingJson({ ok: false, error: "No autenticado." }, 401)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  })
  const serviceClient = createClient(supabaseUrl, serviceKey)

  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) {
    return billingJson({ ok: false, error: "Sesion invalida." }, 401)
  }

  const { data: canManage, error: permError } = await userClient.rpc("can_manage_billing_settings")
  if (permError || !canManage) {
    return billingJson({ ok: false, error: "No tienes permiso para probar la conexion." }, 403)
  }

  let body: RequestBody = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const providerCode = body.provider_code || "felplex_gt"
  const environment = body.environment || "stage"
  const legalEntityId = body.legal_entity_id || null

  const { data: configJson, error: configError } = await serviceClient.rpc(
    "get_billing_provider_config_for_service",
    {
      p_provider_code: providerCode,
      p_environment: environment,
      p_legal_entity_id: legalEntityId
    }
  )

  if (configError) {
    return billingJson({ ok: false, error: configError.message }, 400)
  }
  if (!configJson) {
    return billingJson({
      ok: false,
      error: "No hay configuracion activa del proveedor. Guarda la configuracion en Ajustes primero."
    }, 400)
  }

  const config = configJson as ProviderConfigRow

  try {
    const billing = BillingService.fromProviderConfig(serviceClient, config)
    const result = await billing.testConnection(config, authData.user.id)

    if (!result.ok) {
      return billingJson({
        ok: false,
        error: result.errorSummary || "Prueba de conexion fallida.",
        duration_ms: result.durationMs,
        error_codes: result.errorCodes || [],
        credits: result.credits ?? null,
        provider_code: providerCode,
        adapter_version: config.adapter_version
      }, 502)
    }

    return billingJson({
      ok: true,
      credits: result.credits ?? null,
      duration_ms: result.durationMs,
      provider_code: providerCode,
      adapter_version: config.adapter_version,
      environment
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado."
    return billingJson({ ok: false, error: message }, 500)
  }
})
