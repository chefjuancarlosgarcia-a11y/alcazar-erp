import type { FelDocumentRow } from "./types.ts"

export type FelplexItemType = "B" | "S"

/**
 * Pilot v1: single aggregated line for allowlisted dine_in/takeout only (see salesChannel.ts).
 * B = bienes (consumo alimentos). S = servicios (envío) — not emitted until multi-item phase.
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
