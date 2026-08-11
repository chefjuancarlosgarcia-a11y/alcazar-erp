import {
  FELPLEX_HTTP_ENABLED_ENV,
  FELPLEX_PROVIDER_CODE,
  FELPLEX_SECRET_ENV_STAGE,
  FELPLEX_STAGE_BASE_URL,
  FELPLEX_STAGE_HOST,
  FELPLEX_STAGE_PROJECT_REF,
} from "./constants.ts"
import { roundMoney } from "./money.ts"
import { resolveFelplexStageBaseUrl, validateFelplexStageUrl } from "./urlAllowlist.ts"
import type { GateContext, GateFailure } from "./types.ts"

export function parseHttpEnabled(raw: string | undefined): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

export function extractProjectRef(supabaseUrl: string | null): string | null {
  if (!supabaseUrl) return null
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/i)
  return match?.[1] ?? null
}

export function evaluateCertificationGates(ctx: GateContext): GateFailure | null {
  const projectRef = ctx.projectRef ?? extractProjectRef(ctx.supabaseUrl)
  if (projectRef !== FELPLEX_STAGE_PROJECT_REF) {
    return gate("FEL_NOT_STAGE_PROJECT", "Certificacion FEL bloqueada fuera del proyecto Stage autorizado.", "blocked")
  }

  if (!ctx.emissionConfig) {
    return gate("FEL_EMISSION_DISABLED", "Configuracion FEL ausente.", "blocked")
  }

  if (ctx.emissionConfig.environment !== "stage") {
    return gate("FEL_ENVIRONMENT_NOT_STAGE", "Ambiente FEL distinto de stage.", "blocked")
  }

  if (!ctx.emissionConfig.emission_enabled) {
    return gate("FEL_EMISSION_DISABLED", "La emision FEL esta deshabilitada.", "blocked")
  }

  if (ctx.emissionConfig.formal_contingency_enabled) {
    return gate("FEL_CONTINGENCY_NOT_SUPPORTED", "Contingencia formal no habilitada en esta version.", "blocked")
  }

  if (!ctx.httpEnabled) {
    return gate("FELPLEX_HTTP_DISABLED", "Transporte HTTP FELplex deshabilitado.", "blocked")
  }

  const providerFailure = validateProviderConfig(ctx.providerConfig)
  if (providerFailure) return providerFailure

  if (!ctx.apiKeyPresent) {
    return gate("FEL_MISSING_CREDENTIALS", "Credenciales FELplex ausentes.", "blocked")
  }

  if (!ctx.document) {
    return gate("FEL_DOCUMENT_NOT_FOUND", "Documento FEL no encontrado.", "blocked")
  }

  const doc = ctx.document

  if (doc.environment !== "stage") {
    return gate("FEL_PRODUCTION_BLOCKED", "Documentos de produccion bloqueados en Fase 1A.", "blocked")
  }

  if (doc.status === "processing") {
    return gate("FEL_ALREADY_PROCESSING", "Certificacion en curso.", "blocked")
  }

  if (doc.status === "cancelled") {
    return gate("FEL_DOCUMENT_CANCELLED", "Documento cancelado.", "blocked")
  }

  if (doc.status === "contingency_pending" || doc.status === "contingency_certified") {
    return gate("FEL_CONTINGENCY_NOT_SUPPORTED", "Contingencia formal no habilitada.", "blocked")
  }

  if (!["pending_certification", "failed", "certified"].includes(doc.status)) {
    return gate("FEL_DOCUMENT_NOT_CERTIFIABLE", "Estado de documento no certificable.", "blocked")
  }

  if (hasUnexpectedRequestPayload(doc.request_payload)) {
    return gate("FEL_UNEXPECTED_REQUEST_PAYLOAD", "request_payload contiene datos inesperados.", "blocked")
  }

  if (ctx.discountTotal !== 0) {
    return gate("FEL_DISCOUNT_NOT_AUTHORITATIVE", "Descuentos no autoritativos bloqueados.", "blocked")
  }

  const reconciliationFailure = validateReconciliation(ctx.reconciliation)
  if (reconciliationFailure) return reconciliationFailure

  return null
}

