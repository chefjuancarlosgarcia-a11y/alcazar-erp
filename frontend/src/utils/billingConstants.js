export const BILLING_MIGRATION_HINT =
  "Aplica la migracion 159_billing_foundation.sql en Supabase."

export const BILLING_PROVIDER_CODES = {
  FELPLEX_GT: "felplex_gt"
}

export const BILLING_DOCUMENT_STATUS = {
  DRAFT: "draft",
  PENDING_CERTIFICATION: "pending_certification",
  CERTIFIED: "certified",
  REJECTED: "rejected",
  VOID_PENDING: "void_pending",
  VOIDED: "voided",
  VOID_FAILED: "void_failed"
}

export const BILLING_CONNECTION_STATUS = {
  UNKNOWN: "unknown",
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  ERROR: "error"
}

export const BILLING_ENVIRONMENTS = {
  STAGE: "stage",
  PRODUCTION: "production"
}

export const DEFAULT_BILLING_SETTINGS = {
  enabled: false,
  emission_enabled: false,
  provider_code: BILLING_PROVIDER_CODES.FELPLEX_GT,
  environment: BILLING_ENVIRONMENTS.STAGE,
  default_document_type: "invoice",
  default_legal_entity_code: "default",
  degraded_mode_allow_sale: true,
  auto_retry_enabled: false,
  retry_max_attempts: 5,
  retry_interval_minutes: 15,
  timezone: "America/Guatemala",
  phase: 0
}

export const FELPLEX_GT_DEFAULT_BASE_URLS = {
  stage: "https://felplex.stage.plex.lat",
  production: "https://app.felplex.com"
}
