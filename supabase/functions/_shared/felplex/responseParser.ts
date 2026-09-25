import { FELPLEX_STAGE_HOST } from "./constants.ts"
import { sanitizeFelplexErrors } from "./sanitize.ts"
import { validateFelplexStageUrl } from "./urlAllowlist.ts"
import type { FelplexCertifyResponse } from "./types.ts"

export type FelplexParsedCertification = {
  felUuid: string
  satSeries: string
  satDocumentNumber: string
  satAuthorization: string
  /** SAT certification_date. Required on valid=true; never invented. */
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

/** Guatemala has no DST. Fixed offset; not derived from process or database timezone. */
const GUATEMALA_ISO_OFFSET = "-06:00"

const SAT_CERTIFICATION_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))?$/

/**
 * FELplex success contract.
 * No zone: civil America/Guatemala, emitted as the same clock with -06:00.
 * Z or numeric offset: same instant, original suffix kept.
 */
export function parseSatCertificationDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  const match = SAT_CERTIFICATION_DATE_PATTERN.exec(trimmed)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const fraction = match[7] ?? ""
  const zone = match[8]
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null
  if (zone && zone !== "Z") {
    const offsetHour = Number(match[9])
    const offsetMinute = Number(match[10])
    if (offsetHour > 23 || offsetMinute > 59) return null
  }
  const probed = new Date(Date.UTC(year, month - 1, day))
  if (
    probed.getUTCFullYear() !== year
    || probed.getUTCMonth() !== month - 1
    || probed.getUTCDate() !== day
  ) {
    return null
  }
  const clock = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${fraction}`
  return zone ? `${clock}${zone}` : `${clock}${GUATEMALA_ISO_OFFSET}`
}

function stageResourceUuid(raw: string, resource: "pdf" | "xml"): string | null {
  const trimmed = raw.trim()
  if (validateFelplexStageUrl(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.hostname !== FELPLEX_STAGE_HOST) return null
  const match = new RegExp(`^/${resource}/([^/]+)$`).exec(parsed.pathname)
  return match?.[1] ?? null
}

function validateStageResourceUrl(
  raw: unknown,
  resource: "pdf" | "xml",
  felUuid: string,
  label: string,
): string | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return `${label} requerido.`
  }
  const resourceUuid = stageResourceUuid(raw, resource)
  if (!resourceUuid) {
    return `${label} con host no autorizado.`
  }
  if (resourceUuid.toLowerCase() !== felUuid.toLowerCase()) {
    return `${label} no coincide con uuid.`
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
  const certifiedAt = parseSatCertificationDate(parsed.sat?.certification_date)

  if (!satAuthorization || !satSeries || !satNo || !certifiedAt) {
    return {
      ok: false,
      kind: "incomplete",
      message: "Respuesta FELplex incompleta.",
      raw: parsed,
    }
  }

  const invoiceUrlError = validateStageResourceUrl(parsed.invoice_url, "pdf", felUuid, "invoice_url")
  if (invoiceUrlError) {
    return {
      ok: false,
      kind: invoiceUrlError.endsWith("requerido.") || invoiceUrlError.includes("no coincide")
        ? "incomplete"
        : "unsafe_url",
      message: invoiceUrlError,
      raw: parsed,
    }
  }

  const invoiceXmlError = validateStageResourceUrl(parsed.invoice_xml, "xml", felUuid, "invoice_xml")
  if (invoiceXmlError) {
    return {
      ok: false,
      kind: invoiceXmlError.endsWith("requerido.") || invoiceXmlError.includes("no coincide")
        ? "incomplete"
        : "unsafe_url",
      message: invoiceXmlError,
      raw: parsed,
    }
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
