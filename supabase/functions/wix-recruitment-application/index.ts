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
const WEBHOOK_SOURCE = "wix-recruitment-application"
const MAX_RAW_BODY_LOG = 200_000

/** While true, Wix always receives HTTP 200; failures go to webhook_debug_logs. */
function isWixDebugAlwaysOk(): boolean {
  const flag = Deno.env.get("WIX_RECRUITMENT_DEBUG_ALWAYS_200")
  return flag == null || flag === "" || flag === "true" || flag === "1"
}

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
  "por qué quiere trabajar con nosotros": "motivation",
  "por que quiere trabajar con nosotros": "motivation",
  "¿por qué quiere trabajar con nosotros?": "motivation",
  "¿por que quiere trabajar con nosotros?": "motivation",
  "nivel academico": "education_level",
  "nivel académico": "education_level",
  "puesto al que esta aplicando": "applied_position",
  "puesto al que está aplicando": "applied_position",
  "que fecha puede empezar": "available_start_date",
  "qué fecha puede empezar": "available_start_date",
  "cuenta con experiencia para el puesto": "has_experience",
  "cuenta con experiencia para el puesto?": "has_experience",
  "cuenta con experiencia": "has_experience",
  "archivo / papeleria / cv": "attachment_url",
  "archivo / papelería / cv": "attachment_url",
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

const WIX_FIELD_TYPE_PREFIXES: Record<string, OfficialField> = {
  phone: "phone",
  email: "email",
  file_upload: "attachment_url",
  document_upload: "attachment_url",
  upload: "attachment_url",
  checkbox: "data_consent",
  date_picker: "available_start_date",
  date: "available_start_date",
  number_input: "age",
  number: "age"
}

const WIX_METADATA_KEYS = new Set([
  "formId", "formName", "submissionId", "submitterId", "submissionTime",
  "createdAt", "updatedAt", "contextId", "siteId", "revision", "triggerKey",
  "automationId", "entityFqdn", "slug", "entityId", "entityEventSequence",
  "triggeredByAnonymizeRequest", "namespace", "seen", "owner", "id", "status",
  "contactId", "submissionsLink", "formFieldMask", "activationId", "metaSiteId",
  "downloadUrl", "fileName", "locale", "createdDate", "updatedDate", "imageUrl"
])

const WIX_EXTRACTION_SKIP_KEYS = new Set([
  ...WIX_METADATA_KEYS,
  "addresses", "emails", "labelKeys", "address", "subdivision", "subdivisions",
  "items", "primary", "tag", "activation", "configuration", "app", "action",
  "trigger", "userId", "visitorId", "metaSiteId", "activationId"
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

type DebugLogInsert = {
  request_id: string
  source?: string
  http_method?: string | null
  request_url?: string | null
  request_headers?: Record<string, string>
  content_type?: string | null
  raw_body?: string | null
  parsed_body?: unknown
  outcome: string
  error_message?: string | null
  error_detail?: unknown
  response_body?: unknown
}

function debugLog(event: string, details: Record<string, unknown> = {}) {
  if (!DEBUG) return
  console.log(JSON.stringify({ event, ...details }))
}

function serializeHeaders(req: Request): Record<string, string> {
  return Object.fromEntries(req.headers.entries())
}

async function persistDebugLog(
  admin: ReturnType<typeof createClient> | null,
  entry: DebugLogInsert
) {
  debugLog("webhook_debug_log", entry as unknown as Record<string, unknown>)

  if (!admin) return

  const { error } = await admin.from("webhook_debug_logs").insert({
    request_id: entry.request_id,
    source: entry.source ?? WEBHOOK_SOURCE,
    http_method: entry.http_method ?? null,
    request_url: entry.request_url ?? null,
    request_headers: entry.request_headers ?? {},
    content_type: entry.content_type ?? null,
    raw_body: entry.raw_body ?? null,
    parsed_body: entry.parsed_body ?? null,
    outcome: entry.outcome,
    error_message: entry.error_message ?? null,
    error_detail: entry.error_detail ?? null,
    response_body: entry.response_body ?? null
  })

  if (error) {
    debugLog("webhook_debug_log_insert_failed", {
      request_id: entry.request_id,
      error: error.message
    })
  }
}

function wixOkResponse(
  headers: Record<string, string>,
  requestId: string,
  extra: Record<string, unknown> = {}
) {
  return respond(
    {
      success: true,
      message: "Recibido",
      request_id: requestId,
      debug_mode: isWixDebugAlwaysOk(),
      ...extra
    },
    200,
    headers,
    requestId
  )
}

function errorDetail(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack ?? null }
  }
  return { value: error }
}

