import {
  FELPLEX_CONSUMIDOR_FINAL_ADDRESS,
  FELPLEX_DESCRIPTION_MAX_LENGTH,
  FELPLEX_EXTERNAL_ID_MAX_LENGTH,
} from "./constants.ts"
import { formatFelplexDatetimeIssue } from "./datetimeIssue.ts"
import { resolveFelplexItemType } from "./itemType.ts"
import { assertDocumentMoney, extractVatIncluded, moneyEquals, roundMoney } from "./money.ts"
import type { BuildPayloadResult, FelDocumentRow, FelplexPayloadCandidate } from "./types.ts"

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

  return null
}

function buildValidatedFactPayload(
  document: FelDocumentRow,
  datetimeIssue: string,
): FelplexPayloadCandidate {
  const datetime = formatFelplexDatetimeIssue(datetimeIssue)!
  const itemType = resolveFelplexItemType(document)!
  const invoiceTotal = roundMoney(document.invoice_total)
  const totalTax = roundMoney(document.vat_total)
  const withoutIva = roundMoney(document.taxable_base)

  const item = {
    qty: 1,
    type: itemType,
    price: invoiceTotal,
    description: truncateDescription(document.fiscal_description),
    without_iva: withoutIva,
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

function validateBuiltPayload(payload: FelplexPayloadCandidate): string | null {
  if (payloadContainsForbiddenKeys(payload)) {
    return "FEL_FORBIDDEN_PAYLOAD_KEY"
  }

  if (!isSafeMoney(payload.total) || !isSafeMoney(payload.total_tax)) {
    return "FEL_TOTAL_INVALID"
  }

  if (payload.items.length < 1) {
    return "FEL_ITEMS_REQUIRED"
  }

  let itemsTotal = 0
  for (const item of payload.items) {
    if (!isSafeMoney(item.price) || !isSafeMoney(item.without_iva) || !isSafeMoney(item.discount)) {
      return "FEL_ITEM_MONEY_INVALID"
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

function sanitizeEmailList(email: string | null): string[] {
  if (!email) return []
  const trimmed = email.trim()
  if (!trimmed || trimmed.includes("@") === false) return []
  return [trimmed]
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
