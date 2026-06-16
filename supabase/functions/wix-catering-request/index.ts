/**
 * wix-catering-request
 *
 * Recibe solicitudes POST desde Wix y las persiste en public.catering_requests
 * mediante el RPC create_catering_request.
 *
 * MODOS DE AUTENTICACIÓN:
 *   1. Webhook con secret (integraciones existentes)
 *      Header: x-wix-catering-secret = WIX_CATERING_WEBHOOK_SECRET
 *   2. Wix Automations → Send HTTP Request (sin headers personalizados)
 *      Sin x-wix-catering-secret → se acepta payload de formulario Wix
 *
 * SECRETS (Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL              — inyectada automáticamente
 *   SUPABASE_SERVICE_ROLE_KEY — inyectada automáticamente; NUNCA en Wix ni frontend
 *   WIX_CATERING_WEBHOOK_SECRET — requerido solo si Wix envía x-wix-catering-secret
 *
 * OPCIONAL:
 *   WIX_CATERING_ALLOWED_ORIGIN — origen CORS (default: *)
 *
 * PAYLOAD OFICIAL (mapeo manual en Wix — ambos modos):
 *   customer_name, customer_phone, customer_email, event_date, event_time,
 *   event_location, event_type, guest_count, products_requested, notes
 *
 * PAYLOAD WIX AUTOMATIONS (detectado automáticamente):
 *   Estructura A — campos nativos del trigger Form Submitted:
 *     submitterName, submitterEmail, submitterPhone, formId, formName, submissionId
 *   Estructura B — arreglo de respuestas:
 *     fields | formFields | answers | submissions: [{ label|fieldLabel|key, value|fieldValue|answer }]
 *   Estructura C — contacto anidado:
 *     contact: { name, email, phone }
 *     submitter: { name, email, phone }
 *   Estructura D — envoltorio:
 *     data | payload | submission: { ...campos anteriores }
 *
 * Despliegue:
 *   supabase secrets set WIX_CATERING_WEBHOOK_SECRET=<token-largo>  # opcional para Automations
 *   supabase functions deploy wix-catering-request --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  CATERING_REQUEST_TEXT_FIELDS,
  repairSpanishRecord,
  repairSpanishText
} from "../_shared/repairSpanishText.ts"

const DEFAULT_CORS_ORIGIN = "*"

/** Nombres oficiales del contrato Wix → ERP */
const OFFICIAL_FIELDS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "event_date",
  "event_time",
  "event_location",
  "event_type",
  "guest_count",
  "products_requested",
  "notes"
] as const

type OfficialField = (typeof OFFICIAL_FIELDS)[number]

/** Aliases legacy; preferir siempre OFFICIAL_FIELDS en integraciones nuevas */
const FIELD_ALIASES: Record<OfficialField, string[]> = {
  customer_name: ["customerName", "nombre", "name", "submitterName", "contactName", "fullName", "fullname"],
  customer_phone: ["customerPhone", "phone", "telefono", "tel", "submitterPhone", "contactPhone", "mobile"],
  customer_email: ["customerEmail", "email", "correo", "submitterEmail", "contactEmail"],
  event_date: ["eventDate", "fecha_evento", "fecha", "fechaDelEvento", "event_date"],
  event_time: ["eventTime", "hora_evento", "hora", "horaDelEvento"],
  event_location: ["eventLocation", "ubicacion", "location", "lugar", "direccion"],
  event_type: ["eventType", "tipo_evento", "tipo", "tipoDeEvento"],
  guest_count: ["guestCount", "invitados", "personas", "numeroInvitados", "cantidadInvitados"],
  products_requested: ["productsRequested", "productos", "products", "servicios", "menu"],
  notes: ["notas", "comentarios", "message", "mensaje", "detalles", "observaciones"]
}

/** Etiquetas de campo Wix Forms (label → campo oficial) */
const WIX_FORM_LABEL_MAP: Record<string, OfficialField> = {
  nombre: "customer_name",
  name: "customer_name",
  "nombre completo": "customer_name",
  "full name": "customer_name",
  telefono: "customer_phone",
  teléfono: "customer_phone",
  phone: "customer_phone",
  celular: "customer_phone",
  email: "customer_email",
  correo: "customer_email",
  "correo electronico": "customer_email",
  "correo electrónico": "customer_email",
  "fecha del evento": "event_date",
  "fecha evento": "event_date",
  "event date": "event_date",
  fecha: "event_date",
  "hora del evento": "event_time",
  "hora evento": "event_time",
  "event time": "event_time",
  hora: "event_time",
  ubicacion: "event_location",
  ubicación: "event_location",
  location: "event_location",
  lugar: "event_location",
  "lugar del evento": "event_location",
  "tipo de evento": "event_type",
  "tipo evento": "event_type",
  "event type": "event_type",
  invitados: "guest_count",
  personas: "guest_count",
  "numero de invitados": "guest_count",
  "número de invitados": "guest_count",
  "guest count": "guest_count",
  productos: "products_requested",
  servicios: "products_requested",
  menu: "products_requested",
  menú: "products_requested",
  notas: "notes",
  comentarios: "notes",
  mensaje: "notes",
  detalles: "notes",
  observaciones: "notes"
}

