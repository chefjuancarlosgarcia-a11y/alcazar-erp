import type { ActorProfile, FelDocumentRow, FelEmissionConfigRow, PaymentReconciliation } from "./types.ts"

export const Q297_DOCUMENT_ID = "11111111-1111-4111-8111-111111111111"
export const Q297_ORDER_ID = "22222222-2222-4222-8222-222222222222"

export const FIXED_DATETIME = "2026-08-08T20:00:00"

export function makeQ297Document(overrides: Partial<FelDocumentRow> = {}): FelDocumentRow {
  return {
    id: Q297_DOCUMENT_ID,
    order_id: Q297_ORDER_ID,
    external_id: "POS-22222222-2222-4222-8222-222222222222",
    environment: "stage",
    status: "pending_certification",
    receiver_nit: "CF",
    receiver_name: "Consumidor Final",
    receiver_address: null,
    receiver_email: null,
    fiscal_description: "Consumo de Alimentos",
    gross_items_total: 297,
    discount_total: 0,
    tip_total: 0,
    taxable_gross_total: 297,
    taxable_base: 265.18,
    vat_rate: 0.12,
    vat_total: 31.82,
    invoice_total: 297,
    request_payload: null,
    response_payload: null,
    fel_uuid: null,
    sat_authorization: null,
    sat_series: null,
    sat_document_number: null,
    certified_at: null,
    retry_count: 0,
    last_error: null,
    ...overrides,
  }
}

export function makeStageEmissionConfig(
  overrides: Partial<FelEmissionConfigRow> = {},
): FelEmissionConfigRow {
  return {
    id: 1,
    environment: "stage",
    emission_enabled: false,
    auto_issue_paid_orders: false,
    formal_contingency_enabled: false,
    ...overrides,
  }
}

export function makePaidReconciliation(
  overrides: Partial<PaymentReconciliation> = {},
): PaymentReconciliation {
  return {
    is_fully_paid: true,
    order_status: "paid",
    order_total: 297,
    amount_paid: 297,
    balance_due: 0,
    ...overrides,
  }
}

export function makeCashActor(overrides: Partial<ActorProfile> = {}): ActorProfile {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    role: "caja",
    status: "active",
    ...overrides,
  }
}

export function makeStageEnv(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map<string, string>([
    ["SUPABASE_URL", "https://tgrqarxfmpwgrkntvgma.supabase.co"],
    ["FELPLEX_HTTP_ENABLED", "false"],
    ["FELPLEX_GT_STAGE_API_KEY", "fake-stage-key-not-real"],
    ...Object.entries(overrides),
  ])
}

export function envGetter(map: Map<string, string>) {
  return {
    get(key: string) {
      return map.get(key)
    },
  }
}
