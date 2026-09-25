import {
  FELPLEX_CONSUMIDOR_FINAL_ADDRESS,
  FELPLEX_DESCRIPTION_MAX_LENGTH,
  FELPLEX_EXTERNAL_ID_MAX_LENGTH,
} from "./constants.ts"
import { formatFelplexDatetimeIssue } from "./datetimeIssue.ts"
import { resolveFelplexItemType } from "./itemType.ts"
import { assertDocumentMoney, extractVatIncluded, moneyEquals, roundMoney } from "./money.ts"
import type {
  BuildPayloadResult,
  FelDocumentRow,
  FelplexEmailEntry,
  FelplexPayloadCandidate,
  FelplexWithoutIvaFlag,
} from "./types.ts"

export const FELPLEX_CONTRACT_UNCONFIRMED = "FELPLEX_CONTRACT_UNCONFIRMED" as const
export const FELPLEX_PAYLOAD_INVALID = "FELPLEX_PAYLOAD_INVALID" as const

export interface BuildPayloadOptions {
  /** Explicit issue datetime — builder never calls Date.now() internally. */
  datetimeIssue: string
  /** When true, attach candidate payload for offline review/tests only. */
  includeCandidate?: boolean
}

const EMPTY_TAXES = {
  quantity: null,
  tax_code: null,
  full_name: null,
  short_name: null,
  tax_amount: null,
  taxable_amount: null,
} as const

const FORBIDDEN_PAYLOAD_KEYS = [
  "api_key",
  "apikey",
  "x-authorization",
  "authorization",
  "bearer",
  "password",
  "secret",
  "token",
  "service_role",
] as const

export function buildFelplexPayload(
  document: FelDocumentRow,
  options: BuildPayloadOptions,
): BuildPayloadResult {
  const validationError = validateDocumentForPayload(document, options.datetimeIssue)
  if (validationError) {
    return {
      ok: false,
      code: FELPLEX_CONTRACT_UNCONFIRMED,
      blockedFields: [validationError],
    }
  }

  const payload = buildValidatedFactPayload(document, options.datetimeIssue)
  const payloadError = validateBuiltPayload(payload)
  if (payloadError) {
    return {
      ok: false,
      code: FELPLEX_PAYLOAD_INVALID,
      blockedFields: [payloadError],
      candidate: options.includeCandidate ? payload : undefined,
    }
  }

  return {
    ok: true,
    payload,
    provisional: true,
  }
}

function validateDocumentForPayload(document: FelDocumentRow, datetimeIssue: string): string | null {
  const moneyError = assertDocumentMoney(document)
  if (moneyError) return moneyError

  if (document.discount_total !== 0) {
    return "FEL_DISCOUNT_NOT_AUTHORITATIVE"
  }

  const externalId = normalizeExternalId(document.external_id)
  if (!externalId) return "FEL_EXTERNAL_ID_REQUIRED"

  if (!formatFelplexDatetimeIssue(datetimeIssue)) {
    return "FEL_DATETIME_ISSUE_INVALID"
  }

  if (!resolveFelplexItemType(document)) {
    return "FEL_ITEM_TYPE_UNRESOLVED"
  }

  if (document.receiver_nit !== "CF") {
    if (!document.receiver_name.trim()) return "FEL_RECEIVER_NAME_REQUIRED"
    if (!document.receiver_nit.trim()) return "FEL_RECEIVER_NIT_REQUIRED"
  }

  const withoutIvaFlag = resolveTaxedItemWithoutIvaFlag(document)
  if (withoutIvaFlag === null) {
    return "FEL_EXEMPT_SALE_NOT_SUPPORTED"
  }

  return null
}

/**
 * POS v1: solo ventas gravadas (without_iva=0). Exento (flag 1) requiere exempt_phrase — no soportado.
 */
export function resolveTaxedItemWithoutIvaFlag(
  document: Pick<FelDocumentRow, "vat_total" | "invoice_total">,
): FelplexWithoutIvaFlag | null {
  if (document.invoice_total <= 0) return null
  if (document.vat_total === 0) return null
  return 0
}

export function isFelplexWithoutIvaFlag(value: unknown): value is FelplexWithoutIvaFlag {
  return value === 0 || value === 1
}

function buildValidatedFactPayload(
  document: FelDocumentRow,
  datetimeIssue: string,
): FelplexPayloadCandidate {
  const datetime = formatFelplexDatetimeIssue(datetimeIssue)!
  const itemType = resolveFelplexItemType(document)!
  const invoiceTotal = roundMoney(document.invoice_total)
  const totalTax = roundMoney(document.vat_total)
  const withoutIvaFlag = resolveTaxedItemWithoutIvaFlag(document)!

  // POS v1: one aggregated B line (allowed channels only; delivery blocked in gates).
  const item = {
    qty: 1,
    type: itemType,
    price: invoiceTotal,
    description: truncateDescription(document.fiscal_description),
    without_iva: withoutIvaFlag,
    discount: 0,
    is_discount_percentage: 0,
    taxes: { ...EMPTY_TAXES },
  }

  const payload: FelplexPayloadCandidate = {
    type: "FACT",
    currency: "GTQ",
    datetime_issue: datetime,
    external_id: normalizeExternalId(document.external_id)!,
    items: [item],
    total: invoiceTotal,
    total_tax: totalTax,
    emails: sanitizeEmailList(document.receiver_email),
    emails_cc: [],
    exempt_phrase: null,
    custom_fields: [],
  }

  if (document.receiver_nit === "CF") {
    payload.to_cf = 1
    payload.to = {
      tax_code_type: "NIT",
      tax_code: "CF",
      tax_name: "Consumidor Final",
      address: { ...FELPLEX_CONSUMIDOR_FINAL_ADDRESS },
    }
  } else {
    payload.to_cf = 0
    payload.to = {
      tax_code_type: "NIT",
      tax_code: document.receiver_nit.trim(),
      tax_name: document.receiver_name.trim(),
      address: buildReceiverAddress(document.receiver_address),
    }
  }

  return payload
}

