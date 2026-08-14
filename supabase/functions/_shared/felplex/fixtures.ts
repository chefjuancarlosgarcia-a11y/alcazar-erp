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

export function makeNitDocument(overrides: Partial<FelDocumentRow> = {}): FelDocumentRow {
  return makeQ297Document({
    receiver_nit: "9001001-9",
    receiver_name: "Cliente Ficticio Stage",
    receiver_address: "1a Avenida Ficticia 10-20",
    receiver_email: "cliente.ficticio@stage-fel.test",
    ...overrides,
  })
}

export const SANITIZED_CERTIFY_SUCCESS_RESPONSE = {
  valid: true,
  uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
  sat: {
    serie: "A",
    no: 123,
    authorization: "AUTH-FIXTURE-0001",
    certification_date: "2026-08-08T20:00:00",
  },
  certifier: {
    name: "Certificador Ficticio",
    tax_code: "000000-0",
  },
  errors: [],
  error_codes: [],
  invoice_url: "https://felplex.stage.plex.lat/invoices/fixture.pdf",
  invoice_xml: "https://felplex.stage.plex.lat/invoices/fixture.xml",
} as const

export const SANITIZED_CERTIFY_FAILURE_RESPONSE = {
  valid: false,
  uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
  sat: {
    serie: null,
    no: "",
    authorization: null,
    certification_date: null,
  },
  errors: [["Documento rechazado por validacion ficticia."]],
  error_codes: ["FEL_CARI_FIXTURE"],
  invoice_url: null,
  invoice_xml: null,
} as const

export function makeHttpTestEnv(overrides: Record<string, string> = {}): Map<string, string> {
  return makeStageEnv({
    FELPLEX_HTTP_ENABLED: "true",
    FELPLEX_CONTRACT_HTTP_CONFIRMED: "true",
    ...overrides,
  })
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
