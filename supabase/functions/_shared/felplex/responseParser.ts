import { FELPLEX_STAGE_HOST } from "./constants.ts"
import { sanitizeFelplexErrors } from "./sanitize.ts"
import { validateFelplexStageUrl } from "./urlAllowlist.ts"
import type { FelplexCertifyResponse } from "./types.ts"

export type FelplexParsedCertification = {
  felUuid: string
  satSeries: string
  satDocumentNumber: string
  satAuthorization: string
  certifiedAt: string
  invoiceUrl?: string
  invoiceXml?: string
  certifierName?: string
  certifierTaxCode?: string
}

export type FelplexFunctionalFailure = {
  felUuid?: string
  errorCodes: string[]
  publicMessage: string
}

export type ParseFelplexResponseResult =
  | { ok: true; kind: "certified"; data: FelplexParsedCertification; raw: FelplexCertifyResponse }
  | { ok: false; kind: "malformed" | "incomplete" | "functional_failure" | "unsafe_url"; message: string; raw?: FelplexCertifyResponse; functional?: FelplexFunctionalFailure }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSatDocumentNumber(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }
  return null
}

export function extractFelplexErrorCodes(body: FelplexCertifyResponse): string[] {
  if (!Array.isArray(body.error_codes)) return []
  return body.error_codes
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0)
}

export function flattenFelplexErrors(errors: unknown): string {
  if (errors == null) return "Certificacion rechazada."
  if (Array.isArray(errors)) {
    const parts: string[] = []
    for (const entry of errors) {
      if (typeof entry === "string") {
        parts.push(entry)
      } else if (Array.isArray(entry)) {
        parts.push(...entry.map((nested) => String(nested)))
      } else if (entry != null) {
        parts.push(String(entry))
      }
    }
    return sanitizeFelplexErrors(parts.filter(Boolean))
  }
  return sanitizeFelplexErrors(errors)
}

function validateStageResourceUrl(raw: unknown, label: string): string | null {
  if (raw == null) return null
  if (typeof raw !== "string" || !raw.trim()) return null
  const trimmed = raw.trim()
  const validation = validateFelplexStageUrl(trimmed)
  if (validation) {
    return `${label} con host no autorizado.`
  }
  if (!trimmed.includes(FELPLEX_STAGE_HOST)) {
    return `${label} con host no autorizado.`
  }
  return null
}

export function parseFelplexCertifyResponse(
  body: unknown,
  httpStatus: number,
): ParseFelplexResponseResult {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      kind: "malformed",
      message: "Respuesta FELplex invalida.",
    }
  }

  const parsed = body as FelplexCertifyResponse

  if (parsed.valid === false) {
    const errorCodes = extractFelplexErrorCodes(parsed)
    return {
      ok: false,
      kind: "functional_failure",
      message: flattenFelplexErrors(parsed.errors),
      raw: parsed,
      functional: {
        felUuid: typeof parsed.uuid === "string" ? parsed.uuid : undefined,
        errorCodes,
        publicMessage: flattenFelplexErrors(parsed.errors),
      },
    }
  }

  if (parsed.valid !== true) {
    return {
      ok: false,
      kind: "malformed",
      message: "Respuesta FELplex sin bandera valid.",
      raw: parsed,
    }
  }

  const felUuid = typeof parsed.uuid === "string" ? parsed.uuid.trim() : ""
  if (!UUID_PATTERN.test(felUuid)) {
    return {
      ok: false,
      kind: "incomplete",
      message: "Respuesta FELplex incompleta: uuid invalido.",
      raw: parsed,
    }
  }

  const satAuthorization = typeof parsed.sat?.authorization === "string"
    ? parsed.sat.authorization.trim()
    : ""
  const satSeries = typeof parsed.sat?.serie === "string" ? parsed.sat.serie.trim() : ""
  const satNo = normalizeSatDocumentNumber(parsed.sat?.no)
  const certifiedAt = typeof parsed.sat?.certification_date === "string"
    ? parsed.sat.certification_date.trim()
    : ""

  if (!satAuthorization || !satSeries || !satNo || !certifiedAt) {
    return {
      ok: false,
      kind: "incomplete",
      message: "Respuesta FELplex incompleta.",
      raw: parsed,
    }
  }

  const invoiceUrlError = parsed.invoice_url != null
    ? validateStageResourceUrl(parsed.invoice_url, "invoice_url")
    : null
  if (invoiceUrlError) {
    return { ok: false, kind: "unsafe_url", message: invoiceUrlError, raw: parsed }
  }

  const invoiceXmlError = parsed.invoice_xml != null
    ? validateStageResourceUrl(parsed.invoice_xml, "invoice_xml")
    : null
  if (invoiceXmlError) {
    return { ok: false, kind: "unsafe_url", message: invoiceXmlError, raw: parsed }
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      ok: false,
      kind: "malformed",
      message: `HTTP ${httpStatus} no certificable como exito.`,
      raw: parsed,
    }
  }

  return {
    ok: true,
    kind: "certified",
    raw: parsed,
    data: {
      felUuid,
      satSeries,
      satDocumentNumber: satNo,
      satAuthorization,
      certifiedAt,
      invoiceUrl: typeof parsed.invoice_url === "string" ? parsed.invoice_url : undefined,
      invoiceXml: typeof parsed.invoice_xml === "string" ? parsed.invoice_xml : undefined,
      certifierName: typeof parsed.certifier?.name === "string" ? parsed.certifier.name : undefined,
      certifierTaxCode: typeof parsed.certifier?.tax_code === "string" ? parsed.certifier.tax_code : undefined,
    },
  }
}
