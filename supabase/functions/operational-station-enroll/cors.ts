/** OS1 enrollment Edge — browser-only callers; strict allowlist (no fallback origin). */

export function parseEnrollOrigins(envValue: string | undefined): string[] {
  return (envValue || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export type CorsDecision =
  | { ok: true; origin: string }
  | { ok: false; reason: "missing_origin" | "origin_not_allowed" | "empty_allowlist" }

/** Exact match against OPERATIONAL_STATION_ENROLL_ORIGINS; never substitutes another entry. */
export function evaluateCors(origin: string | null, allowlist: string[]): CorsDecision {
  if (allowlist.length === 0) return { ok: false, reason: "empty_allowlist" }
  if (!origin) return { ok: false, reason: "missing_origin" }
  if (!allowlist.includes(origin)) return { ok: false, reason: "origin_not_allowed" }
  return { ok: true, origin }
}

export function corsHeadersForAllowedOrigin(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  }
}

/** Invalid or missing Origin — no Access-Control-Allow-Origin (browser blocks cross-origin read). */
export function corsForbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: "Origen no permitido." }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      Vary: "Origin"
    }
  })
}

export function corsOptionsResponse(allowedOrigin: string): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersForAllowedOrigin(allowedOrigin)
  })
}
