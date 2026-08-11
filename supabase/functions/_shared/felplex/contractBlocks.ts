/**
 * Contractual blockers confirmed in docs/felplex-phase-0-decisions.md §20.
 * Phase 1A must not populate these for real transport.
 */
export const FELPLEX_BLOCKED_FIELDS = [
  "items[].type (B|S for consolidated Consumo de Alimentos)",
  "items[].without_iva (IVA-included menu pricing)",
  "items[].taxes structure",
  "to_cf exact semantics for CF Guatemala",
  "to presence/absence for CF Guatemala",
  "to.address minimum required fields",
  "total_tax numeric representation",
  "qty string format",
  "external_id max length/format",
  "datetime_issue timezone policy",
  "exempt_phrase when applicable",
  "unit of measure for consolidated line",
] as const

export function listBlockedFieldsForSnapshot(receiverNit: string): string[] {
  const blocked: string[] = [...FELPLEX_BLOCKED_FIELDS]
  if (receiverNit === "CF") {
    blocked.push("CF Guatemala receiver payload (to_cf/to)")
  } else {
    blocked.push("NIT receiver address minimum (to.address)")
  }
  return blocked
}
