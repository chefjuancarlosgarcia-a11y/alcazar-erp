import {
  FELPLEX_SECRET_ENV_STAGE,
  FELPLEX_STAGE_PROJECT_REF,
} from "./constants.ts"
import { isAmbiguousTransportOutcome } from "./ambiguousOutcome.ts"
import { assertCashOperator } from "./auth.ts"
import { isFelplexContractHttpConfirmed, felplexContractHttpBlockedFailure } from "./contractHttp.ts"
import { evaluateCertificationGates, extractProjectRef } from "./gates.ts"
import { buildFelplexPayload } from "./payloadBuilder.ts"
import type { FelRepository } from "./repository.ts"
import { ClaimError } from "./repository.ts"
import { adaptFelplexResponse, classifyTransportFailure } from "./responseAdapter.ts"
import { resolvePublicRpcError, GENERIC_INTERNAL_ERROR } from "./rpcErrors.ts"
import {
  buildSafeProviderResponsePayload,
  buildSafeSuccessPayload,
} from "./safePayload.ts"
import { sanitizePublicMessage } from "./sanitize.ts"
import { buildFelplexCertifyUrl, defaultTransportRequest } from "./transport.ts"
import { isValidUuid } from "./validation.ts"
import type {
  ActorProfile,
  BuildPayloadResult,
  CertifyInvoiceInput,
  FinalizeCertificationResult,
  FelplexTransport,
  PublicCertifyResponse,
} from "./types.ts"

export interface CertifyServiceDeps {
  repository: FelRepository
  transport: FelplexTransport
  env: Pick<typeof Deno.env, "get">
  nowIso: string
  actor: ActorProfile | null
  includeCandidatePayload?: boolean
  transportCallCounter?: { count: number }
  /** Test-only injection to bypass contract block without changing production builder. */
  buildPayloadOverride?: (
    document: Parameters<typeof buildFelplexPayload>[0],
    options: Parameters<typeof buildFelplexPayload>[1],
  ) => BuildPayloadResult
}

