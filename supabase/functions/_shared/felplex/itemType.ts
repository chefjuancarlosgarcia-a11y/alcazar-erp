import type { FelDocumentRow } from "./types.ts"

export type FelplexItemType = "B" | "S"

/**
 * Explicit provisional mapping — no silent fiscal inference beyond documented rules.
 * B = bienes; S = servicios (not enabled for ERP lines yet).
 */
export function resolveFelplexItemType(document: FelDocumentRow): FelplexItemType | null {
  const description = document.fiscal_description.trim().toLowerCase()

  if (
    description.includes("consumo de alimentos") ||
    description.includes("consumo alimentos") ||
    description === "consumo de alimentos"
  ) {
    return "B"
  }

  return null
}

export const FELPLEX_ITEM_TYPE_RULE_PROVISIONAL = true as const
