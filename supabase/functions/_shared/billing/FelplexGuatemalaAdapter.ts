import { BillingError } from "./errors.ts"
import type { CertificationProvider, ProviderFactoryContext } from "./CertificationProvider.ts"
import type { TestConnectionResult } from "./types.ts"

const DEFAULT_BASE_URLS: Record<string, string> = {
  stage: "https://felplex.stage.plex.lat",
  production: "https://app.felplex.com"
}

export class FelplexGuatemalaAdapter implements CertificationProvider {
  readonly providerCode = "felplex_gt"
  readonly countryCode = "GT"
  readonly adapterVersion: string

  private readonly baseUrl: string
  private readonly entityId: string
  private readonly apiKey: string

  constructor(ctx: ProviderFactoryContext) {
    this.adapterVersion = ctx.config.adapter_version || "1.0.0"
    this.entityId = ctx.config.entity_id
    this.apiKey = ctx.apiKey
    this.baseUrl = (ctx.config.base_url || DEFAULT_BASE_URLS[ctx.config.environment] || DEFAULT_BASE_URLS.stage).replace(/\/$/, "")

    if (!this.entityId) {
      throw new BillingError("entity_id de FELplex no configurado.", "BILLING_CONFIG")
    }
    if (!this.apiKey) {
      throw new BillingError("API Key no disponible en Vault.", "BILLING_SECRET")
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const started = Date.now()
    const url = `${this.baseUrl}/api/entity/${this.entityId}/credits`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Authorization": this.apiKey
      }
    })

    const durationMs = Date.now() - started
    const bodyText = await response.text()
    let body: unknown = null

    try {
      body = bodyText ? JSON.parse(bodyText) : null
    } catch {
      body = { raw: bodyText }
    }

    if (!response.ok) {
      return {
        ok: false,
        durationMs,
        errorCodes: ["BILLING_HTTP"],
        errorMessages: [`HTTP ${response.status}`],
        errorSummary: `Conexion fallida (${response.status}).`,
        providerResponse: { httpStatus: response.status, body }
      }
    }

    const credits = parseCredits(body)

    return {
      ok: true,
      credits,
      durationMs,
      providerResponse: {
        httpStatus: response.status,
        credits,
        body
      }
    }
  }
}

function parseCredits(body: unknown): number | undefined {
  if (typeof body === "number" && Number.isFinite(body)) return body
  if (typeof body === "string" && body.trim() && !Number.isNaN(Number(body))) {
    return Number(body)
  }
  if (body && typeof body === "object" && "credits" in body) {
    const value = (body as { credits?: unknown }).credits
    if (typeof value === "number") return value
  }
  return undefined
}

export function createFelplexGuatemalaAdapter(ctx: ProviderFactoryContext): CertificationProvider {
  return new FelplexGuatemalaAdapter(ctx)
}
