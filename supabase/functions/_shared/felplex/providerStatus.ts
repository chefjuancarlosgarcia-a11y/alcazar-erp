import { sanitizePublicMessage } from "./sanitize.ts"
import type { FelplexTransportResult, TransportErrorKind } from "./types.ts"

/** Contractual shapes only. Empty until FELplex documents concrete 502 codes. */
export const DOCUMENTED_SAT_REJECTION_CODES: ReadonlySet<string> = new Set()
export const DOCUMENTED_COMMUNICATION_CODES: ReadonlySet<string> = new Set()

export const MAX_PROVIDER_ERROR_ITEMS = 8
export const MAX_PROVIDER_ERROR_CODES = 8
export const MAX_SAFE_CODE_LENGTH = 64

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /x-authorization/i,
  /bearer\s+/i,
  /service_role/i,
  /secret/i,
  /password/i,
  /token/i,
]

const GENERIC_FUNCTIONAL = "Certificacion rechazada."
const GENERIC_SUBSCRIPTION = "Suscripcion FELplex no disponible."
const GENERIC_UNCLASSIFIED = "Resultado del proveedor no clasificado."
const GENERIC_INVALID = "Respuesta invalida."

export type ProviderCodeClass = "sat_rejection" | "communication" | "unclassified"

export function classifyDocumentedProviderCodes(codes: readonly string[]): ProviderCodeClass {
  if (codes.some((code) => DOCUMENTED_SAT_REJECTION_CODES.has(code))) return "sat_rejection"
  if (codes.some((code) => DOCUMENTED_COMMUNICATION_CODES.has(code))) return "communication"
  return "unclassified"
}

export function interpretFelplexProviderStatus(
  status: 402 | 403 | 422 | 502,
  text: string,
): FelplexTransportResult {
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    return {
      ok: false,
      httpStatus: status,
      body: null,
      errorKind: "malformed",
      safeCode: "malformed",
      sanitizedMessage: sanitizePublicMessage(`${GENERIC_INVALID} (${status}).`),
    }
  }

  if (status === 422) {
    const extracted = extractContractFailure(parsed, "data", GENERIC_FUNCTIONAL)
    return {
      ok: false,
      httpStatus: status,
      body: parsed,
      errorKind: "functional_failure",
      safeCode: joinSafeCodes(extracted.codes, "functional_failure"),
      sanitizedMessage: extracted.message,
    }
  }

  if (status === 402 || status === 403) {
    const extracted = extractContractFailure(parsed, "root", GENERIC_SUBSCRIPTION)
    return {
      ok: false,
      httpStatus: status,
      body: parsed,
      errorKind: "subscription",
      safeCode: joinSafeCodes(extracted.codes, "subscription"),
      sanitizedMessage: extracted.message,
    }
  }

  const extracted = extractContractFailure(parsed, "data", GENERIC_UNCLASSIFIED)
  const codeClass = classifyDocumentedProviderCodes(extracted.codes)
  const errorKind: TransportErrorKind = codeClass === "sat_rejection"
    ? "sat_rejection"
    : codeClass === "communication"
    ? "provider_communication"
    : "provider_unclassified"
  return {
    ok: false,
    httpStatus: status,
    body: parsed,
    errorKind,
    safeCode: joinSafeCodes(extracted.codes, errorKind),
    sanitizedMessage: extracted.message,
  }
}

function extractContractFailure(
  parsed: unknown,
  source: "data" | "root",
  fallback: string,
): { message: string; codes: string[] } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { message: fallback, codes: [] }
  }
  const record = parsed as Record<string, unknown>
  const container = source === "data" ? record.data : record
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    return { message: fallback, codes: [] }
  }
  const fields = container as Record<string, unknown>
  const messages = collectMessages(fields.errors)
  const codes = collectCodes(fields.error_codes)
  if (source === "root") {
    return {
      message: messages === "unexpected" ? fallback : boundMessage(messages, fallback),
      codes,
    }
  }
  return {
    message: messages === "unexpected" ? fallback : boundMessage(messages, fallback),
    codes,
  }
}

function collectMessages(errors: unknown): string[] | "unexpected" {
  if (errors == null) return []
  if (typeof errors === "string") {
    return isLiteralSafe(errors) ? [errors] : "unexpected"
  }
  if (!Array.isArray(errors)) return "unexpected"
  const messages: string[] = []
  for (const entry of errors.slice(0, MAX_PROVIDER_ERROR_ITEMS)) {
    if (typeof entry === "string") {
      if (!isLiteralSafe(entry)) return "unexpected"
      messages.push(entry)
      continue
    }
    if (!Array.isArray(entry)) return "unexpected"
    for (const nested of entry.slice(0, MAX_PROVIDER_ERROR_ITEMS)) {
      if (typeof nested !== "string" || !isLiteralSafe(nested)) return "unexpected"
      messages.push(nested)
    }
  }
  return messages
}

function collectCodes(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) return []
  const codes: string[] = []
  for (const entry of value.slice(0, MAX_PROVIDER_ERROR_CODES)) {
    if (typeof entry !== "string") continue
    const trimmed = entry.trim()
    if (!CODE_PATTERN.test(trimmed)) continue
    if (SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) continue
    codes.push(trimmed)
  }
  return codes
}

function isLiteralSafe(value: string): boolean {
  if (/[<>]/.test(value)) return false
  return !SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

function boundMessage(parts: string[], fallback: string): string {
  if (parts.length === 0) return fallback
  return sanitizePublicMessage(parts.join("; "), fallback)
}

function joinSafeCodes(codes: readonly string[], fallback: string): string {
  let joined = ""
  for (const code of codes) {
    const next = joined ? `${joined},${code}` : code
    if (next.length > MAX_SAFE_CODE_LENGTH) break
    joined = next
  }
  return (joined || fallback).slice(0, MAX_SAFE_CODE_LENGTH)
}
