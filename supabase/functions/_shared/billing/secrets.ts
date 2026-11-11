import type { ProviderConfigRow } from "./types.ts"

export const FELPLEX_GT_SECRET_ENV_VARS: Record<string, string> = {
  stage: "FELPLEX_GT_STAGE_API_KEY",
  production: "FELPLEX_GT_PRODUCTION_API_KEY"
}

export function resolveBillingApiKey(config: ProviderConfigRow): string {
  const envVarName =
    config.secret_env_var?.trim() ||
    FELPLEX_GT_SECRET_ENV_VARS[config.environment] ||
    ""

  if (!envVarName) {
    throw new Error("Nombre de Edge Function Secret no configurado para el proveedor.")
  }

  const apiKey = Deno.env.get(envVarName)?.trim()
  if (!apiKey) {
    throw new Error(
      `Edge Function Secret no configurado: ${envVarName}. ` +
        "Configuralo en Supabase Dashboard → Project Settings → Edge Functions → Secrets."
    )
  }

  return apiKey
}
