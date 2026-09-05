/** Stage Supabase project ref — hard block for non-Stage deployments in Phase 1A. */
export const FELPLEX_STAGE_PROJECT_REF = "tgrqarxfmpwgrkntvgma"

export const FELPLEX_STAGE_HOST = "felplex.stage.plex.lat"
export const FELPLEX_PRODUCTION_HOST = "app.felplex.com"

export const FELPLEX_STAGE_BASE_URL = `https://${FELPLEX_STAGE_HOST}`
export const FELPLEX_PRODUCTION_BASE_URL = `https://${FELPLEX_PRODUCTION_HOST}`

/** Logical Edge secret names — values live in Deno.env only. */
export const FELPLEX_SECRET_ENV_STAGE = "FELPLEX_GT_STAGE_API_KEY"
export const FELPLEX_SECRET_ENV_PRODUCTION = "FELPLEX_GT_PRODUCTION_API_KEY"

/** Independent HTTP kill switch. Default OFF when unset. */
export const FELPLEX_HTTP_ENABLED_ENV = "FELPLEX_HTTP_ENABLED"

/** Second barrier: provisional contract adopted locally; HTTP blocked until Stage proof. */
export const FELPLEX_CONTRACT_HTTP_CONFIRMED_ENV = "FELPLEX_CONTRACT_HTTP_CONFIRMED"

export const FELPLEX_HTTP_TIMEOUT_MS = 30_000

export const FELPLEX_PROVIDER_CODE = "felplex_gt"

/** Public Postman collection metadata — collection file is NOT stored in repo. */
export const FELPLEX_POSTMAN_COLLECTION_NAME = "PUBLIC - FELplex - Documentación"
export const FELPLEX_POSTMAN_COLLECTION_SHA256 =
  "f9899fbcc3787d96c9967abd3429df7a232f17b3b6fc518c1f5c17b69777b3ce"

export const FELPLEX_EXTERNAL_ID_MAX_LENGTH = 128
export const FELPLEX_DESCRIPTION_MAX_LENGTH = 500

export const FELPLEX_CONSUMIDOR_FINAL_ADDRESS = {
  street: "Ciudad",
  city: "Guatemala",
  state: "Guatemala",
  zip: "01001",
  country: "GT",
} as const

export const CASH_OPERATOR_ROLES = new Set([
  "admin",
  "gerente_general",
  "supervisor",
  "cajero",
  "caja",
])
