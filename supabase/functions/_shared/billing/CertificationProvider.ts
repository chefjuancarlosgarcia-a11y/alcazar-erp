import type {
  CanonicalInvoice,
  CertificationResult,
  ProviderConfigRow,
  ProviderDocumentRef,
  TestConnectionResult
} from "./types.ts"

export interface CertificationProvider {
  readonly providerCode: string
  readonly countryCode: string
  readonly adapterVersion: string

  testConnection(): Promise<TestConnectionResult>

  /** Phase 2+ */
  issue?(invoice: CanonicalInvoice): Promise<CertificationResult & ProviderDocumentRef>
}

export function mapCertificationToCanonical(
  result: CertificationResult,
  providerRef?: ProviderDocumentRef
) {
  return {
    certification_authorization: result.certificationAuthorization ?? null,
    certification_series: result.certificationSeries ?? null,
    certification_number: result.certificationNumber ?? null,
    certified_at: result.certifiedAt ?? null,
    document_url: result.documentUrl ?? null,
    document_xml_url: result.documentXmlUrl ?? null,
    provider_reference_id: providerRef?.providerReferenceId ?? null,
    provider_document_type: providerRef?.providerDocumentType ?? null,
    provider_response: providerRef?.providerResponse ?? {}
  }
}

export type ProviderFactoryContext = {
  config: ProviderConfigRow
  apiKey: string
}

export type ProviderFactory = (ctx: ProviderFactoryContext) => CertificationProvider