Deno.serve(async (req) => {
  const allowedOrigin = Deno.env.get("WIX_RECRUITMENT_ALLOWED_ORIGIN") || DEFAULT_CORS_ORIGIN
  const headers = corsHeaders(allowedOrigin)
  const requestId = crypto.randomUUID()
  const wixDebugAlwaysOk = isWixDebugAlwaysOk()
  const reqHeaders = serializeHeaders(req)
  const contentType = req.headers.get("content-type") || ""

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const admin = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    : null

  const rawBody = await req.text()

  let parsedBody: WixPayload | null = null
  let parseError: string | null = null
  try {
    parsedBody = parseRequestBody(rawBody, contentType)
  } catch (error) {
    parseError = error instanceof Error ? error.message : "JSON invalido."
  }

  await persistDebugLog(admin, {
    request_id: requestId,
    http_method: req.method,
    request_url: req.url,
    request_headers: reqHeaders,
    content_type: contentType,
    raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
    parsed_body: parsedBody,
    outcome: "received"
  })

  debugLog("request_received", {
    request_id: requestId,
    method: req.method,
    content_type: contentType,
    url: req.url,
    headers: reqHeaders,
    raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
    parsed_body: parsedBody,
    parse_error: parseError
  })

  try {
    if (req.method !== "POST") {
      const message = "Metodo no permitido. Use POST."
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: parsedBody,
        outcome: "wrong_method",
        error_message: message,
        response_body: { success: false, error: message }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, { internal_error: message, outcome: "wrong_method" })
      }
      return respond({ success: false, error: message }, 405, headers, requestId)
    }

    if (!supabaseUrl || !serviceRoleKey || !admin) {
      const message = "Funcion no configurada."
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: parsedBody,
        outcome: "config_error",
        error_message: message,
        response_body: { success: false, error: message }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, { internal_error: message, outcome: "config_error" })
      }
      return respond({ success: false, error: message }, 500, headers, requestId)
    }

    const authResult = resolveAuthMode(req)
    if ("error" in authResult) {
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: parsedBody,
        outcome: "auth_failed",
        error_message: authResult.error,
        error_detail: { status: authResult.status },
        response_body: { success: false, error: authResult.error }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, {
          internal_error: authResult.error,
          outcome: "auth_failed"
        })
      }
      return respond({ success: false, error: authResult.error }, authResult.status, headers, requestId)
    }

    const { mode } = authResult
    debugLog("auth_mode", { request_id: requestId, mode })

    if (parseError || !parsedBody) {
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: null,
        outcome: "parse_failed",
        error_message: parseError,
        response_body: { success: false, error: parseError }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, {
          internal_error: parseError,
          outcome: "parse_failed"
        })
      }
      return respond({ success: false, error: parseError }, 400, headers, requestId)
    }

    const body = parsedBody
    debugLog("parsed_json", { request_id: requestId, parsed: body })

    const nativeBody = mode === "wix_automation" ? resolveNativeWixBody(body) : body
    let canonicalBody: WixPayload
    let extracted = new Map<string, unknown>()

    try {
      extracted = extractWixFormEntries(nativeBody)
      canonicalBody = mode === "wix_automation" ? mapWixAutomationPayload(body) : body
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al interpretar payload Wix."
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: body,
        outcome: "payload_map_failed",
        error_message: message,
        error_detail: errorDetail(error),
        response_body: { success: false, error: message }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, {
          internal_error: message,
          outcome: "payload_map_failed"
        })
      }
      return respond({ success: false, error: message }, 400, headers, requestId)
    }

    debugLog("canonical_fields", { request_id: requestId, canonical: canonicalBody })

    const validationError = validatePayload(canonicalBody)
    if (validationError) {
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: body,
        outcome: "validation_failed",
        error_message: validationError,
        error_detail: {
          canonical: canonicalBody,
          received_keys: Object.keys(body)
        },
        response_body: {
          success: false,
          error: validationError,
          received_keys: Object.keys(body)
        }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, {
          internal_error: validationError,
          outcome: "validation_failed"
        })
      }
      return respond(
        { success: false, error: validationError, received_keys: Object.keys(body) },
        400,
        headers,
        requestId
      )
    }

    const normalized = normalizePayload(canonicalBody, body, extracted)
    debugLog("normalized_fields", { request_id: requestId, normalized })

    const { data, error } = await admin.rpc("create_recruitment_application_from_website", {
      p_data: normalized
    })

    if (error) {
      await persistDebugLog(admin, {
        request_id: requestId,
        http_method: req.method,
        request_url: req.url,
        request_headers: reqHeaders,
        content_type: contentType,
        raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
        parsed_body: body,
        outcome: "rpc_failed",
        error_message: error.message,
        error_detail: { normalized, rpc: error },
        response_body: {
          success: false,
          error: "No se pudo registrar la aplicación.",
          detail: error.message
        }
      })

      if (wixDebugAlwaysOk) {
        return wixOkResponse(headers, requestId, {
          internal_error: error.message,
          outcome: "rpc_failed"
        })
      }
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

    const successBody = {
      success: true,
      candidate_id: data?.id ?? null,
      duplicate: Boolean(data?.duplicate),
      pipeline_status: data?.pipeline_status ?? "applied",
      notification_count: data?.notification_count ?? 0,
      request_id: requestId
    }

    await persistDebugLog(admin, {
      request_id: requestId,
      http_method: req.method,
      request_url: req.url,
      request_headers: reqHeaders,
      content_type: contentType,
      raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
      parsed_body: body,
      outcome: data?.duplicate ? "duplicate_updated" : "candidate_created",
      response_body: successBody
    })

    return respond(successBody, 200, headers, requestId)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado."
    await persistDebugLog(admin, {
      request_id: requestId,
      http_method: req.method,
      request_url: req.url,
      request_headers: reqHeaders,
      content_type: contentType,
      raw_body: rawBody.slice(0, MAX_RAW_BODY_LOG),
      parsed_body: parsedBody,
      outcome: "exception",
      error_message: message,
      error_detail: errorDetail(error),
      response_body: { success: false, error: message }
    })

    if (wixDebugAlwaysOk) {
      return wixOkResponse(headers, requestId, {
        internal_error: message,
        outcome: "exception"
      })
    }

    return respond({ success: false, error: message }, 500, headers, requestId)
  }
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
  const nativeBody = resolveNativeWixBody(body)
  const extracted = extractWixFormEntries(nativeBody)
  const canonical: WixPayload = {}

  applySubmissionsArray(nativeBody, canonical)
  applyFieldColonKeys(nativeBody, canonical)

  for (const field of OFFICIAL_FIELDS) {
    const direct = pickOfficialValue(nativeBody, field)
    if (direct != null && !isWixPlaceholderValue(direct)) {
      canonical[field] = direct
    }
  }

  applyExtractedFields(extracted, canonical)

  inferFromContactObject(nativeBody, canonical)
  inferFromWixFormTrigger(nativeBody, canonical)
  inferFromSubmitter(nativeBody, canonical)
  inferSubmitterNameParts(nativeBody, canonical)
  inferAttachmentFromSubmissionPdf(nativeBody, canonical)
  inferConsentFromConfirmedSubmission(nativeBody, canonical)
  inferMissingFieldsFromValues(extracted, canonical)
  applyWixFormFallbacks(nativeBody, canonical)
  sanitizeCanonicalFields(canonical)

  if (looksLikeWixAutomation(nativeBody) || hasMinimumFields(canonical) || extracted.size > 0) {
    return canonical
  }

  throw new Error(
    "Payload no reconocido como formulario Wix. Use Toda la carga util del trigger Form Submitted."
  )
}