const WIX_METADATA_KEYS = new Set([
  "formId",
  "formName",
  "submissionId",
  "submitterId",
  "submissionTime",
  "createdAt",
  "updatedAt",
  "contextId",
  "siteId",
  "revision",
  "triggerKey",
  "automationId"
])

const WIX_FIELD_ARRAY_KEYS = ["fields", "formFields", "answers", "submissions", "formFieldValues"] as const

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wix-catering-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
})

type WixPayload = Record<string, unknown>
type AuthMode = "wix_webhook" | "wix_automation"

type NormalizedCateringRequest = {
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  event_date: string | null
  event_time: string | null
  event_location: string | null
  event_type: string | null
  guest_count: number | null
  products_requested: string[]
  notes: string | null
  source: string
}

Deno.serve(async (req) => {
  const allowedOrigin = Deno.env.get("WIX_CATERING_ALLOWED_ORIGIN") || DEFAULT_CORS_ORIGIN
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
    return json(
      {
        success: false,
        error: "Funcion no configurada. Configure SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY como secrets."
      },
      500,
      headers
    )
  }

  const authResult = resolveAuthMode(req)
  if ("error" in authResult) {
    return json({ success: false, error: authResult.error }, authResult.status, headers)
  }

  const { mode } = authResult

  let body: WixPayload
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: "JSON invalido." }, 400, headers)
  }

  let canonicalBody: WixPayload
  try {
    canonicalBody = mode === "wix_automation" ? mapWixAutomationPayload(body) : body
  } catch (error) {
    return json(
      { success: false, error: error instanceof Error ? error.message : "Error al interpretar payload Wix." },
      400,
      headers
    )
  }

  const validationError = validatePayload(canonicalBody)
  if (validationError) {
    return json({ success: false, error: validationError }, 400, headers)
  }

  let normalized: NormalizedCateringRequest
  try {
    normalized = normalizePayload(canonicalBody, mode)
  } catch (error) {
    return json(
      { success: false, error: error instanceof Error ? error.message : "Error al normalizar datos." },
      400,
      headers
    )
  }

  console.log(
    JSON.stringify({
      source: mode === "wix_automation" ? "wix_automation" : "wix_webhook",
      payload_received: body,
      payload_normalized: normalized
    })
  )

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data, error } = await admin.rpc("create_catering_request", {
    p_data: normalized
  })

  if (error) {
    console.error("create_catering_request failed:", error.message)
    return json(
      { success: false, error: "No se pudo registrar la solicitud.", detail: error.message },
      500,
      headers
    )
  }

  return json(
    {
      success: true,
      request_id: data?.id ?? null,
      status: data?.status ?? "new",
      conversion_status: data?.conversion_status ?? "lead",
      lead_source: data?.lead_source ?? "website"
    },
    200,
    headers
  )
})

function resolveAuthMode(req: Request): { mode: AuthMode } | { error: string; status: number } {
  const incomingSecret = req.headers.get("x-wix-catering-secret")?.trim()

  if (!incomingSecret) {
    return { mode: "wix_automation" }
  }

  const webhookSecret = Deno.env.get("WIX_CATERING_WEBHOOK_SECRET")
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

  if (looksLikeWixAutomation(body) || hasMinimumLeadFields(canonical)) {
    return canonical
  }

  throw new Error(
    "Payload no reconocido como formulario Wix. Envie submitterName/submitterEmail o un arreglo fields con respuestas."
  )
}

function looksLikeWixAutomation(body: WixPayload): boolean {
  if (WIX_FIELD_ARRAY_KEYS.some((key) => Array.isArray(body[key]))) return true
  if (body.submitterName != null || body.submitterEmail != null || body.submitterPhone != null) return true
  if (isRecord(body.contact) || isRecord(body.submitter)) return true
  if (isRecord(body.data) || isRecord(body.payload) || isRecord(body.submission)) return true
  if (body.formId != null || body.formName != null || body.submissionId != null) return true
  return false
}

