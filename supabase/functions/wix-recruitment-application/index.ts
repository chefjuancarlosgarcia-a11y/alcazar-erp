/**
 * wix-recruitment-application
 *
 * Recibe aplicaciones POST desde Wix "Trabaja con Nosotros" y las persiste en
 * public.recruitment_candidates mediante create_recruitment_application_from_website.
 *
 * MODOS DE AUTENTICACIÓN:
 *   1. Webhook con secret
 *      Header: x-wix-recruitment-secret = WIX_RECRUITMENT_WEBHOOK_SECRET
 *   2. Wix Automations → Send HTTP Request (sin headers personalizados)
 *
 * SECRETS:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   WIX_RECRUITMENT_WEBHOOK_SECRET (opcional para Automations)
 *   WIX_RECRUITMENT_ALLOWED_ORIGIN (opcional, default *)
 *
 * Despliegue:
 *   supabase secrets set WIX_RECRUITMENT_WEBHOOK_SECRET=<token-largo>
 *   supabase functions deploy wix-recruitment-application --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { repairSpanishText } from "../_shared/repairSpanishText.ts"

const DEFAULT_CORS_ORIGIN = "*"

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
  first_name: ["firstName", "nombre", "name", "submitterName"],
  last_name: ["lastName", "apellido", "apellidos"],
  full_name: ["fullName", "nombreCompleto", "nombre_completo"],
  phone: ["telefono", "teléfono", "celular", "submitterPhone", "mobile"],
  email: ["correo", "submitterEmail", "contactEmail"],
  age: ["edad"],
  municipality: ["municipio", "city", "ciudad", "address", "direccion", "dirección"],
  education_level: ["nivelEducativo", "nivel_educativo", "escolaridad", "education"],
  applied_position: ["position_applied", "puesto", "puestoAplicado", "position", "cargo"],
  availability: ["disponibilidad", "schedule_availability", "horario"],
  available_start_date: ["fechaInicio", "fecha_inicio", "startDate", "fechaDisponible"],
  salary_expectation: ["pretensionSalarial", "pretension_salarial", "salario", "salary"],
  has_experience: ["experiencia", "prior_experience", "tieneExperiencia"],
  motivation: ["motivo", "porQue", "por_que", "notes", "mensaje"],
  attachment_url: ["document_url", "cv_url", "cvUrl", "archivo", "fileUrl"],
  document_url: ["attachmentUrl", "documento"],
  data_consent: ["consent", "consentimiento", "acepto", "dataConsent", "privacyConsent"],
  source: ["fuente", "leadSource"],
  submitted_at: ["submittedAt", "fechaEnvio", "fecha_envio", "createdAt"]
}

const WIX_FORM_LABEL_MAP: Record<string, OfficialField> = {
  nombre: "first_name",
  "primer nombre": "first_name",
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
  "createdAt", "updatedAt", "contextId", "siteId", "revision", "triggerKey", "automationId"
])

const WIX_FIELD_ARRAY_KEYS = ["fields", "formFields", "answers", "submissions", "formFieldValues"] as const

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wix-recruitment-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
})

type WixPayload = Record<string, unknown>
type AuthMode = "wix_webhook" | "wix_automation"

Deno.serve(async (req) => {
  const allowedOrigin = Deno.env.get("WIX_RECRUITMENT_ALLOWED_ORIGIN") || DEFAULT_CORS_ORIGIN
  const headers = corsHeaders(allowedOrigin)

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Metodo no permitido. Use POST." }, 405, headers)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: "Funcion no configurada." }, 500, headers)
  }

  const authResult = resolveAuthMode(req)
  if ("error" in authResult) {
    console.warn(JSON.stringify({ event: "auth_failed", error: authResult.error }))
    return json({ success: false, error: authResult.error }, authResult.status, headers)
  }

  const { mode } = authResult

  let body: WixPayload
  try {
    body = await req.json()
  } catch {
    console.warn(JSON.stringify({ event: "invalid_json" }))
    return json({ success: false, error: "JSON invalido." }, 400, headers)
  }

  console.log(JSON.stringify({ event: "payload_received", mode, payload: body }))

  let canonicalBody: WixPayload
  try {
    canonicalBody = mode === "wix_automation" ? mapWixAutomationPayload(body) : body
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al interpretar payload Wix."
    console.warn(JSON.stringify({ event: "payload_map_failed", error: message }))
    return json({ success: false, error: message }, 400, headers)
  }

  const validationError = validatePayload(canonicalBody)
  if (validationError) {
    console.warn(JSON.stringify({ event: "validation_failed", error: validationError, payload: canonicalBody }))
    return json({ success: false, error: validationError }, 400, headers)
  }

  const normalized = normalizePayload(canonicalBody)
  console.log(JSON.stringify({ event: "payload_normalized", payload: normalized }))

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data, error } = await admin.rpc("create_recruitment_application_from_website", {
    p_data: normalized
  })

  if (error) {
    console.error(JSON.stringify({ event: "rpc_failed", error: error.message }))
    return json(
      { success: false, error: "No se pudo registrar la aplicación.", detail: error.message },
      500,
      headers
    )
  }

  console.log(JSON.stringify({
    event: data?.duplicate ? "candidate_updated" : "candidate_created",
    candidate_id: data?.id,
    duplicate: Boolean(data?.duplicate),
    notification_count: data?.notification_count ?? 0
  }))

  return json(
    {
      success: true,
      candidate_id: data?.id ?? null,
      duplicate: Boolean(data?.duplicate),
      pipeline_status: data?.pipeline_status ?? "applied",
      notification_count: data?.notification_count ?? 0
    },
    200,
    headers
  )
})

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

  if (looksLikeWixAutomation(body) || hasMinimumFields(canonical)) {
    return canonical
  }

  throw new Error("Payload no reconocido como formulario Wix.")
}

function looksLikeWixAutomation(body: WixPayload): boolean {
  if (WIX_FIELD_ARRAY_KEYS.some((key) => Array.isArray(body[key]))) return true
  if (body.submitterName != null || body.submitterEmail != null || body.submitterPhone != null) return true
  if (isRecord(body.contact) || isRecord(body.submitter)) return true
  if (isRecord(body.data) || isRecord(body.payload) || isRecord(body.submission)) return true
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
  }
  return entries
}

function collectAutomationSources(body: WixPayload): WixPayload[] {
  const sources: WixPayload[] = [body]
  for (const key of ["data", "payload", "submission"] as const) {
    if (isRecord(body[key])) sources.push(body[key])
  }
  for (const key of ["contact", "submitter"] as const) {
    if (isRecord(body[key])) {
      sources.push({
        first_name: body[key].firstName ?? body[key].name,
        email: body[key].email,
        phone: body[key].phone
      })
    }
  }
  return sources
}

function absorbObjectEntries(source: WixPayload, entries: Map<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (WIX_METADATA_KEYS.has(key)) continue
    if (WIX_FIELD_ARRAY_KEYS.includes(key as (typeof WIX_FIELD_ARRAY_KEYS)[number])) continue
    if (["contact", "submitter", "data", "payload", "submission"].includes(key)) continue
    if (value == null || (typeof value === "object" && !Array.isArray(value))) continue
    entries.set(key, value)
  }
}

function absorbFieldArrays(source: WixPayload, entries: Map<string, unknown>) {
  for (const arrayKey of WIX_FIELD_ARRAY_KEYS) {
    const items = source[arrayKey]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (!isRecord(item)) continue
      const label = pickFirstString(item, ["label", "fieldLabel", "title", "name", "key", "fieldKey", "id"])
      const value = pickFirstValue(item, ["value", "fieldValue", "answer", "text", "stringValue", "values"])
      if (!label || value == null) continue
      entries.set(label, Array.isArray(value) ? value.map(String).join(", ") : value)
    }
  }
}

function resolveOfficialField(rawKey: string): OfficialField | null {
  const normalizedKey = normalizeLabel(rawKey)
  if (WIX_FORM_LABEL_MAP[normalizedKey]) return WIX_FORM_LABEL_MAP[normalizedKey]
  for (const field of OFFICIAL_FIELDS) {
    if (FIELD_ALIASES[field].some((alias) => normalizeLabel(alias) === normalizedKey)) return field
  }
  return null
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function validatePayload(body: WixPayload): string | null {
  const fullName = pickOfficialString(body, "full_name")
    || [pickOfficialString(body, "first_name"), pickOfficialString(body, "last_name")].filter(Boolean).join(" ").trim()
  if (!fullName) return "Nombre (first_name/last_name) es obligatorio."
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