/** Desenvuelve `data` nativo de Wix Automations; ignora placeholders personalizados. */
function resolveNativeWixBody(body: WixPayload): WixPayload {
  if (isCustomPlaceholderPayload(body) && isRecord(body)) {
    const { data: _ignored, ...rest } = body
    return Object.keys(rest).length ? rest : body
  }

  if (isRecord(body.data) && isNativeWixFormData(body.data)) {
    return { ...body, ...body.data }
  }

  return body
}

function isNativeWixFormData(data: WixPayload): boolean {
  if (Array.isArray(data.submissions)) return true
  if (isRecord(data.contact)) return true
  return Object.keys(data).some((key) => key.startsWith("field:"))
}

function applySubmissionsArray(body: WixPayload, canonical: WixPayload) {
  for (const source of collectAutomationSources(body)) {
    const items = source.submissions
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (!isRecord(item)) continue
      const label = pickFirstString(item, ["label", "fieldLabel", "title", "name"])
      const value = unwrapWixSubmissionValue(pickFirstValue(item, [
        "value", "fieldValue", "answer", "text", "stringValue", "numberValue", "boolValue"
      ]))
      if (!label || value == null || isWixPlaceholderValue(value)) continue

      const official = resolveOfficialField(label)
      if (!official || canonical[official] != null) continue
      canonical[official] = value
    }
  }
}

