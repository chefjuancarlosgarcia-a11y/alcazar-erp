import { listBlockedFieldsForSnapshot } from "./contractBlocks.ts"
import { assertDocumentMoney, roundMoney } from "./money.ts"
import type { BuildPayloadResult, FelDocumentRow, FelplexPayloadCandidate } from "./types.ts"

export interface BuildPayloadOptions {
  /** Explicit issue datetime — builder never calls Date.now() internally. */
  datetimeIssue: string
  /** When true, attach candidate payload for offline review/tests only. */
  includeCandidate?: boolean
}

export function buildFelplexPayload(
  document: FelDocumentRow,
  options: BuildPayloadOptions,
): BuildPayloadResult {
  const moneyError = assertDocumentMoney(document)
  if (moneyError) {
    return {
      ok: false,
      code: "FELPLEX_CONTRACT_UNCONFIRMED",
      blockedFields: [moneyError],
    }
  }

  if (document.discount_total !== 0) {
    return {
      ok: false,
      code: "FELPLEX_CONTRACT_UNCONFIRMED",
      blockedFields: ["FEL_DISCOUNT_NOT_AUTHORITATIVE"],
    }
  }

  if (document.receiver_nit !== "CF" && !document.receiver_name.trim()) {
    return {
      ok: false,
      code: "FELPLEX_CONTRACT_UNCONFIRMED",
      blockedFields: ["FEL_RECEIVER_NAME_REQUIRED"],
    }
  }

  const blockedFields = listBlockedFieldsForSnapshot(document.receiver_nit)
  const candidate = buildCandidatePayload(document, options.datetimeIssue)

  return {
    ok: false,
    code: "FELPLEX_CONTRACT_UNCONFIRMED",
    blockedFields,
    candidate: options.includeCandidate ? candidate : undefined,
  }
}

function buildCandidatePayload(
  document: FelDocumentRow,
  datetimeIssue: string,
): FelplexPayloadCandidate {
  const emails = document.receiver_email
    ? [{ email: document.receiver_email }]
    : []

  const item = {
    qty: "1",
    type: "UNCONFIRMED",
    price: roundMoney(document.invoice_total),
    description: document.fiscal_description,
    without_iva: null,
    discount: 0,
    is_discount_percentage: 0,
    taxes: {
      quantity: null,
      tax_code: null,
      full_name: null,
      short_name: null,
      tax_amount: null,
      taxable_amount: null,
    },
  }

  const payload: FelplexPayloadCandidate = {
    type: "FACT",
    currency: "GTQ",
    datetime_issue: datetimeIssue,
    external_id: document.external_id,
    items: [item],
    total: roundMoney(document.invoice_total),
    total_tax: roundMoney(document.vat_total),
    emails,
    exempt_phrase: null,
  }

  if (document.receiver_nit === "CF") {
    payload.to_cf = 1
  } else {
    payload.to = {
      tax_code_type: "NIT",
      tax_code: document.receiver_nit,
      tax_name: document.receiver_name,
      address: document.receiver_address
        ? { street: document.receiver_address }
        : undefined,
    }
  }

  return payload
}

export function payloadContainsSecrets(payload: unknown): boolean {
  const text = JSON.stringify(payload).toLowerCase()
  return (
    text.includes("x-authorization") ||
    text.includes("api_key") ||
    text.includes("apikey") ||
    text.includes("bearer ")
  )
}