export async function certifyInvoice(
  input: CertifyInvoiceInput,
  deps: CertifyServiceDeps,
): Promise<{ status: number; body: PublicCertifyResponse }> {
  const authError = assertCashOperator(deps.actor)
  if (authError) {
    return publicError(input.document_id, authError, "No autorizado para certificar.", 403, "blocked")
  }

  const documentId = String(input.document_id || "").trim()
  if (!documentId) {
    return publicError("", "FEL_INVALID_INPUT", "Debes indicar document_id.", 400, "blocked")
  }

  if (!isValidUuid(documentId)) {
    return publicError(documentId, "FEL_INVALID_INPUT", "document_id invalido.", 400, "blocked")
  }

  const emissionConfig = await deps.repository.getEmissionConfig()
  const document = await deps.repository.getDocument(documentId)
  const providerConfig = await deps.repository.getProviderConfig("stage")
  const reconciliation = document
    ? await deps.repository.getPaymentReconciliation(document.order_id)
    : null

  const apiKey = deps.env.get(FELPLEX_SECRET_ENV_STAGE) ?? ""
  const gateFailure = evaluateCertificationGates({
    projectRef: extractProjectRef(deps.env.get("SUPABASE_URL") ?? null),
    supabaseUrl: deps.env.get("SUPABASE_URL") ?? null,
    emissionConfig,
    providerConfig,
    document,
    reconciliation,
    httpEnabled: parseTruthy(deps.env.get("FELPLEX_HTTP_ENABLED")),
    apiKeyPresent: apiKey.length > 0,
    discountTotal: document?.discount_total ?? 0,
  })

  if (gateFailure) {
    return publicError(
      documentId,
      gateFailure.code,
      gateFailure.message,
      gateFailure.code === "FEL_UNAUTHORIZED" ? 403 : 409,
      gateFailure.classification,
    )
  }

  const activeDocument = document!
  const provider = providerConfig!

  if (activeDocument.status === "certified") {
    return {
      status: 200,
      body: {
        document_id: activeDocument.id,
        order_id: activeDocument.order_id,
        external_id: activeDocument.external_id,
        status: activeDocument.status,
        idempotent: true,
        message: "Documento ya certificado.",
        fel_uuid: activeDocument.fel_uuid ?? undefined,
        sat_authorization: activeDocument.sat_authorization ?? undefined,
        sat_series: activeDocument.sat_series ?? undefined,
        sat_document_number: activeDocument.sat_document_number ?? undefined,
      },
    }
  }

  const buildPayload = deps.buildPayloadOverride ?? buildFelplexPayload
  const buildResult = buildPayload(activeDocument, {
    datetimeIssue: deps.nowIso,
    includeCandidate: deps.includeCandidatePayload === true,
  })

  if (!buildResult.ok) {
    return publicError(
      activeDocument.id,
      buildResult.code,
      buildResult.code === "FELPLEX_PAYLOAD_INVALID"
        ? "Payload FELplex invalido."
        : "Contrato FELplex pendiente de confirmacion.",
      422,
      "blocked",
    )
  }

  if (!isFelplexContractHttpConfirmed(deps.env)) {
    const blocked = felplexContractHttpBlockedFailure()
    return publicError(
      activeDocument.id,
      blocked.code,
      blocked.message,
      422,
      blocked.classification,
    )
  }

  let claim
  try {
    claim = await deps.repository.claimCertificationAttempt(activeDocument.id, deps.actor!.id)
  } catch (error) {
    if (error instanceof ClaimError) {
      const resolved = resolvePublicRpcError(error.code)
      if (!resolved.isKnown) {
        return publicError(activeDocument.id, resolved.code, resolved.message, 500, "blocked")
      }
      return publicError(
        activeDocument.id,
        resolved.code,
        resolved.message,
        resolved.httpStatus,
        resolved.classification,
      )
    }
    throw error
  }

  if (!claim) {
    return publicError(
      activeDocument.id,
      "FEL_CLAIM_FAILED",
      "No fue posible iniciar la certificacion.",
      409,
      "blocked",
    )
  }

  const urlResult = buildFelplexCertifyUrl(provider.base_url, provider.entity_id)
  if ("code" in urlResult) {
    const confirmed = await failAttempt(deps, claim, buildResult.payload, {
      errorCode: urlResult.code,
      errorMessage: urlResult.message,
      safeResponsePayload: buildSafeProviderResponsePayload({
        errorKind: "blocked",
        safeCode: urlResult.code,
        safeMessage: urlResult.message,
      }),
    })
    if (!confirmed) return uncertainOutcome(activeDocument.id)
    return publicError(activeDocument.id, urlResult.code, urlResult.message, 422, "blocked")
  }

  const transportRequest = defaultTransportRequest(urlResult.url, apiKey, buildResult.payload)

  if (deps.transportCallCounter) deps.transportCallCounter.count += 1
  const transportResult = await deps.transport.send(transportRequest)

  if (!transportResult.ok) {
    if (isAmbiguousTransportOutcome(transportResult.errorKind)) {
      return uncertainOutcome(activeDocument.id)
    }

    const classification = classifyTransportFailure(transportResult.errorKind)
    const safePayload = buildSafeProviderResponsePayload({
      httpStatus: transportResult.httpStatus ?? null,
      errorKind: transportResult.errorKind ?? "transport_error",
      providerValid: false,
      safeCode: transportResult.errorKind ?? "transport_error",
      safeMessage: transportResult.sanitizedMessage,
    })

    const confirmed = await failAttempt(deps, claim, buildResult.payload, {
      httpStatus: transportResult.httpStatus ?? null,
      errorCode: transportResult.errorKind ?? "FEL_TRANSPORT_ERROR",
      errorMessage: transportResult.sanitizedMessage,
      safeResponsePayload: safePayload,
    })
    if (!confirmed) return uncertainOutcome(activeDocument.id)

    return publicError(
      activeDocument.id,
      transportResult.errorKind ?? "FEL_TRANSPORT_ERROR",
      transportResult.sanitizedMessage,
      classification === "transient" ? 503 : 422,
      classification,
    )
  }

  const adapted = adaptFelplexResponse(transportResult.body, transportResult.httpStatus ?? 200)
  if (!adapted.success) {
    const safePayload = buildSafeProviderResponsePayload({
      httpStatus: transportResult.httpStatus ?? null,
      errorKind: "provider_invalid",
      providerValid: false,
      safeCode: "FELPLEX_INVALID_RESPONSE",
      safeMessage: adapted.publicMessage,
    })

    const confirmed = await failAttempt(deps, claim, buildResult.payload, {
      httpStatus: transportResult.httpStatus ?? null,
      errorCode: "FELPLEX_INVALID_RESPONSE",
      errorMessage: adapted.publicMessage,
      safeResponsePayload: safePayload,
    })
    if (!confirmed) return uncertainOutcome(activeDocument.id)

    return publicError(
      activeDocument.id,
      "FELPLEX_INVALID_RESPONSE",
      adapted.publicMessage,
      422,
      adapted.errorClassification,
    )
  }

  let finalized: FinalizeCertificationResult | null
  try {
    finalized = await deps.repository.finalizeCertificationAttempt({
      documentId: activeDocument.id,
      attemptId: claim.attempt_id,
      outcome: "success",
      felUuid: adapted.felUuid,
      satAuthorization: adapted.satAuthorization,
      satSeries: adapted.satSeries,
      satDocumentNumber: adapted.satDocumentNumber,
      certifiedAt: adapted.certifiedAt ?? deps.nowIso,
      httpStatus: transportResult.httpStatus ?? 200,
      safeResponsePayload: buildSafeSuccessPayload({
        httpStatus: transportResult.httpStatus ?? 200,
        felUuid: adapted.felUuid!,
        satAuthorization: adapted.satAuthorization!,
      }),
      requestPayload: buildResult.payload,
    })
  } catch {
    return uncertainOutcome(activeDocument.id)
  }

  if (!isConfirmedFinalize(finalized, claim, "certified", "success")) {
    return uncertainOutcome(activeDocument.id)
  }

  return {
    status: 200,
    body: {
      document_id: activeDocument.id,
      order_id: activeDocument.order_id,
      external_id: activeDocument.external_id,
      status: finalized!.status,
      idempotent: false,
      message: adapted.publicMessage,
      fel_uuid: adapted.felUuid,
      sat_authorization: adapted.satAuthorization,
      sat_series: adapted.satSeries,
      sat_document_number: adapted.satDocumentNumber,
    },
  }
}

