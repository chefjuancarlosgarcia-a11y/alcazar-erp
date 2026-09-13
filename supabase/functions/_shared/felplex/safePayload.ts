import type { FelplexTransportResult, TransportErrorKind } from "./types.ts"

export interface SafeProviderResponsePayload {
  http_status?: number | null
  error_kind?: TransportErrorKind | string | null
  provider_valid?: boolean | null
  safe_code?: string | null
  safe_message?: string | null
}

export function buildSafeProviderResponsePayload(input: {
  httpStatus?: number | null
  errorKind?: TransportErrorKind | string | null
  providerValid?: boolean | null
  safeCode?: string | null
  safeMessage?: string | null
}): SafeProviderResponsePayload {
  return {
    http_status: input.httpStatus ?? null,
    error_kind: input.errorKind ?? null,
    provider_valid: input.providerValid ?? null,
    safe_code: input.safeCode ? String(input.safeCode).slice(0, 64) : null,
    safe_message: input.safeMessage ? String(input.safeMessage).slice(0, 240) : null,
  }
}

export function buildSafeSuccessPayload(input: {
  httpStatus: number
  felUuid: string
  satAuthorization: string
}): SafeProviderResponsePayload {
  return {
    http_status: input.httpStatus,
    provider_valid: true,
    safe_code: "certified",
    safe_message: "Certificacion recibida.",
  }
}

export function isSafeProviderPayload(value: unknown): value is SafeProviderResponsePayload {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const allowed = new Set([
    "http_status",
    "error_kind",
    "provider_valid",
    "safe_code",
    "safe_message",
  ])
  return Object.keys(record).every((key) => allowed.has(key))
}

export function assertNoRawProviderBodyPersisted(
  transportResult: FelplexTransportResult,
  persisted: unknown,
): boolean {
  if (persisted == null) return true
  if (isSafeProviderPayload(persisted)) return true
  if (transportResult.body != null && persisted === transportResult.body) return false
  return !looksLikeRawProviderBody(persisted)
}

function looksLikeRawProviderBody(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const riskyKeys = ["invoice_xml", "invoice_url", "errors", "uuid", "sat"]
  return riskyKeys.some((key) => key in record)
}
