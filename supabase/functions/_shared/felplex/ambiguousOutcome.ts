import type { TransportErrorKind } from "./types.ts"

/** POST /invoices/await must never be auto-retried after timeout. */
export function isAmbiguousTransportOutcome(errorKind: TransportErrorKind | undefined): boolean {
  return errorKind === "timeout"
}

export const FELPLEX_AMBIGUOUS_OUTCOME_CODE = "FEL_UNCERTAIN_OUTCOME" as const

export const FELPLEX_AMBIGUOUS_OUTCOME_MESSAGE =
  "Certificacion incierta. Requiere reconciliacion manual con FELplex antes de reintentar."