async function failAttempt(
  deps: CertifyServiceDeps,
  claim: { document_id: string; attempt_id: string },
  requestPayload: unknown,
  input: {
    httpStatus?: number | null
    errorCode: string
    errorMessage: string
    safeResponsePayload: ReturnType<typeof buildSafeProviderResponsePayload>
  },
): Promise<boolean> {
  try {
    const finalized = await deps.repository.finalizeCertificationAttempt({
      documentId: claim.document_id,
      attemptId: claim.attempt_id,
      outcome: "failed",
      httpStatus: input.httpStatus ?? null,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      safeResponsePayload: input.safeResponsePayload,
      requestPayload,
    })
    return isConfirmedFinalize(finalized, claim, "failed", "failed")
  } catch {
    return false
  }
}

function isConfirmedFinalize(
  finalized: FinalizeCertificationResult | null,
  claim: { document_id: string; attempt_id: string },
  status: FinalizeCertificationResult["status"],
  outcome: FinalizeCertificationResult["outcome"],
): boolean {
  return !!finalized &&
    finalized.document_id === claim.document_id &&
    finalized.attempt_id === claim.attempt_id &&
    finalized.status === status &&
    finalized.outcome === outcome
}

function uncertainOutcome(documentId: string): { status: number; body: PublicCertifyResponse } {
  return publicError(
    documentId,
    "FEL_UNCERTAIN_OUTCOME",
    "Certificacion incierta. Requiere reconciliacion manual con FELplex antes de reintentar.",
    500,
    "blocked",
  )
}

function parseTruthy(raw: string | undefined): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

function publicError(
  documentId: string,
  code: string,
  message: string,
  status: number,
  classification: PublicCertifyResponse["error_classification"],
): { status: number; body: PublicCertifyResponse } {
  return {
    status,
    body: {
      document_id: documentId,
      status: "blocked",
      idempotent: false,
      message: sanitizePublicMessage(message),
      error_code: code,
      error_classification: classification,
    },
  }
}

export function isStageProjectRef(projectRef: string | null | undefined): boolean {
  return projectRef === FELPLEX_STAGE_PROJECT_REF
}

export { GENERIC_INTERNAL_ERROR } from "./rpcErrors.ts"