function applyFieldColonKeys(body: WixPayload, canonical: WixPayload) {
  for (const source of collectAutomationSources(body)) {
    for (const [key, value] of Object.entries(source)) {
      if (!key.startsWith("field:")) continue
      const normalized = unwrapWixSubmissionValue(value)
      if (normalized == null || isWixPlaceholderValue(normalized)) continue
      if (String(normalized).trim() === "") continue

      const official = resolveSubmissionFieldKey(key)
      if (!official || canonical[official] != null) continue
      canonical[official] = normalized
    }
  }
}

function inferAttachmentFromSubmissionPdf(body: WixPayload, canonical: WixPayload) {
  if (canonical.attachment_url) return

  for (const source of collectAutomationSources(body)) {
    const pdf = source.submissionPdf
    if (isRecord(pdf) && pdf.downloadUrl) {
      canonical.attachment_url = String(pdf.downloadUrl)
      return
    }
    const downloadUrl = source.downloadUrl
    if (typeof downloadUrl === "string" && downloadUrl.includes("/submissions/")) {
      canonical.attachment_url = downloadUrl
      return
    }
  }
}

function sanitizeCanonicalFields(canonical: WixPayload) {
  const age = sanitizeAge(canonical.age)
  canonical.age = age

  if (typeof canonical.phone === "string") {
    canonical.phone = canonical.phone.replace(/\s+/g, "")
  }

  if (typeof canonical.email === "string") {
    canonical.email = canonical.email.toLowerCase()
  }

  if (isWixPlaceholderValue(canonical.first_name) || canonical.first_name === canonical.applied_position) {
    canonical.first_name = null
  }

  if (!canonical.full_name) {
    canonical.full_name = [canonical.first_name, canonical.last_name].filter(Boolean).join(" ").trim() || null
  }
}

function sanitizeAge(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text || /^https?:\/\//i.test(text)) return null

  const digits = text.replace(/[^\d]/g, "")
  if (!digits) return null

  const parsed = Number.parseInt(digits, 10)
  if (!Number.isFinite(parsed) || parsed < 16 || parsed > 99) return null
  return String(parsed)
}

function isCustomPlaceholderPayload(body: WixPayload): boolean {
  const data = body.data
  if (!isRecord(data)) return false
  return Object.values(data).some((value) => isWixPlaceholderValue(value))
}

function isWixPlaceholderValue(value: unknown): boolean {
  if (value == null) return false
  const text = String(value).trim()
  return text.startsWith("Personalizar") || text.includes("Personalizar →")
}

function applyExtractedFields(extracted: Map<string, unknown>, canonical: WixPayload) {
  for (const [rawKey, rawValue] of extracted.entries()) {
    if (rawValue == null || isWixPlaceholderValue(rawValue)) continue
    if (String(rawValue).trim() === "") continue
    if (!shouldUseExtractedKey(rawKey)) continue

    const officialField = resolveSubmissionFieldKey(rawKey)
    if (!officialField || canonical[officialField] != null) continue
    if (officialField === "age" && sanitizeAge(rawValue) == null) continue
    if (officialField === "attachment_url" && !looksLikeUrl(rawValue)) continue

    canonical[officialField] = officialField === "age" ? sanitizeAge(rawValue) : rawValue
  }
}