export function validateProviderConfig(
  providerConfig: GateContext["providerConfig"],
): GateFailure | null {
  if (!providerConfig) {
    return gate("FEL_PROVIDER_CONFIG_MISSING", "Configuracion de proveedor FEL ausente.", "blocked")
  }

  if (providerConfig.provider_code !== FELPLEX_PROVIDER_CODE) {
    return gate("FEL_PROVIDER_CONFIG_INVALID", "provider_code distinto de felplex_gt.", "blocked")
  }

  if (providerConfig.environment !== "stage") {
    return gate("FEL_PRODUCTION_BLOCKED", "Configuracion de proveedor de produccion bloqueada.", "blocked")
  }

  if (!providerConfig.is_active) {
    return gate("FEL_PROVIDER_CONFIG_INVALID", "Proveedor FEL inactivo.", "blocked")
  }

  if (!providerConfig.is_default) {
    return gate("FEL_PROVIDER_CONFIG_INVALID", "Proveedor FEL no es default.", "blocked")
  }

  if (!providerConfig.entity_id?.trim()) {
    return gate("FEL_PROVIDER_CONFIG_INVALID", "entity_id vacio.", "blocked")
  }

  if (providerConfig.secret_env_var !== FELPLEX_SECRET_ENV_STAGE) {
    return gate("FEL_PRODUCTION_BLOCKED", "Secreto de proveedor no autorizado para Stage.", "blocked")
  }

  const baseUrl = providerConfig.base_url?.trim() || FELPLEX_STAGE_BASE_URL
  if (!resolveFelplexStageBaseUrl(baseUrl)) {
    return gate("FEL_PRODUCTION_BLOCKED", "Base URL FELplex no autorizada.", "blocked")
  }

  if (validateFelplexStageUrl(baseUrl)) {
    return gate("FEL_PRODUCTION_BLOCKED", "Endpoint FELplex no autorizado.", "blocked")
  }

  if (baseUrl.includes(FELPLEX_STAGE_HOST) === false && providerConfig.base_url) {
    return gate("FEL_PRODUCTION_BLOCKED", "Host FELplex no autorizado.", "blocked")
  }

  return null
}

export function validateReconciliation(
  reconciliation: GateContext["reconciliation"],
): GateFailure | null {
  if (!reconciliation) {
    return gate("FEL_ORDER_NOT_PAID", "La orden debe estar completamente pagada.", "blocked")
  }

  if (reconciliation.order_status !== "paid") {
    return gate("FEL_ORDER_NOT_PAID", "La orden debe estar en estado paid.", "blocked")
  }

  if (!reconciliation.is_fully_paid) {
    return gate("FEL_ORDER_NOT_PAID", "La orden debe estar completamente pagada.", "blocked")
  }

  if (roundMoney(reconciliation.balance_due) > 0) {
    return gate("FEL_BALANCE_DUE", "Existe saldo pendiente en la orden.", "blocked")
  }

  if (roundMoney(reconciliation.amount_paid) !== roundMoney(reconciliation.order_total)) {
    return gate("FEL_PAYMENT_MISMATCH", "Pagos no concilian con el total de la orden.", "blocked")
  }

  return null
}

export function readHttpEnabledFromEnv(env: Pick<typeof Deno.env, "get"> = Deno.env): boolean {
  return parseHttpEnabled(env.get(FELPLEX_HTTP_ENABLED_ENV))
}

function hasUnexpectedRequestPayload(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === "object" && value !== null && Object.keys(value as object).length === 0) {
    return false
  }
  return true
}

function gate(code: string, message: string, classification: GateFailure["classification"]): GateFailure {
  return { code, message, classification }
}
