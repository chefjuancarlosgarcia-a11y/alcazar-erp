/**
 * Provisional Guatemala FACT contract notes.
 * Full HTTP remains blocked until Stage proof — see docs/felplex-guatemala-api-contract.md.
 */
export const FELPLEX_PROVISIONAL_DECISIONS = [
  "datetime_issue uses YYYY-MM-ddTHH:mm:ss (examples) not docs-only YYYY-MM-dd",
  "items[].type B for consolidated consumo de alimentos",
  "IVA included uses 12/112 with roundMoney residual",
  "CF receiver uses to_cf=1 with sanitized CF address",
  "external_id required from pos_fel_documents.external_id",
] as const

export const FELPLEX_PENDING_INCONSISTENCIES = [
  "external_id recommended but no GET-by-external_id endpoint documented",
  "datetime_issue format mismatch between docs and examples",
  "total_tax rounding not officially confirmed",
  "retryable HTTP codes undocumented — no auto retry on POST",
  "empresa and api_key not yet provisioned for Stage",
  "B/S fiscal rule per ERP product still provisional",
] as const

export const FELPLEX_STILL_BLOCKED_FOR_HTTP = [
  "FELPLEX_HTTP_ENABLED must remain false by default",
  "FELPLEX_CONTRACT_HTTP_CONFIRMED must remain false until Stage proof",
  "No FCAM/NCRE/NDEB/SMS/WhatsApp/XML base64 flows",
  "No DELETE anulacion execution",
  "No GET invoice execution",
] as const

/** @deprecated Use payload builder validation errors instead of blanket block list. */
export function listBlockedFieldsForSnapshot(_receiverNit: string): string[] {
  return [...FELPLEX_PENDING_INCONSISTENCIES]
}
