/**
 * wix-recruitment-application
 *
 * Recibe aplicaciones POST desde Wix "Trabaja con Nosotros".
 * Soporta payload manual (curl), Wix Automations JSON custom y
 * "Toda la carga util" del trigger Form Submitted.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { repairSpanishText } from "../_shared/repairSpanishText.ts"

const DEFAULT_CORS_ORIGIN = "*"
const DEBUG = true

const OFFICIAL_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "email",
  "age",
  "municipality",
  "education_level",
  "applied_position",
  "availability",
  "available_start_date",
  "salary_expectation",
  "has_experience",
  "motivation",
  "attachment_url",
  "document_url",
  "data_consent",
  "source",
  "submitted_at"
] as const

type OfficialField = (typeof OFFICIAL_FIELDS)[number]

const FIELD_ALIASES: Record<OfficialField, string[]> = {
  first_name: ["firstName", "nombre", "name", "submitterName", "primerNombre"],
  last_name: ["lastName", "apellido", "apellidos", "segundoNombre"],
  full_name: ["fullName", "nombreCompleto", "nombre_completo", "submitterName"],
  phone: ["telefono", "teléfono", "celular", "submitterPhone", "mobile", "contactPhone"],
  email: ["correo", "submitterEmail", "contactEmail"],
  age: ["edad"],
  municipality: ["municipio", "city", "ciudad", "address", "direccion", "dirección"],
  education_level: ["nivelEducativo", "nivel_educativo", "escolaridad", "education"],
  applied_position: ["position_applied", "puesto", "puestoAplicado", "position", "cargo", "puestoAplicado"],
  availability: ["disponibilidad", "schedule_availability", "horario"],
  available_start_date: ["fechaInicio", "fecha_inicio", "startDate", "fechaDisponible", "fechaInicioDisponible"],
  salary_expectation: ["pretensionSalarial", "pretension_salarial", "salario", "salary"],
  has_experience: ["experiencia", "prior_experience", "tieneExperiencia"],
  motivation: ["motivo", "porQue", "por_que", "notes", "mensaje", "motivacion"],
  attachment_url: ["document_url", "cv_url", "cvUrl", "archivo", "fileUrl", "file_upload"],
  document_url: ["attachmentUrl", "documento"],
  data_consent: ["consent", "consentimiento", "acepto", "dataConsent", "privacyConsent", "aceptoTerminos"],
  source: ["fuente", "leadSource"],
  submitted_at: ["submittedAt", "fechaEnvio", "fecha_envio", "createdAt", "createdDate", "eventTime"]
}

const FIELD_ID_HINTS: Record<OfficialField, string[]> = {
  first_name: ["first_name", "firstname", "nombre", "name", "primer"],
  last_name: ["last_name", "lastname", "apellido", "surname"],
  full_name: ["full_name", "fullname", "nombre_completo", "nombrecompleto"],
  phone: ["phone", "telefono", "tel", "celular", "mobile", "whatsapp"],
  email: ["email", "correo", "mail"],
  age: ["age", "edad"],
  municipality: ["municipio", "municipality", "city", "ciudad", "address", "direccion"],
  education_level: ["education", "escolaridad", "nivel_educativo", "nivel_educativo"],
  applied_position: ["puesto", "position", "cargo", "applied", "vacante", "rol"],
  availability: ["disponibilidad", "availability", "horario", "schedule"],
  available_start_date: ["fecha_inicio", "start_date", "inicio", "available_start"],
  salary_expectation: ["salario", "salary", "pretension", "sueldo"],
  has_experience: ["experiencia", "experience", "tiene_experiencia"],
  motivation: ["motivacion", "motivation", "motivo", "por_que", "porque"],
  attachment_url: ["cv", "curriculum", "file_upload", "documento", "archivo", "resume"],
  document_url: ["document", "documento", "adjunto"],
  data_consent: ["consent", "consentimiento", "acepto", "privacidad", "terminos", "terms"],
  source: ["source", "fuente"],
  submitted_at: ["submitted", "created", "fecha", "date", "event_time"]
}

const WIX_FORM_LABEL_MAP: Record<string, OfficialField> = {
  nombre: "first_name",
  "primer nombre": "first_name",
  "nombre completo": "full_name",
  apellido: "last_name",
  apellidos: "last_name",
  telefono: "phone",
  teléfono: "phone",
  celular: "phone",
  correo: "email",
  "correo electronico": "email",
  "correo electrónico": "email",
  email: "email",
  edad: "age",
  municipio: "municipality",
  ciudad: "municipality",
  escolaridad: "education_level",
  "nivel educativo": "education_level",
  puesto: "applied_position",
  "puesto al que aplica": "applied_position",
  cargo: "applied_position",
  disponibilidad: "availability",
  "fecha de inicio": "available_start_date",
  "fecha disponible": "available_start_date",
  salario: "salary_expectation",
  "pretension salarial": "salary_expectation",
  "pretensión salarial": "salary_expectation",
  experiencia: "has_experience",
  "tiene experiencia": "has_experience",
  motivacion: "motivation",
  motivación: "motivation",
  "por que quieres trabajar con nosotros": "motivation",
  "por qué quieres trabajar con nosotros": "motivation",
  cv: "attachment_url",
  curriculum: "attachment_url",
  "curriculum vitae": "attachment_url",
  archivo: "attachment_url",
  documento: "document_url",
  consentimiento: "data_consent",
  "acepto terminos": "data_consent",
  "acepto términos": "data_consent",
  "acepto politica de privacidad": "data_consent",
  "acepto política de privacidad": "data_consent"
}

const WIX_METADATA_KEYS = new Set([
  "formId", "formName", "submissionId", "submitterId", "submissionTime",
  "createdAt", "updatedAt", "contextId", "siteId", "revision", "triggerKey",
  "automationId", "entityFqdn", "slug", "entityId", "entityEventSequence",
  "triggeredByAnonymizeRequest", "namespace", "seen", "owner", "id", "status"
])

const WIX_FIELD_ARRAY_KEYS = ["fields", "formFields", "answers", "submissions", "formFieldValues"] as const

const WIX_WRAPPER_KEYS = [
  "data", "payload", "submission", "body", "trigger", "event", "context",
  "createdEvent", "entity", "formSubmission", "input", "result", "contact"
] as const

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wix-recruitment-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
})

type WixPayload = Record<string, unknown>
type AuthMode = "wix_webhook" | "wix_automation"

function debugLog(event: string, details: Record<string, unknown> = {}) {
  if (!DEBUG) return
  console.log(JSON.stringify({ event, ...details }))
}

Deno.serve(async (req) => {
  const allowedOrigin = Deno.env.get("WIX_RECRUITMENT_ALLOWED_ORIGIN") || DEFAULT_CORS_ORIGIN
  const headers = corsHeaders(allowedOrigin)
  const contentType = req.headers.get("content-type") || ""
  const requestId = crypto.randomUUID()

  debugLog("request_received", {
    request_id: requestId,
    method: req.method,
    content_type: contentType,
    url: req.url,
    has_secret_header: Boolean(req.headers.get("x-wix-recruitment-secret")?.trim())
  })

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  if (req.method !== "POST") {
    return respond({ success: false, error: "Metodo no permitido. Use POST." }, 405, headers, requestId)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ success: false, error: "Funcion no configurada." }, 500, headers, requestId)
  }

  const authResult = resolveAuthMode(req)
  if ("error" in authResult) {
    debugLog("auth_failed", { request_id: requestId, error: authResult.error })
    return respond({ success: false, error: authResult.error }, authResult.status, headers, requestId)
  }

  const { mode } = authResult
  debugLog("auth_mode", { request_id: requestId, mode })

  const rawBody = await req.text()
  debugLog("raw_body", { request_id: requestId, raw_body: rawBody.slice(0, 12000) })

  let body: WixPayload
  try {
    body = parseRequestBody(rawBody, contentType)
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON invalido."
    debugLog("parse_failed", { request_id: requestId, error: message })
    return respond({ success: false, error: message }, 400, headers, requestId)
  }

  debugLog("parsed_json", { request_id: requestId, parsed: body })

  let canonicalBody: WixPayload
  try {
    canonicalBody = mode === "wix_automation" ? mapWixAutomationPayload(body) : body
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al interpretar payload Wix."
    debugLog("payload_map_failed", { request_id: requestId, error: message, parsed: body })
    return respond({ success: false, error: message }, 400, headers, requestId)
  }

  debugLog("canonical_fields", { request_id: requestId, canonical: canonicalBody })

  const validationError = validatePayload(canonicalBody)
  if (validationError) {
    debugLog("validation_failed", {
      request_id: requestId,
      error: validationError,
      canonical: canonicalBody
    })
    return respond({ success: false, error: validationError, received_keys: Object.keys(body) }, 400, headers, requestId)
  }

  const normalized = normalizePayload(canonicalBody)
  debugLog("normalized_fields", { request_id: requestId, normalized })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data, error } = await admin.rpc("create_recruitment_application_from_website", {
    p_data: normalized
  })

  if (error) {
    debugLog("rpc_failed", { request_id: requestId, error: error.message, normalized })
    return respond(
      { success: false, error: "No se pudo registrar la aplicación.", detail: error.message },
      500,
      headers,
      requestId
    )
  }

  debugLog(data?.duplicate ? "candidate_updated" : "candidate_created", {
    request_id: requestId,
    candidate_id: data?.id,
    duplicate: Boolean(data?.duplicate),
    notification_count: data?.notification_count ?? 0
  })

  return respond(
    {
      success: true,
      candidate_id: data?.id ?? null,
      duplicate: Boolean(data?.duplicate),
      pipeline_status: data?.pipeline_status ?? "applied",
      notification_count: data?.notification_count ?? 0
    },
    200,
    headers,
    requestId
  )
})

function respond(body: unknown, status: number, headers: Record<string, string>, requestId: string) {
  debugLog("response_sent", { request_id: requestId, status, body })
  return json(body, status, headers)
}

function parseRequestBody(rawBody: string, contentType: string): WixPayload {
  const trimmed = rawBody.trim()
  if (!trimmed) {
    throw new Error("Body vacio.")
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (isRecord(parsed)) return parsed
    throw new Error("JSON debe ser un objeto.")
  } catch (firstError) {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (isRecord(parsed)) return parsed
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(trimmed)
      const payload: WixPayload = {}
      for (const [key, value] of params.entries()) payload[key] = value
      if (Object.keys(payload).length) return payload
    }

    throw firstError instanceof Error ? firstError : new Error("JSON invalido.")
  }
}

function resolveAuthMode(req: Request): { mode: AuthMode } | { error: string; status: number } {
  const incomingSecret = req.headers.get("x-wix-recruitment-secret")?.trim()
  if (!incomingSecret) return { mode: "wix_automation" }

  const webhookSecret = Deno.env.get("WIX_RECRUITMENT_WEBHOOK_SECRET")
  if (!webhookSecret || incomingSecret !== webhookSecret) {
    return { error: "Unauthorized", status: 401 }
  }
  return { mode: "wix_webhook" }
}

function mapWixAutomationPayload(body: WixPayload): WixPayload {
  const extracted = extractWixFormEntries(body)
  const canonical: WixPayload = {}

  for (const field of OFFICIAL_FIELDS) {
    const direct = pickOfficialValue(body, field)
    if (direct != null && String(direct).trim() !== "") {
      canonical[field] = direct
    }
  }

  for (const [rawKey, rawValue] of extracted.entries()) {
    const officialField = resolveOfficialField(rawKey)
    if (!officialField || canonical[officialField] != null) continue
    if (rawValue == null || String(rawValue).trim() === "") continue
    canonical[officialField] = rawValue
  }

  inferFromSubmitter(body, canonical)
  inferConsentFromConfirmedSubmission(body, canonical)
  inferMissingFieldsFromValues(extracted, canonical)

  if (looksLikeWixAutomation(body) || hasMinimumFields(canonical) || extracted.size > 0) {
    return canonical
  }

  throw new Error(
    "Payload no reconocido como formulario Wix. Envie campos del formulario o use Toda la carga util del trigger."
  )
}

function inferFromSubmitter(body: WixPayload, canonical: WixPayload) {
  const sources = collectAutomationSources(body)
  for (const source of sources) {
    const submitter = source.submitter
    if (!isRecord(submitter)) continue

    const contact = isRecord(submitter.contactDetails) ? submitter.contactDetails : submitter
    if (!canonical.email) {
      canonical.email = contact.email ?? submitter.email
    }
    if (!canonical.phone) {
      canonical.phone = contact.phone ?? submitter.phone
    }
    if (!canonical.full_name && !canonical.first_name) {
      canonical.full_name = submitter.name ?? submitter.fullName ?? submitter.submitterName
    }
  }
}

function inferConsentFromConfirmedSubmission(body: WixPayload, canonical: WixPayload) {
  if (parseConsent(canonical.data_consent)) return

  const sources = collectAutomationSources(body)
  for (const source of sources) {
    const status = String(source.status || "").toUpperCase()
    if (status === "CONFIRMED") {
      canonical.data_consent = true
      return
    }
  }
}

function inferMissingFieldsFromValues(extracted: Map<string, unknown>, canonical: WixPayload) {
  const values = [...extracted.entries()]

  if (!canonical.email) {
    for (const [key, raw] of values) {
      const text = String(raw ?? "").trim().toLowerCase()
      if (text.includes("@") && text.includes(".")) {
        canonical.email = text
        break
      }
      if (resolveOfficialField(key) === "email") canonical.email = text
    }
  }

  if (!canonical.phone) {
    for (const [key, raw] of values) {
      const digits = String(raw ?? "").replace(/[^\d+]/g, "")
      if (digits.length >= 8 && digits.length <= 15) {
        canonical.phone = String(raw).trim()
        break
      }
      if (resolveOfficialField(key) === "phone") canonical.phone = String(raw).trim()
    }
  }

  if (!canonical.full_name && !canonical.first_name) {
    for (const [key, raw] of values) {
      const text = String(raw ?? "").trim()
      if (!text || text.includes("@") || /^\d+$/.test(text.replace(/[^\d]/g, ""))) continue
      const field = resolveOfficialField(key)
      if (field === "full_name") {
        canonical.full_name = text
        break
      }
      if (field === "first_name") {
        canonical.first_name = text
      }
      if (field === "last_name") {
        canonical.last_name = text
      }
    }
  }

  if (!canonical.applied_position) {
    for (const [key, raw] of values) {
      if (resolveOfficialField(key) === "applied_position") {
        canonical.applied_position = String(raw).trim()
        break
      }
    }
  }

  if (!parseConsent(canonical.data_consent)) {
    for (const [key, raw] of values) {
      if (resolveOfficialField(key) === "data_consent" && parseConsent(raw)) {
        canonical.data_consent = true
        break
      }
    }
  }
}

function looksLikeWixAutomation(body: WixPayload): boolean {
  if (WIX_FIELD_ARRAY_KEYS.some((key) => Array.isArray(body[key]))) return true
  if (isRecord(body.submissions) && Object.keys(body.submissions).length > 0) return true
  if (body.submitterName != null || body.submitterEmail != null || body.submitterPhone != null) return true
  if (isRecord(body.contact) || isRecord(body.submitter)) return true
  if (WIX_WRAPPER_KEYS.some((key) => isRecord(body[key]))) return true
  if (body.formId != null || body.formName != null || body.submissionId != null) return true
  if (body.entityFqdn != null || isRecord(body.createdEvent)) return true
  return false
}

function hasMinimumFields(body: WixPayload): boolean {
  const name = pickOfficialString(body, "full_name")
    || [pickOfficialString(body, "first_name"), pickOfficialString(body, "last_name")].filter(Boolean).join(" ")
  return Boolean(name && pickOfficialString(body, "phone") && pickOfficialString(body, "applied_position"))
}

function extractWixFormEntries(body: WixPayload): Map<string, unknown> {
  const entries = new Map<string, unknown>()
  const sources = collectAutomationSources(body)

  for (const source of sources) {
    absorbObjectEntries(source, entries)
    absorbFieldArrays(source, entries)
    absorbSubmissionsMap(source, entries)
  }

  return entries
}

function collectAutomationSources(body: WixPayload, depth = 0, seen = new Set<unknown>()): WixPayload[] {
  if (!isRecord(body) || depth > 8 || seen.has(body)) return []
  seen.add(body)

  const sources: WixPayload[] = [body]

  for (const key of WIX_WRAPPER_KEYS) {
    const nested = body[key]
    if (isRecord(nested)) {
      sources.push(nested, ...collectAutomationSources(nested, depth + 1, seen))
    }
  }

  if (isRecord(body.createdEvent) && isRecord(body.createdEvent.entity)) {
    const entity = body.createdEvent.entity
    sources.push(entity, ...collectAutomationSources(entity, depth + 1, seen))
  }

  if (isRecord(body.submitter)) {
    const submitter = body.submitter
    sources.push({
      first_name: submitter.firstName ?? submitter.name,
      full_name: submitter.fullName ?? submitter.name ?? submitter.submitterName,
      email: submitter.email,
      phone: submitter.phone
    })
    if (isRecord(submitter.contactDetails)) {
      sources.push({
        email: submitter.contactDetails.email,
        phone: submitter.contactDetails.phone,
        full_name: submitter.contactDetails.name
      })
    }
  }

  return sources
}

function absorbObjectEntries(source: WixPayload, entries: Map<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (WIX_METADATA_KEYS.has(key)) continue
    if (WIX_FIELD_ARRAY_KEYS.includes(key as (typeof WIX_FIELD_ARRAY_KEYS)[number])) continue
    if (WIX_WRAPPER_KEYS.includes(key as (typeof WIX_WRAPPER_KEYS)[number])) continue
    if (value == null) continue

    if (typeof value === "object" && !Array.isArray(value)) {
      if (key === "submissions") continue
      continue
    }

    entries.set(key, normalizeWixFieldValue(value))
  }
}

function absorbSubmissionsMap(source: WixPayload, entries: Map<string, unknown>) {
  const submissions = source.submissions
  if (!isRecord(submissions)) return

  for (const [key, value] of Object.entries(submissions)) {
    const normalized = normalizeWixFieldValue(value)
    if (normalized == null || String(normalized).trim() === "") continue
    entries.set(key, normalized)
  }
}

function absorbFieldArrays(source: WixPayload, entries: Map<string, unknown>) {
  for (const arrayKey of WIX_FIELD_ARRAY_KEYS) {
    const items = source[arrayKey]
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (!isRecord(item)) continue

      const label = pickFirstString(item, [
        "label", "fieldLabel", "title", "name", "key", "fieldKey", "id", "fieldId"
      ])
      const value = pickFirstValue(item, [
        "value", "fieldValue", "answer", "text", "stringValue", "values", "numberValue", "boolValue"
      ])

      if (!label || value == null) continue
      entries.set(label, normalizeWixFieldValue(value))
    }
  }
}

function normalizeWixFieldValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value

  if (Array.isArray(value)) {
    const first = value[0]
    if (isRecord(first)) {
      if (first.url) return first.url
      if (first.stringValue != null) return first.stringValue
    }
    return value.map((item) => String(item)).filter(Boolean).join(", ")
  }

  if (isRecord(value)) {
    if (value.stringValue != null) return value.stringValue
    if (value.numberValue != null) return value.numberValue
    if (value.boolValue != null) return value.boolValue
    if (value.url != null) return value.url
    if (value.value != null) return normalizeWixFieldValue(value.value)
    if (value.displayName != null && value.url != null) return value.url
  }

  return String(value)
}

function resolveOfficialField(rawKey: string): OfficialField | null {
  const normalizedKey = normalizeLabel(rawKey)

  if (WIX_FORM_LABEL_MAP[normalizedKey]) {
    return WIX_FORM_LABEL_MAP[normalizedKey]
  }

  for (const field of OFFICIAL_FIELDS) {
    if (field === normalizedKey.replace(/\s+/g, "_")) return field
    if (FIELD_ALIASES[field].some((alias) => normalizeLabel(alias) === normalizedKey)) {
      return field
    }
    if (FIELD_ID_HINTS[field].some((hint) => normalizedKey.includes(normalizeLabel(hint)))) {
      return field
    }
  }

  return null
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function validatePayload(body: WixPayload): string | null {
  const fullName = pickOfficialString(body, "full_name")
    || [pickOfficialString(body, "first_name"), pickOfficialString(body, "last_name")].filter(Boolean).join(" ").trim()
  if (!fullName) return "Nombre (first_name/last_name/full_name) es obligatorio."
  if (!pickOfficialString(body, "phone")) return "phone es obligatorio."
  if (!pickOfficialString(body, "applied_position")) return "applied_position es obligatorio."
  if (!parseConsent(pickOfficialValue(body, "data_consent"))) return "data_consent es obligatorio."
  return null
}

function normalizePayload(body: WixPayload): WixPayload {
  const firstName = repairSpanishText(pickOfficialString(body, "first_name") || "") as string
  const lastName = repairSpanishText(pickOfficialString(body, "last_name") || "") as string
  const fullName = repairSpanishText(
    pickOfficialString(body, "full_name") || [firstName, lastName].filter(Boolean).join(" ")
  ) as string

  return {
    first_name: firstName || null,
    last_name: lastName || null,
    full_name: fullName,
    phone: pickOfficialString(body, "phone"),
    email: pickOfficialString(body, "email")?.toLowerCase() || null,
    age: pickOfficialString(body, "age"),
    municipality: pickOfficialString(body, "municipality"),
    education_level: pickOfficialString(body, "education_level"),
    applied_position: pickOfficialString(body, "applied_position"),
    availability: pickOfficialString(body, "availability"),
    available_start_date: pickOfficialString(body, "available_start_date"),
    salary_expectation: pickOfficialString(body, "salary_expectation"),
    has_experience: stringifyExperience(pickOfficialValue(body, "has_experience")),
    motivation: pickOfficialString(body, "motivation"),
    attachment_url: pickOfficialString(body, "attachment_url") || pickOfficialString(body, "document_url"),
    document_url: pickOfficialString(body, "document_url"),
    data_consent: parseConsent(pickOfficialValue(body, "data_consent")),
    source: "website",
    submitted_at: pickOfficialString(body, "submitted_at") || new Date().toISOString()
  }
}

function stringifyExperience(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "boolean") return value ? "Si" : "No"
  const text = String(value).trim()
  return text || null
}

function parseConsent(value: unknown): boolean {
  if (value === true || value === 1) return true
  const text = String(value ?? "").trim().toLowerCase()
  return ["true", "1", "yes", "si", "sí", "on", "acepto", "accepted"].includes(text)
}

function pickOfficialString(body: WixPayload, field: OfficialField): string | null {
  return pickString(body, [field, ...FIELD_ALIASES[field]])
}

function pickOfficialValue(body: WixPayload, field: OfficialField): unknown {
  return pickValue(body, [field, ...FIELD_ALIASES[field]])
}

function pickString(body: WixPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key]
    if (value == null) continue
    const trimmed = repairSpanishText(String(value).trim()) as string
    if (trimmed) return trimmed
  }
  return null
}

function pickValue(body: WixPayload, keys: string[]): unknown {
  for (const key of keys) {
    if (body[key] != null) return body[key]
  }
  return null
}

function pickFirstString(body: WixPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key]
    if (value == null) continue
    const trimmed = repairSpanishText(String(value).trim()) as string
    if (trimmed) return trimmed
  }
  return null
}

function pickFirstValue(body: WixPayload, keys: string[]): unknown {
  for (const key of keys) {
    if (body[key] != null) return body[key]
  }
  return null
}

function isRecord(value: unknown): value is WixPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function json(body: unknown, status = 200, headers: Record<string, string> = corsHeaders(DEFAULT_CORS_ORIGIN)) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  })
}