function shouldUseExtractedKey(rawKey: string): boolean {
  const key = rawKey.split(".").pop() || rawKey
  if (key.startsWith("field:")) return true
  if (WIX_EXTRACTION_SKIP_KEYS.has(key)) return false
  if (key.startsWith("_")) return false
  if (/^(context|data\.context|contact\.)/.test(rawKey) && !rawKey.includes("field:")) return false
  if (resolveOfficialField(key)) return true
  return resolveSubmissionFieldKey(key) != null
}

function looksLikeUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim())
}

function resolveSubmissionFieldKey(rawKey: string): OfficialField | null {
  const key = rawKey.split(".").pop() || rawKey
  const withoutFieldPrefix = key.startsWith("field:") ? key.slice(6) : key

  const direct = resolveOfficialField(withoutFieldPrefix)
  if (direct) return direct

  const segments = withoutFieldPrefix.split("_")
  for (let length = segments.length; length >= 1; length -= 1) {
    const prefix = segments.slice(0, length).join("_")
    const fromOfficial = resolveOfficialField(prefix)
    if (fromOfficial) return fromOfficial

    const fromType = WIX_FIELD_TYPE_PREFIXES[prefix]
    if (fromType) return fromType
  }

  return null
}

function inferSubmitterNameParts(body: WixPayload, canonical: WixPayload) {
  if (canonical.first_name && canonical.last_name) return

  const fullName = pickOfficialString(canonical, "full_name")
    || pickString(body, ["submitterName", "submitter_name", "contactName"])
  if (!fullName) return

  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return

  if (!canonical.first_name) canonical.first_name = parts[0]
  if (!canonical.last_name && parts.length > 1) {
    canonical.last_name = parts.slice(1).join(" ")
  }
  if (!canonical.full_name) canonical.full_name = fullName
}

function inferFromContactObject(body: WixPayload, canonical: WixPayload) {
  const sources = collectAutomationSources(body)

  for (const source of sources) {
    const contact = source.contact
    if (!isRecord(contact)) continue

    if (!canonical.email) {
      if (Array.isArray(contact.emails) && contact.emails.length) {
        canonical.email = String(contact.emails[0]).toLowerCase()
      } else if (contact.email) {
        canonical.email = String(contact.email).toLowerCase()
      }
    }

    if (!canonical.phone) {
      if (Array.isArray(contact.phones) && contact.phones.length) {
        canonical.phone = String(contact.phones[0])
      } else if (contact.phone) {
        canonical.phone = String(contact.phone)
      }
    }

    if (!canonical.full_name && !canonical.first_name) {
      if (isRecord(contact.name)) {
        canonical.first_name = contact.name.first ?? contact.name.firstName
        canonical.last_name = contact.name.last ?? contact.name.lastName
        canonical.full_name = [canonical.first_name, canonical.last_name].filter(Boolean).join(" ").trim()
      } else if (contact.name) {
        canonical.full_name = String(contact.name)
      }
    }
  }
}

/** Campos nativos del trigger "Se envía un formulario" en Wix Automations. */
function inferFromWixFormTrigger(body: WixPayload, canonical: WixPayload) {
  const sources = collectAutomationSources(body)

  for (const source of sources) {
    if (!canonical.full_name && !canonical.first_name) {
      const submitterName = pickString(source, ["submitterName", "submitter_name", "contactName", "name"])
      if (submitterName) canonical.full_name = submitterName
    }
    if (!canonical.email) {
      const email = pickString(source, ["submitterEmail", "submitter_email", "contactEmail", "email"])
      if (email) canonical.email = email.toLowerCase()
    }
    if (!canonical.phone) {
      const phone = pickString(source, ["submitterPhone", "submitter_phone", "contactPhone", "phone"])
      if (phone) canonical.phone = phone
    }
    if (!canonical.submitted_at) {
      const submittedAt = pickString(source, [
        "submissionTime", "submittedAt", "createdDate", "createdAt", "eventTime"
      ])
      if (submittedAt) canonical.submitted_at = submittedAt
    }
  }
}

