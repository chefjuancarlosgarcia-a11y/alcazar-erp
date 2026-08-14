export type FelEnvironment = "stage" | "production"

export type FelDocumentStatus =
  | "pending_certification"
  | "processing"
  | "certified"
  | "failed"
  | "cancelled"
  | "contingency_pending"
  | "contingency_certified"

export type FelAttemptOutcome = "pending" | "success" | "failed" | "skipped"

export type FelErrorClassification = "transient" | "permanent" | "blocked" | "ambiguous"

export interface FelDocumentRow {
  id: string
  order_id: string
  external_id: string
  environment: FelEnvironment
  status: FelDocumentStatus
  receiver_nit: string
  receiver_name: string
  receiver_address: string | null
  receiver_email: string | null
  fiscal_description: string
  gross_items_total: number
  discount_total: number
  tip_total: number
  taxable_gross_total: number
  taxable_base: number
  vat_rate: number
  vat_total: number
  invoice_total: number
  request_payload: unknown
  response_payload: unknown
  fel_uuid: string | null
  sat_authorization: string | null
  sat_series: string | null
  sat_document_number: string | null
  certified_at: string | null
  retry_count: number
  last_error: string | null
}

export interface FelEmissionConfigRow {
  id: number
  environment: FelEnvironment
  emission_enabled: boolean
  auto_issue_paid_orders: boolean
  formal_contingency_enabled: boolean
}

export interface BillingProviderConfigRow {
  id: string
  provider_code: string
  entity_id: string
  environment: FelEnvironment
  secret_env_var: string
  base_url: string | null
  is_active: boolean
  is_default: boolean
}

export interface ClaimCertificationResult {
  document_id: string
  attempt_id: string
  attempt_number: number
  status: "processing"
}

export interface FinalizeCertificationResult {
  document_id: string
  attempt_id: string
  status: "certified" | "failed"
  outcome: "success" | "failed"
}

export interface PaymentReconciliation {
  is_fully_paid: boolean
  order_status: string
  order_total: number
  amount_paid: number
  balance_due: number
}

export interface FelplexPayloadItem {
  qty: number
  type: "B" | "S"
  price: number
  description: string
  without_iva: number
  discount: number
  is_discount_percentage: number
  taxes: {
    quantity: null
    tax_code: null
    full_name: null
    short_name: null
    tax_amount: null
    taxable_amount: null
  }
}

export interface FelplexPayloadAddress {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

export interface FelplexPayloadReceiver {
  tax_code_type: "NIT"
  tax_code: string
  tax_name: string
  address: FelplexPayloadAddress
}

export interface FelplexPayloadCandidate {
  type: "FACT"
  currency: "GTQ"
  datetime_issue: string
  external_id: string
  items: FelplexPayloadItem[]
  total: number
  total_tax: number
  emails: string[]
  emails_cc: string[]
  to_cf?: number
  to?: FelplexPayloadReceiver
  exempt_phrase: null
  custom_fields: unknown[]
}

export type BuildPayloadResult =
  | { ok: true; payload: FelplexPayloadCandidate; provisional: true }
  | {
      ok: false
      code: "FELPLEX_CONTRACT_UNCONFIRMED" | "FELPLEX_PAYLOAD_INVALID"
      blockedFields: string[]
      candidate?: FelplexPayloadCandidate
    }

export interface CertifyInvoiceInput {
  document_id: string
}

export interface PublicCertifyResponse {
  document_id: string
  order_id?: string
  external_id?: string
  status: string
  idempotent: boolean
  message: string
  fel_uuid?: string
  sat_authorization?: string
  sat_series?: string
  sat_document_number?: string
  error_code?: string
  error_classification?: FelErrorClassification
}

export interface ActorProfile {
  id: string
  role: string
  status: string
}

export interface GateContext {
  projectRef: string | null
  supabaseUrl: string | null
  emissionConfig: FelEmissionConfigRow | null
  providerConfig: BillingProviderConfigRow | null
  document: FelDocumentRow | null
  reconciliation: PaymentReconciliation | null
  httpEnabled: boolean
  apiKeyPresent: boolean
  discountTotal: number
}

export interface GateFailure {
  code: string
  message: string
  classification: FelErrorClassification
}

export interface FelplexTransportRequest {
  url: string
  apiKey: string
  body: unknown
  timeoutMs: number
}

export type TransportErrorKind =
  | "timeout"
  | "network"
  | "http_4xx"
  | "http_5xx"
  | "malformed"
  | "blocked"

export interface FelplexTransportResult {
  ok: boolean
  httpStatus?: number
  body?: unknown
  errorKind?: TransportErrorKind
  sanitizedMessage: string
}

export interface FelplexTransport {
  send(request: FelplexTransportRequest): Promise<FelplexTransportResult>
}

export interface FelplexCertifyResponse {
  valid?: boolean
  uuid?: string
  sat?: {
    serie?: string | null
    no?: string | number | null
    authorization?: string | null
    certification_date?: string | null
  }
  certifier?: {
    name?: string
    tax_code?: string
  }
  errors?: unknown
  error_codes?: string[]
  invoice_url?: string | null
  invoice_xml?: string | null
}

export interface AttemptRecord {
  id: string
  fel_document_id: string
  attempt_number: number
  outcome: FelAttemptOutcome
  http_status: number | null
  error_code: string | null
  error_message: string | null
}
