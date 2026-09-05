import { createFelplexGuatemalaAdapter } from "./FelplexGuatemalaAdapter.ts"
import { resolveBillingApiKey } from "./secrets.ts"
import type { CertificationProvider, ProviderFactory } from "./CertificationProvider.ts"
import type { ProviderConfigRow, RecordAttemptPayload, TestConnectionResult } from "./types.ts"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

const ADAPTER_REGISTRY: Record<string, ProviderFactory> = {
  "felplex-guatemala": createFelplexGuatemalaAdapter
}

export class BillingService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly apiKey: string
  ) {}

  static fromProviderConfig(
    supabase: SupabaseClient,
    config: ProviderConfigRow
  ): BillingService {
    const apiKey = resolveBillingApiKey(config)
    return new BillingService(supabase, apiKey)
  }

  resolveProvider(config: ProviderConfigRow): CertificationProvider {
    const factory = ADAPTER_REGISTRY[config.adapter_key]
    if (!factory) {
      throw new Error(`Adapter no registrado: ${config.adapter_key}`)
    }
    return factory({ config, apiKey: this.apiKey })
  }

  async testConnection(config: ProviderConfigRow, createdBy?: string | null): Promise<TestConnectionResult> {
    const provider = this.resolveProvider(config)
    const result = await provider.testConnection()

    await this.recordAttempt({
      provider_config_id: config.id,
      legal_entity_id: config.legal_entity_id,
      provider_code: config.provider_code,
      adapter_version: provider.adapterVersion,
      operation: "test_connection",
      status: result.ok ? "success" : "failed",
      request_payload: {
        operation: "test_connection",
        provider_code: config.provider_code,
        environment: config.environment,
        entity_id: config.entity_id
      },
      response_payload: result.providerResponse || {},
      error_codes: result.errorCodes || [],
      error_messages: result.errorMessages || [],
      error_summary: result.errorSummary,
      duration_ms: result.durationMs,
      credits: result.credits,
      created_by: createdBy || null
    })

    return result
  }

  private async recordAttempt(payload: RecordAttemptPayload): Promise<void> {
    const { error } = await this.supabase.rpc("record_billing_certification_attempt", {
      p_payload: payload
    })
    if (error) {
      console.error("[BillingService] record attempt failed", error.message)
    }
  }
}