function applyWixFormFallbacks(body: WixPayload, canonical: WixPayload) {
  const isWixForm = looksLikeWixAutomation(body)

  if (!parseConsent(canonical.data_consent) && isWixForm) {
    // Formulario publicado con checkbox de consentimiento obligatorio.
    canonical.data_consent = true
  }

  if (!canonical.applied_position && isWixForm) {
    const formName = pickString(body, ["formName", "form_name"])
    canonical.applied_position = formName || "Aplicación general"
  }

  if (!canonical.full_name && canonical.first_name) {
    canonical.full_name = [canonical.first_name, canonical.last_name].filter(Boolean).join(" ").trim()
  }
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

  if (!canonical.applied_position) {
    const jobHints = ["mesero", "mesera", "cajero", "cajera", "cocina", "barista", "hostess", "gerente", "limpieza"]
    for (const [, raw] of values) {
      const text = String(raw ?? "").trim().toLowerCase()
      if (jobHints.some((hint) => text.includes(hint))) {
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
    absorbFieldColonKeys(source, entries)
    absorbObjectEntries(source, entries)
    absorbFieldArrays(source, entries)
    absorbSubmissionsMap(source, entries)
    flattenIntoEntries(source, entries)
  }

  return entries
}

function absorbFieldColonKeys(source: WixPayload, entries: Map<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("field:")) continue
    const normalized = unwrapWixSubmissionValue(value)
    if (normalized == null || isWixPlaceholderValue(normalized)) continue
    if (String(normalized).trim() === "") continue
    entries.set(key, normalized)
    entries.set(key.slice(6), normalized)
  }
}

function flattenIntoEntries(
  source: WixPayload,
  entries: Map<string, unknown>,
  prefix = "",
  depth = 0,
  seen = new Set<unknown>()
) {
  if (!isRecord(source) || depth > 10 || seen.has(source)) return
  seen.add(source)

  for (const [key, value] of Object.entries(source)) {
    if (WIX_METADATA_KEYS.has(key)) continue
    const compoundKey = prefix ? `${prefix}.${key}` : key

    if (value == null) continue

    if (Array.isArray(value)) {
      const normalized = normalizeWixFieldValue(value)
      if (normalized != null && String(normalized).trim() !== "") {
        entries.set(compoundKey, normalized)
        entries.set(key, normalized)
      }
      continue
    }

    if (isRecord(value)) {
      if (key === "submissions") {
        absorbSubmissionsMap({ submissions: value }, entries)
      }
      flattenIntoEntries(value, entries, compoundKey, depth + 1, seen)
      continue
    }

    const normalized = normalizeWixFieldValue(value)
    if (normalized == null || String(normalized).trim() === "") continue
    entries.set(compoundKey, normalized)
    entries.set(key, normalized)
  }
}

function collectAutomationSources(body: WixPayload, depth = 0, seen = new Set<unknown>()): WixPayload[] {
  if (!isRecord(body) || depth > 8 || seen.has(body)) return []
  seen.add(body)

  const sources: WixPayload[] = [body]

  for (const key of WIX_WRAPPER_KEYS) {
    const nested = body[key]
    if (!isRecord(nested)) continue
    if (key === "data" && isCustomPlaceholderPayload({ data: nested })) continue
    sources.push(nested, ...collectAutomationSources(nested, depth + 1, seen))
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
    if (key.startsWith("field:")) continue
    if (WIX_FIELD_ARRAY_KEYS.includes(key as (typeof WIX_FIELD_ARRAY_KEYS)[number])) continue
    if (WIX_WRAPPER_KEYS.includes(key as (typeof WIX_WRAPPER_KEYS)[number])) continue
    if (value == null) continue

    if (typeof value === "object" && !Array.isArray(value)) {
      if (key === "submissions") continue
      continue
    }

    const normalized = unwrapWixSubmissionValue(value)
    if (normalized == null || isWixPlaceholderValue(normalized)) continue
    entries.set(key, normalized)
  }
}

function absorbSubmissionsMap(source: WixPayload, entries: Map<string, unknown>) {
  const submissions = source.submissions
  if (!isRecord(submissions)) return

  for (const [key, value] of Object.entries(submissions)) {
    const normalized = unwrapWixSubmissionValue(value)
    if (normalized == null || isWixPlaceholderValue(normalized)) continue
    if (String(normalized).trim() === "") continue
    entries.set(key, normalized)

    const official = resolveSubmissionFieldKey(key)
    if (official) entries.set(official, normalized)
  }
}

