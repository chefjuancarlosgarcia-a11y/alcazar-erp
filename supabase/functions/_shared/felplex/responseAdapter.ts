import { parseFelplexCertifyResponse } from "./responseParser.ts"
import type { FelplexCertifyResponse } from "./types.ts"

export interface AdaptedFelplexResult {
  success: boolean
  felUuid?: string
  satAuthorization?: string
  satSeries?: string
  satDocumentNumber?: string
  certifiedAt?: string
  publicMessage: string
  errorClassification: "transient" | "permanent" | "ambiguous"
  errorCodes?: string[]
  raw?: FelplexCertifyResponse
}

export function adaptFelplexResponse(body: unknown, httpStatus: number): AdaptedFelplexResult {
  const parsed = parseFelplexCertifyResponse(body, httpStatus)

  if (!parsed.ok) {
    return {
      success: false,
      publicMessage: parsed.message,
      errorClassification: parsed.kind === "functional_failure" ? "permanent" : "permanent",
      errorCodes: parsed.functional?.errorCodes,
      raw: parsed.raw,
    }
  }

  return {
    success: true,
    felUuid: parsed.data.felUuid,
    satAuthorization: parsed.data.satAuthorization,
    satSeries: parsed.data.satSeries,
    satDocumentNumber: parsed.data.satDocumentNumber,
    certifiedAt: parsed.data.certifiedAt,
    publicMessage: "Documento certificado.",
    errorClassification: "permanent",
    raw: parsed.raw,
  }
}

export function classifyTransportFailure(
  errorKind: string | undefined,
): "transient" | "permanent" | "ambiguous" {
  if (errorKind === "timeout") {
    return "ambiguous"
  }
  if (errorKind === "network" || errorKind === "http_5xx") {
    return "transient"
  }
  return "permanent"
}
