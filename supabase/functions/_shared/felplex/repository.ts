import type {
  ClaimCertificationResult,
  FelDocumentRow,
  FinalizeCertificationResult,
  BillingProviderConfigRow,
  FelEmissionConfigRow,
  PaymentReconciliation,
} from "./types.ts"
import type { SafeProviderResponsePayload } from "./safePayload.ts"

export interface FelRepository {
  getDocument(documentId: string): Promise<FelDocumentRow | null>
  getEmissionConfig(): Promise<FelEmissionConfigRow | null>
  getProviderConfig(environment: "stage"): Promise<BillingProviderConfigRow | null>
  getPaymentReconciliation(orderId: string): Promise<PaymentReconciliation | null>
  claimCertificationAttempt(
    documentId: string,
    actorId: string,
  ): Promise<ClaimCertificationResult | null>
  finalizeCertificationAttempt(input: {
    documentId: string
    attemptId: string
    outcome: "success" | "failed"
    felUuid?: string | null
    satAuthorization?: string | null
    satSeries?: string | null
    satDocumentNumber?: string | null
    certifiedAt?: string | null
    httpStatus?: number | null
    errorCode?: string | null
    errorMessage?: string | null
    safeResponsePayload?: SafeProviderResponsePayload | null
    requestPayload?: unknown
  }): Promise<FinalizeCertificationResult | null>
}

export class ClaimError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ClaimError"
  }
}

export class FinalizeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "FinalizeError"
  }
}

export class InMemoryFelRepository implements FelRepository {
  documents = new Map<string, FelDocumentRow>()
  emissionConfig: FelEmissionConfigRow | null = null
  /** When set, claim RPC gate reads this instead of emissionConfig. */
  claimEmissionConfigOverride: FelEmissionConfigRow | null | undefined = undefined
  providerConfig: BillingProviderConfigRow | null = null
  reconciliations = new Map<string, PaymentReconciliation>()
  claims: ClaimCertificationResult[] = []
  finalizations: Array<Parameters<FelRepository["finalizeCertificationAttempt"]>[0]> = []
  persistedSafePayloads: unknown[] = []
  claimMutex = Promise.resolve()
  finalizeBehavior: "ok" | "null" | "throw" | "incongruent" = "ok"
  claimBehavior: "ok" | "null" | "throw" = "ok"
  staleFinalizeAttemptId: string | null = null

  private emissionConfigForClaim(): FelEmissionConfigRow | null {
    if (this.claimEmissionConfigOverride !== undefined) {
      return this.claimEmissionConfigOverride
    }
    return this.emissionConfig
  }

  private assertClaimEmissionConfig(): void {
    const cfg = this.emissionConfigForClaim()
    if (!cfg) throw new ClaimError("FEL_EMISSION_DISABLED", "Configuracion FEL ausente.")
    if (cfg.environment !== "stage") {
      throw new ClaimError("FEL_ENVIRONMENT_NOT_STAGE", "Ambiente FEL distinto de stage.")
    }
    if (!cfg.emission_enabled) {
      throw new ClaimError("FEL_EMISSION_DISABLED", "Emision FEL deshabilitada.")
    }
    if (cfg.formal_contingency_enabled) {
      throw new ClaimError("FEL_CONTINGENCY_NOT_SUPPORTED", "Contingencia formal no habilitada.")
    }
  }

  async getDocument(documentId: string) {
    return this.documents.get(documentId) ?? null
  }

  async getEmissionConfig() {
    return this.emissionConfig
  }

  async getProviderConfig(_environment: "stage") {
    return this.providerConfig
  }

  async getPaymentReconciliation(orderId: string) {
    return this.reconciliations.get(orderId) ?? null
  }

  async claimCertificationAttempt(documentId: string, actorId: string) {
    if (this.claimBehavior === "throw") {
      throw new ClaimError("FEL_CLAIM_FAILED", "Claim fallo en prueba.")
    }

    let result: ClaimCertificationResult | null = null

    await (this.claimMutex = this.claimMutex.then(async () => {
      if (this.claimBehavior === "null") {
        result = null
        return
      }

      this.assertClaimEmissionConfig()

      const current = this.documents.get(documentId)
      if (!current) throw new ClaimError("FEL_DOCUMENT_NOT_FOUND", "Documento no encontrado.")
      if (current.status === "processing") {
        throw new ClaimError("FEL_ALREADY_PROCESSING", "Certificacion en curso.")
      }
      if (!["pending_certification", "failed"].includes(current.status)) {
        throw new ClaimError("FEL_DOCUMENT_NOT_CERTIFIABLE", "Estado no certificable.")
      }

      const reconciliation = this.reconciliations.get(current.order_id)
      if (!reconciliation || reconciliation.order_status !== "paid") {
        throw new ClaimError("FEL_ORDER_NOT_PAID", "Orden no pagada.")
      }

      const attemptNumber = this.claims.filter((claim) => claim.document_id === documentId).length + 1
      const attemptId = crypto.randomUUID()
      result = {
        document_id: documentId,
        attempt_id: attemptId,
        attempt_number: attemptNumber,
        status: "processing",
      }
      this.claims.push(result)
      this.documents.set(documentId, {
        ...current,
        status: "processing",
      })
      void actorId
    }))

    return result
  }

  async finalizeCertificationAttempt(input: Parameters<FelRepository["finalizeCertificationAttempt"]>[0]) {
    if (this.finalizeBehavior === "throw") {
      throw new FinalizeError("FEL_FINALIZE_FAILED", "Finalize fallo en prueba.")
    }
    if (this.finalizeBehavior === "null") {
      return null
    }

    if (this.staleFinalizeAttemptId && input.attemptId === this.staleFinalizeAttemptId) {
      throw new FinalizeError("FEL_FINALIZE_STALE", "Intento ya finalizado.")
    }

    const current = this.documents.get(input.documentId)
    if (!current) return null
    if (current.status === "certified") {
      throw new FinalizeError("FEL_ALREADY_CERTIFIED", "Documento ya certificado.")
    }
    if (current.status !== "processing") return null

    this.finalizations.push(input)
    if (input.safeResponsePayload) {
      this.persistedSafePayloads.push(input.safeResponsePayload)
    }

    if (this.finalizeBehavior === "incongruent") {
      return {
        document_id: input.documentId,
        attempt_id: "00000000-0000-4000-8000-000000000099",
        status: input.outcome === "success" ? "certified" as const : "failed" as const,
        outcome: input.outcome,
      }
    }

    if (input.outcome === "success") {
      const updated: FelDocumentRow = {
        ...current,
        status: "certified",
        fel_uuid: input.felUuid ?? null,
        sat_authorization: input.satAuthorization ?? null,
        sat_series: input.satSeries ?? null,
        sat_document_number: input.satDocumentNumber ?? null,
        certified_at: input.certifiedAt ?? new Date().toISOString(),
        last_error: null,
      }
      this.documents.set(input.documentId, updated)
      return {
        document_id: input.documentId,
        attempt_id: input.attemptId,
        status: "certified" as const,
        outcome: "success" as const,
      }
    }

    const updated: FelDocumentRow = {
      ...current,
      status: "failed",
      retry_count: current.retry_count + 1,
      last_error: input.errorMessage ?? "Error de certificacion.",
    }
    this.documents.set(input.documentId, updated)
    return {
      document_id: input.documentId,
      attempt_id: input.attemptId,
      status: "failed" as const,
      outcome: "failed" as const,
    }
  }
}
