import {
  FELPLEX_STAGE_BASE_URL,
  FELPLEX_STAGE_HOST,
} from "./constants.ts"

const ALLOWED_PROTOCOL = "https:"
const ALLOWED_HOSTNAME = FELPLEX_STAGE_HOST

export interface FelplexUrlValidationError {
  code: "FELPLEX_URL_BLOCKED"
  message: string
}

export function validateFelplexStageUrl(rawUrl: string): FelplexUrlValidationError | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return blocked("URL FELplex invalida.")
  }

  if (parsed.protocol !== ALLOWED_PROTOCOL) {
    return blocked("Solo HTTPS esta permitido para FELplex Stage.")
  }

  if (parsed.hostname !== ALLOWED_HOSTNAME) {
    return blocked("Host FELplex no autorizado.")
  }

  if (parsed.username || parsed.password) {
    return blocked("URL con credenciales no permitida.")
  }

  if (parsed.search || parsed.hash) {
    return blocked("URL con query o hash no permitida.")
  }

  if (parsed.port && parsed.port !== "443") {
    return blocked("Puerto FELplex no autorizado.")
  }

  return null
}

export function resolveFelplexStageBaseUrl(baseUrl: string | null | undefined): string | null {
  const candidate = (baseUrl?.trim() || FELPLEX_STAGE_BASE_URL).replace(/\/+$/, "")
  return validateFelplexStageUrl(candidate) ? null : candidate
}

export function buildFelplexCertifyUrlFromAllowlist(
  baseUrl: string | null | undefined,
  entityId: string,
): { url: string } | FelplexUrlValidationError {
  const resolved = resolveFelplexStageBaseUrl(baseUrl)
  if (!resolved) {
    return blocked("Base URL FELplex Stage no autorizada.")
  }

  const entity = entityId.trim()
  if (!entity) {
    return blocked("entity_id requerido.")
  }

  const url = `${resolved}/api/entity/${encodeURIComponent(entity)}/invoices/await`
  const validation = validateFelplexStageUrl(url)
  if (validation) return validation

  return { url }
}

export function buildFelplexGetInvoiceUrl(
  baseUrl: string | null | undefined,
  entityId: string,
  dteUuid: string,
): { url: string } | FelplexUrlValidationError {
  const resolved = resolveFelplexStageBaseUrl(baseUrl)
  if (!resolved) {
    return blocked("Base URL FELplex Stage no autorizada.")
  }

  const entity = entityId.trim()
  const uuid = dteUuid.trim()
  if (!entity || !uuid) {
    return blocked("entity_id y dte_uuid requeridos.")
  }

  const url = `${resolved}/api/entity/${encodeURIComponent(entity)}/invoices/${encodeURIComponent(uuid)}`
  const validation = validateFelplexStageUrl(url)
  if (validation) return validation

  return { url }
}

export function buildFelplexGetInvoiceTextUrl(
  baseUrl: string | null | undefined,
  entityId: string,
  dteUuid: string,
): { url: string } | FelplexUrlValidationError {
  const invoice = buildFelplexGetInvoiceUrl(baseUrl, entityId, dteUuid)
  if ("code" in invoice) return invoice
  return { url: `${invoice.url}/text` }
}

/** Modeled only — DELETE anulacion not enabled in Phase 1A. */
export function buildFelplexCancelInvoiceUrl(
  baseUrl: string | null | undefined,
  entityId: string,
  dteUuid: string,
): { url: string } | FelplexUrlValidationError {
  return buildFelplexGetInvoiceUrl(baseUrl, entityId, dteUuid)
}

function blocked(message: string): FelplexUrlValidationError {
  return { code: "FELPLEX_URL_BLOCKED", message }
}
