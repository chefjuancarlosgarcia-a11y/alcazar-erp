import { sanitizeFelplexErrors } from "./sanitize.ts"
import type { FelplexCertifyResponse } from "./types.ts"

export interface AdaptedFelplexResult {
  success: boolean
  felUuid?: string
  satAuthorization?: string
  satSeries?: string
  satDocumentNumber?: string
  certifiedAt?: string
  publicMessage: string
  errorClassification: "transient" | "permanent"
  raw?: FelplexCertifyResponse
}

export function adaptFelplexResponse(body: unknown, httpStatus: number): AdaptedFelplexResult {
  if (!body || typeof body !== "object") {
    return {
      success: false,
      publicMessage: "Respuesta FELplex invalida.",
      errorClassification: httpStatus >= 500 ? "transient" : "permanent",
    }
  }

  const parsed = body as FelplexCertifyResponse
  if (parsed.valid !== true) {
    return {
      success: false,
      publicMessage: sanitizeFelplexErrors(parsed.errors),
      errorClassification: "permanent",
      raw: parsed,
    }
  }

  if (!parsed.uuid || !parsed.sat?.authorization) {
    return {
      success: false,
      publicMessage: "Respuesta FELplex incompleta.",
      errorClassification: "permanent",
      raw: parsed,
    }
  }

  return {
    success: true,
    felUuid: parsed.uuid,
    satAuthorization: parsed.sat.authorization,
    satSeries: parsed.sat.serie,
    satDocumentNumber: parsed.sat.no,
    certifiedAt: parsed.sat.certification_date,
    publicMessage: "Documento certificado.",
    errorClassification: "permanent",
    raw: parsed,
  }
}

export function classifyTransportFailure(
  errorKind: string | undefined,
): "transient" | "permanent" {
  if (errorKind === "timeout" || errorKind === "network" || errorKind === "http_5xx") {
    return "transient"
  }
  return "permanent"
}