function absorbFieldArrays(source: WixPayload, entries: Map<string, unknown>) {
  for (const arrayKey of WIX_FIELD_ARRAY_KEYS) {
    const items = source[arrayKey]
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (!isRecord(item)) continue

      const label = pickFirstString(item, [
        "label", "fieldLabel", "title", "name", "key", "fieldKey", "id", "fieldId", "target"
      ])
      const value = pickFirstValue(item, [
        "value", "fieldValue", "answer", "text", "stringValue", "values", "numberValue", "boolValue"
      ])

      if (!label || value == null) continue
      const normalized = unwrapWixSubmissionValue(value)
      if (normalized == null || isWixPlaceholderValue(normalized)) continue
      entries.set(label, normalized)

      const official = resolveSubmissionFieldKey(label)
      if (official) entries.set(official, normalized)
    }
  }
}

function unwrapWixSubmissionValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    const first = value[0]
    if (isRecord(first)) {
      if (first.url) return first.url
      if (first.stringValue != null) return first.stringValue
    }
    return value.map((item) => String(unwrapWixSubmissionValue(item) ?? "")).filter(Boolean).join(", ")
  }

  if (isRecord(value)) {
    if ("nullValue" in value) return null
    if (value.stringValue != null) return value.stringValue
    if (value.numberValue != null) return value.numberValue
    if (value.boolValue != null) return value.boolValue
    if (isRecord(value.listValue) && Array.isArray(value.listValue.values)) {
      return value.listValue.values
        .map((item) => unwrapWixSubmissionValue(item))
        .filter((item) => item != null && String(item).trim() !== "")
        .join(", ")
    }
    if (value.structValue != null) return unwrapWixSubmissionValue(value.structValue)
    if (value.url != null) return value.url
    if (value.value != null) return unwrapWixSubmissionValue(value.value)
    if (value.displayName != null && value.url != null) return value.url
  }

  return normalizeWixFieldValue(value)
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
    if (FIELD_ID_HINTS[field].some((hint) => fieldHintMatches(normalizedKey, hint))) {
      return field
    }
  }

  return null
}

function fieldHintMatches(normalizedKey: string, hint: string): boolean {
  const normalizedHint = normalizeLabel(hint)
  if (!normalizedHint) return false
  if (normalizedKey === normalizedHint) return true
  if (normalizedKey.replace(/_/g, "") === normalizedHint.replace(/_/g, "")) return true

  const segments = normalizedKey.split(/[^a-z0-9]+/).filter(Boolean)
  if (segments.includes(normalizedHint)) return true

  return normalizedKey.startsWith(`${normalizedHint}_`)
    || normalizedKey.endsWith(`_${normalizedHint}`)
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[¿?¡!]+|[¿?¡!.]+$/g, "")
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

function normalizePayload(
  body: WixPayload,
  rawBody: WixPayload = body,
  extracted: Map<string, unknown> = new Map()
): WixPayload {
  const firstName = repairSpanishText(pickOfficialString(body, "first_name") || "") as string
  const lastName = repairSpanishText(pickOfficialString(body, "last_name") || "") as string
  const fullName = repairSpanishText(
    pickOfficialString(body, "full_name") || [firstName, lastName].filter(Boolean).join(" ")
  ) as string

  const formFields: Record<string, unknown> = {}
  for (const [key, value] of extracted.entries()) {
    if (value == null || String(value).trim() === "") continue
    if (WIX_METADATA_KEYS.has(key.split(".").pop() || key)) continue
    formFields[key] = value
  }

  return {
    first_name: firstName || null,
    last_name: lastName || null,
    full_name: fullName,
    phone: pickOfficialString(body, "phone"),
    email: pickOfficialString(body, "email")?.toLowerCase() || null,
    age: sanitizeAge(pickOfficialValue(body, "age")),
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
    submitted_at: pickOfficialString(body, "submitted_at") || new Date().toISOString(),
    form_fields: formFields,
    wix_raw: rawBody
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