export function validateBuiltPayload(payload: FelplexPayloadCandidate): string | null {
  if (payloadContainsForbiddenKeys(payload)) {
    return "FEL_FORBIDDEN_PAYLOAD_KEY"
  }

  if (!isSafeMoney(payload.total) || !isSafeMoney(payload.total_tax)) {
    return "FEL_TOTAL_INVALID"
  }

  if (payload.items.length < 1) {
    return "FEL_ITEMS_REQUIRED"
  }

  const emailError = validateEmailEntries(payload.emails, "FEL_EMAILS_INVALID")
  if (emailError) return emailError
  const emailCcError = validateEmailEntries(payload.emails_cc, "FEL_EMAILS_CC_INVALID")
  if (emailCcError) return emailCcError

  let itemsTotal = 0
  for (const item of payload.items) {
    if (!isSafeMoney(item.price) || !isSafeMoney(item.discount)) {
      return "FEL_ITEM_MONEY_INVALID"
    }
    if (!isFelplexWithoutIvaFlag(item.without_iva)) {
      return "FEL_ITEM_WITHOUT_IVA_INVALID"
    }
    if (item.without_iva === 1) {
      if (payload.exempt_phrase == null) {
        return "FEL_EXEMPT_PHRASE_REQUIRED"
      }
    } else if (payload.exempt_phrase != null) {
      return "FEL_EXEMPT_PHRASE_UNEXPECTED"
    }
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      return "FEL_ITEM_QTY_INVALID"
    }
    if (item.type !== "B" && item.type !== "S") {
      return "FEL_ITEM_TYPE_INVALID"
    }
    if (!item.description.trim()) {
      return "FEL_ITEM_DESCRIPTION_REQUIRED"
    }
    itemsTotal = roundMoney(itemsTotal + roundMoney(item.price * item.qty))
  }

  if (!moneyEquals(itemsTotal, payload.total)) {
    return "FEL_ITEMS_TOTAL_MISMATCH"
  }

  const expectedVat = extractVatIncluded(payload.total)
  if (!moneyEquals(expectedVat.vatTotal, payload.total_tax)) {
    return "FEL_TOTAL_TAX_PROVISIONAL_MISMATCH"
  }

  if (payload.to_cf === 1) {
    if (!payload.to || payload.to.tax_code !== "CF") {
      return "FEL_CF_RECEIVER_INVALID"
    }
  } else if (payload.to_cf === 0) {
    if (!payload.to?.tax_code || payload.to.tax_code === "CF") {
      return "FEL_NIT_RECEIVER_INVALID"
    }
  }

  return null
}

function normalizeExternalId(value: string): string | null {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return null
  if (trimmed.length > FELPLEX_EXTERNAL_ID_MAX_LENGTH) return null
  return trimmed
}

function truncateDescription(value: string): string {
  const trimmed = String(value ?? "").trim()
  if (trimmed.length <= FELPLEX_DESCRIPTION_MAX_LENGTH) return trimmed
  return trimmed.slice(0, FELPLEX_DESCRIPTION_MAX_LENGTH)
}

export function sanitizeEmailList(email: string | null): FelplexEmailEntry[] {
  if (!email) return []
  const trimmed = email.trim()
  if (!trimmed || trimmed.includes("@") === false) return []
  return [{ email: trimmed }]
}

function validateEmailEntries(entries: FelplexEmailEntry[], code: string): string | null {
  if (!Array.isArray(entries)) return code
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") return code
    const email = typeof entry.email === "string" ? entry.email.trim() : ""
    if (!email || !email.includes("@")) return code
  }
  return null
}

function buildReceiverAddress(raw: string | null) {
  const street = String(raw ?? "").trim() || "Ciudad"
  return {
    street,
    city: "Guatemala",
    state: "Guatemala",
    zip: "01001",
    country: "GT",
  }
}

function isSafeMoney(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

export function payloadContainsSecrets(payload: unknown): boolean {
  const text = JSON.stringify(payload).toLowerCase()
  return FORBIDDEN_PAYLOAD_KEYS.some((key) => text.includes(key))
}

function payloadContainsForbiddenKeys(payload: unknown): boolean {
  return payloadContainsSecrets(payload)
}

export function externalIdFromDocument(document: Pick<FelDocumentRow, "external_id">): string | null {
  return normalizeExternalId(document.external_id)
}
