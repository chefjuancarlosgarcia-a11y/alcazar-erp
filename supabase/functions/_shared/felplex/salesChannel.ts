import type { GateFailure } from "./types.ts"

/** Schema: supabase/schema/046_pos_customers_sales_channels.sql check on pos_orders.sales_channel */
export const POS_ORDER_SALES_CHANNELS = [
  "dine_in",
  "takeout",
  "delivery",
  "online",
] as const

export type PosOrderSalesChannel = (typeof POS_ORDER_SALES_CHANNELS)[number]

/** POS FELplex pilot v1: single aggregated B line; no delivery fee split (B + S). */
export const FELPLEX_PILOT_V1_ALLOWED_SALES_CHANNELS: ReadonlySet<PosOrderSalesChannel> = new Set([
  "dine_in",
  "takeout",
])

export const FEL_SALES_CHANNEL_NOT_SUPPORTED = "FEL_SALES_CHANNEL_NOT_SUPPORTED" as const

const PUBLIC_MESSAGE =
  "Canal de venta no soportado para certificacion FEL en esta version."

/**
 * Reads only sales_channel from persisted order_snapshot JSON (no full snapshot in errors/logs).
 */
export function parseSalesChannelFromOrderSnapshot(orderSnapshot: unknown): string | null {
  if (orderSnapshot === null || orderSnapshot === undefined) return null
  if (typeof orderSnapshot !== "object" || Array.isArray(orderSnapshot)) return null

  const raw = (orderSnapshot as Record<string, unknown>).sales_channel
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "string") return null

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isKnownPosSalesChannel(value: string): value is PosOrderSalesChannel {
  return (POS_ORDER_SALES_CHANNELS as readonly string[]).includes(value)
}

export function evaluatePilotSalesChannelGate(salesChannel: string | null): GateFailure | null {
  if (salesChannel === null) {
    return {
      code: FEL_SALES_CHANNEL_NOT_SUPPORTED,
      message: PUBLIC_MESSAGE,
      classification: "blocked",
    }
  }

  if (!isKnownPosSalesChannel(salesChannel)) {
    return {
      code: FEL_SALES_CHANNEL_NOT_SUPPORTED,
      message: PUBLIC_MESSAGE,
      classification: "blocked",
    }
  }

  if (!FELPLEX_PILOT_V1_ALLOWED_SALES_CHANNELS.has(salesChannel)) {
    return {
      code: FEL_SALES_CHANNEL_NOT_SUPPORTED,
      message: PUBLIC_MESSAGE,
      classification: "blocked",
    }
  }

  return null
}
