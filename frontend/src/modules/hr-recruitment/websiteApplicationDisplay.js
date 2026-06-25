import { labelFor, CANDIDATE_SOURCES } from "./recruitmentUtils"

export const WEBSITE_APPLICATION_DISPLAY_FIELDS = [
  { id: "full_name", label: "Nombre completo", column: "full_name", keys: ["full_name"] },
  { id: "phone", label: "Teléfono", column: "phone", keys: ["phone"] },
  { id: "email", label: "Email", column: "email", keys: ["email"] },
  { id: "age", label: "Edad", column: "age", keys: ["age"] },
  { id: "municipality", label: "Municipio", column: "address", keys: ["municipality"] },
  { id: "education_level", label: "Nivel académico", keys: ["education_level"] },
  { id: "applied_position", label: "Puesto al que aplica", column: "position_applied", keys: ["applied_position"] },
  { id: "availability", label: "Disponibilidad", column: "schedule_availability", keys: ["availability"] },
  { id: "available_start_date", label: "Fecha en que puede empezar", keys: ["available_start_date"] },
  { id: "salary_expectation", label: "Pretensión salarial", column: "salary_expectation", keys: ["salary_expectation"] },
  { id: "has_experience", label: "¿Cuenta con experiencia?", column: "prior_experience", keys: ["has_experience", "prior_experience"] },
  { id: "motivation", label: "¿Por qué quiere trabajar con nosotros?", column: "notes", keys: ["motivation"] },
  { id: "attachment", label: "Archivo adjunto / CV", column: "attachment_url", keys: ["attachment_url", "document_url"], type: "link" },
  { id: "data_consent", label: "Consentimiento de datos", keys: ["data_consent"], type: "consent" },
  { id: "source", label: "Fuente", keys: ["source"], type: "source" },
  { id: "submitted_at", label: "Fecha de aplicación", column: "applied_at", keys: ["submitted_at"] }
]

function isEmptyValue(value) {
  if (value == null) return true
  if (typeof value === "boolean") return false
  return String(value).trim() === ""
}

function readPayloadValue(payload, keys = []) {
  const normalized = payload?.normalized_fields
  if (normalized && typeof normalized === "object") {
    for (const key of keys) {
      const value = normalized[key]
      if (!isEmptyValue(value)) return value
    }
  }

  for (const key of keys) {
    const value = payload?.[key]
    if (!isEmptyValue(value)) return value
  }

  return null
}

function readColumnValue(candidate, column) {
  if (!column) return null
  const value = candidate?.[column]
  if (isEmptyValue(value)) return null
  return value
}

function formatConsent(value) {
  if (value === true || value === 1) return "Aceptado"
  const text = String(value ?? "").trim().toLowerCase()
  if (["true", "1", "yes", "si", "sí", "on", "acepto", "accepted"].includes(text)) return "Aceptado"
  if (isEmptyValue(value)) return null
  return "No aceptado"
}

function formatSource(value, candidateSource) {
  const source = value || candidateSource || "website"
  return labelFor(CANDIDATE_SOURCES, source) || source
}

function formatDisplayValue(field, rawValue, candidate) {
  if (field.type === "consent") return formatConsent(rawValue)
  if (field.type === "source") return formatSource(rawValue, candidate?.source)
  if (field.type === "link") return rawValue
  if (field.id === "age" && rawValue != null) return String(rawValue)
  if (rawValue == null) return null
  const text = String(rawValue).trim()
  return text || null
}

export function resolveWebsiteApplicationField(candidate, payload, field) {
  const columnValue = readColumnValue(candidate, field.column)
  const payloadValue = readPayloadValue(payload, field.keys)

  let rawValue = columnValue
  if (isEmptyValue(rawValue)) rawValue = payloadValue

  if (field.id === "attachment" && isEmptyValue(rawValue)) {
    rawValue = candidate?.attachment_url || readPayloadValue(payload, ["attachment_url", "document_url"])
  }

  if (field.id === "full_name" && isEmptyValue(rawValue)) {
    const first = readPayloadValue(payload, ["first_name"])
    const last = readPayloadValue(payload, ["last_name"])
    rawValue = [first, last].filter(Boolean).join(" ").trim() || null
  }

  return formatDisplayValue(field, rawValue, candidate)
}

export function buildWebsiteApplicationRows(candidate, payload) {
  const rows = []
  const seenValues = new Set()

  for (const field of WEBSITE_APPLICATION_DISPLAY_FIELDS) {
    const value = resolveWebsiteApplicationField(candidate, payload, field)
    if (isEmptyValue(value) && field.type !== "consent") continue
    if (field.type === "consent" && value == null) continue

    const dedupeKey = field.type === "link"
      ? String(value).trim()
      : String(value).trim().toLowerCase()

    if (field.type !== "link" && field.type !== "consent" && dedupeKey && seenValues.has(dedupeKey)) {
      continue
    }

    if (dedupeKey) seenValues.add(dedupeKey)
    rows.push({ ...field, value })
  }

  return rows
}

export function hasWebsiteApplicationData(candidate, payload) {
  if (candidate?.source === "website") return true
  if (!payload || typeof payload !== "object") return false
  return Object.keys(payload).some((key) => key !== "wix_raw" && key !== "form_fields")
    || Boolean(candidate?.attachment_url)
}

export function buildIntegrationDebugPayload(payload) {
  if (!payload || typeof payload !== "object") return {}
  return {
    application_payload: payload,
    form_fields: payload.form_fields ?? null,
    wix_raw: payload.wix_raw ?? null
  }
}
