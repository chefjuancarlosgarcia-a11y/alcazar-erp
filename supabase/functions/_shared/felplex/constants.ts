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

export const FELPLEX_HTTP_TIMEOUT_MS = 30_000

export const FELPLEX_PROVIDER_CODE = "felplex_gt"

export const CASH_OPERATOR_ROLES = new Set([
  "admin",
  "gerente_general",
  "supervisor",
  "cajero",
  "caja",
])