function hasMinimumLeadFields(body: WixPayload): boolean {
  return Boolean(pickOfficialString(body, "customer_name"))
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
    const nested = body[key]
    if (isRecord(nested)) sources.push(nested)
  }

  for (const key of ["contact", "submitter"] as const) {
    const nested = body[key]
    if (isRecord(nested)) {
      sources.push({
        customer_name: nested.name ?? nested.fullName ?? nested.submitterName,
        customer_email: nested.email ?? nested.submitterEmail,
        customer_phone: nested.phone ?? nested.submitterPhone
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
    if (value == null) continue
    if (typeof value === "object" && !Array.isArray(value)) continue
    entries.set(key, value)
  }
}

function absorbFieldArrays(source: WixPayload, entries: Map<string, unknown>) {
  for (const arrayKey of WIX_FIELD_ARRAY_KEYS) {
    const items = source[arrayKey]
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (!isRecord(item)) continue

      const label = pickFirstString(item, [
        "label",
        "fieldLabel",
        "title",
        "name",
        "key",
        "fieldKey",
        "id"
      ])
      const value = pickFirstValue(item, [
        "value",
        "fieldValue",
        "answer",
        "text",
        "stringValue",
        "values"
      ])

      if (!label || value == null) continue
      entries.set(label, normalizeFieldArrayValue(value))
    }
  }
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
  }

  return null
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function normalizeFieldArrayValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  return value
}

function validatePayload(body: WixPayload): string | null {
  const customerName = pickOfficialString(body, "customer_name")
  if (!customerName) {
    return "customer_name es obligatorio."
  }

  const phone = pickOfficialString(body, "customer_phone")
  const email = pickOfficialString(body, "customer_email")

  if (!phone && !email) {
    return "Debe enviar customer_phone o customer_email."
  }

  const guestCountRaw = pickOfficialValue(body, "guest_count")
  if (guestCountRaw != null && String(guestCountRaw).trim() !== "") {
    const guestCount = Number(guestCountRaw)
    if (!Number.isFinite(guestCount) || guestCount < 1) {
      return "guest_count debe ser un numero entero mayor a 0."
    }
  }

  const eventDateRaw = pickOfficialString(body, "event_date")
  if (eventDateRaw) {
    try {
      normalizeDate(eventDateRaw)
    } catch {
      return "event_date debe tener formato YYYY-MM-DD o DD/MM/YYYY."
    }
  }

  return null
}

function normalizePayload(body: WixPayload, mode: AuthMode): NormalizedCateringRequest {
  const customerName = repairSpanishText(pickOfficialString(body, "customer_name")!) as string
  const phone = pickOfficialString(body, "customer_phone")
  const email = pickOfficialString(body, "customer_email")
  const eventDateRaw = pickOfficialString(body, "event_date")
  const eventTimeRaw = pickOfficialString(body, "event_time")
  const guestCountRaw = pickOfficialValue(body, "guest_count")

  let guestCount: number | null = null
  if (guestCountRaw != null && String(guestCountRaw).trim() !== "") {
    guestCount = Math.trunc(Number(guestCountRaw))
  }

  return repairSpanishRecord(
    {
      customer_name: customerName,
      customer_phone: normalizePhone(phone),
      customer_email: normalizeEmail(email),
      event_date: eventDateRaw ? normalizeDate(eventDateRaw) : null,
      event_time: eventTimeRaw ? normalizeTime(eventTimeRaw) : null,
      event_location: pickOfficialString(body, "event_location"),
      event_type: pickOfficialString(body, "event_type"),
      guest_count: guestCount,
      products_requested: normalizeProducts(body),
      notes: pickOfficialString(body, "notes"),
      source: mode === "wix_automation" ? "wix_automation" : "wix_form"
    },
    CATERING_REQUEST_TEXT_FIELDS
  ) as NormalizedCateringRequest
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

function normalizePhone(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/[^\d+]/g, "")
  return digits || null
}

function normalizeEmail(value: string | null): string | null {
  if (!value) return null
  return value.trim().toLowerCase()
}

function normalizeDate(value: string): string {
  const trimmed = value.trim()
  if (isValidIsoDate(trimmed)) return trimmed

  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (slashMatch) {
    const [, day, month, year] = slashMatch
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }

  throw new Error("event_date no reconocido. Use YYYY-MM-DD.")
}

function normalizeTime(value: string): string {
  const trimmed = value.trim()
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return trimmed.slice(0, 5)
  }

  const amPm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (amPm) {
    let hours = Number(amPm[1])
    const minutes = amPm[2]
    const period = amPm[3].toLowerCase()
    if (period === "pm" && hours < 12) hours += 12
    if (period === "am" && hours === 12) hours = 0
    return `${String(hours).padStart(2, "0")}:${minutes}`
  }

  throw new Error("event_time no reconocido. Use HH:MM o HH:MM am/pm.")
}

function normalizeProducts(body: WixPayload): string[] {
  const raw = pickOfficialValue(body, "products_requested")
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime())
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
