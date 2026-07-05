export type BillingDocumentStatus =
  | "draft"
  | "pending_certification"
  | "certified"
  | "rejected"
  | "void_pending"
  | "voided"
  | "void_failed"

export type CanonicalDocumentType =
  | "invoice"
  | "credit_note"
  | "debit_note"
  | "receipt"
  | "donation_receipt"
  | "special_invoice"

export type TaxIdType = "NIT" | "DPI" | "EXT" | "CF"

export interface CanonicalAddress {
  street?: string
  city?: string
  state?: string
  zip?: string
  country?: string
}

export interface CanonicalBuyer {
  isFinalConsumer: boolean
  taxIdType: TaxIdType
  taxId: string
  name: string
  email?: string
  phone?: string
  address?: CanonicalAddress
}

export interface CanonicalLine {
  lineNumber: number
  description: string
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
  itemType: "goods" | "service"
  taxExempt: boolean
  taxes?: Record<string, unknown>
  sourceLineRef?: { type: string; id: string }
}

export interface CanonicalInvoice {
  documentType: CanonicalDocumentType
  currency: "GTQ" | "USD"
  issuedAt: string
  externalId: string
  buyer: CanonicalBuyer
  lines: CanonicalLine[]
  totals: {
    subtotal: number
    tax: number
    discount: number
    total: number
  }
  metadata?: Record<string, unknown>
}

/** Normalized certification outcome — no FELplex-specific fields. */
export interface CertificationResult {
  valid: boolean
  certificationAuthorization?: string
  certificationSeries?: string
  certificationNumber?: string
  certifiedAt?: string
  documentUrl?: string
  documentXmlUrl?: string
  errors?: string[]
  errorCodes?: string[]
  durationMs?: number
}

/** Provider-isolated reference returned by adapters. */
export interface ProviderDocumentRef {
  providerReferenceId: string
  providerDocumentType?: string
  providerResponse?: Record<string, unknown>
}

export interface TestConnectionResult {
  ok: boolean
  credits?: number
  durationMs: number
  errorCodes?: string[]
  errorMessages?: string[]
  errorSummary?: string
  providerResponse?: Record<string, unknown>
}

export interface ProviderConfigRow {
  id: string
  legal_entity_id: string
  provider_code: string
  environment: string
  entity_id: string
  vault_secret_name: string
  base_url: string | null
  adapter_version: string
  adapter_key: string
  provider_name: string
}

export interface RecordAttemptPayload {
  document_id?: string | null
  provider_config_id: string
  legal_entity_id: string
  provider_code: string
  adapter_version: string
  operation: "issue" | "void" | "lookup" | "test_connection" | "credits_check"
  status: "pending" | "success" | "failed" | "skipped"
  request_payload?: Record<string, unknown>
  response_payload?: Record<string, unknown>
  error_codes?: string[]
  error_messages?: string[] | Record<string, unknown>[]
  error_summary?: string
  http_status?: number
  duration_ms?: number
  credits?: number
  created_by?: string | null
}
