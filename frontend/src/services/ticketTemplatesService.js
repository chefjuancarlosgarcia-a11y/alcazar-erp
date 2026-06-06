import { supabase } from "../lib/supabase"

const CACHE_KEY = "ticket-templates:active"

export const TICKET_TEMPLATE_TYPES = [
  { key: "prebill", label: "Precuenta" },
  { key: "final_bill", label: "Cuenta final" },
  { key: "delivery", label: "Delivery" },
  { key: "takeout", label: "Para llevar" }
]

export const DEFAULT_TICKET_SETTINGS = {
  blocks: {
    showHeader: true,
    showBusiness: true,
    showOrderInfo: true,
    showCustomer: true,
    showProducts: true,
    showTotals: true,
    showMessages: true,
    showCoupon: false,
    showQr: false,
    showFinalText: true
  },
  business: {
    showLogo: true,
    logoUrl: "",
    logoSize: "medium",
    businessName: "El Gran Alcazar",
    showBusinessName: true,
    subtitle: "Pizza artesanal",
    showSubtitle: true,
    nit: "",
    showNit: false,
    address: "4ta avenida 2-74 zona 9, Colonia La Floresta, Quetzaltenango",
    showAddress: true,
    phone: "54579882",
    showPhone: true,
    website: "www.elgranalcazarpizza.com",
    showWebsite: true,
    instagram: "@elgranalcazar",
    showInstagram: true
  },
  layout: {
    fontSize: "medium",
    fontFamily: "monospace",
    alignment: "center",
    showDividers: true,
    dividerStyle: "dashed",
    showEmojis: false,
    compactMode: false
  },
  orderInfo: {
    showOrderId: true,
    showDate: true,
    showCashier: true,
    showWaiter: true,
    showTable: true,
    showSalesChannel: true,
    showPaymentMethod: true,
    showCustomerName: true,
    showCustomerPhone: true,
    showDeliveryAddress: true,
    showDeliveryReference: true,
    showMapsLink: true,
    showDeliveryNotes: true
  },
  items: {
    showItemModifiers: true,
    showItemNotes: true,
    showUnitPrice: true,
    showQuantity: true,
    showLineTotal: true
  },
  totals: {
    showSubtotal: true,
    showDiscounts: true,
    showTax: false,
    showServiceCharge: false,
    showTipSuggestion: false,
    tipSuggestions: [5, 10, 15],
    showTotal: true
  },
  messages: {
    headerMessage: "",
    footerMessage: "Gracias por visitarnos.",
    deliveryMessage: "Gracias por tu pedido. Nuestro repartidor se comunicara contigo.",
    reviewMessage: "Dejanos tu resena en Google.",
    vipMessage: "Unete a nuestro Club VIP y gana beneficios."
  },
  coupon: {
    enabled: false,
    title: "Vuelve pronto",
    code: "PIZZA10",
    description: "10% de descuento en tu proxima orden en linea.",
    expiresText: "Valido por 15 dias.",
    showCouponBox: true
  },
  qr: {
    enabled: false,
    type: "vip",
    url: "https://www.elgranalcazarpizza.com/my-rewards",
    label: "Unete al Club VIP",
    showQr: true
  },
  print: {
    autoPrint: false,
    showBrowserHeaderFooter: false,
    cutPaperHint: true,
    openCashDrawerAfterPrint: false
  }
}

function mergeSettings(settings = {}) {
  return {
    blocks: { ...DEFAULT_TICKET_SETTINGS.blocks, ...(settings.blocks || {}) },
    business: { ...DEFAULT_TICKET_SETTINGS.business, ...(settings.business || {}) },
    layout: { ...DEFAULT_TICKET_SETTINGS.layout, ...(settings.layout || {}) },
    orderInfo: { ...DEFAULT_TICKET_SETTINGS.orderInfo, ...(settings.orderInfo || {}) },
    items: { ...DEFAULT_TICKET_SETTINGS.items, ...(settings.items || {}) },
    totals: { ...DEFAULT_TICKET_SETTINGS.totals, ...(settings.totals || {}) },
    messages: { ...DEFAULT_TICKET_SETTINGS.messages, ...(settings.messages || {}) },
    coupon: { ...DEFAULT_TICKET_SETTINGS.coupon, ...(settings.coupon || {}) },
    qr: { ...DEFAULT_TICKET_SETTINGS.qr, ...(settings.qr || {}) },
    print: { ...DEFAULT_TICKET_SETTINGS.print, ...(settings.print || {}) }
  }
}

export function defaultTicketTemplate(templateKey = "prebill") {
  const type = TICKET_TEMPLATE_TYPES.find((item) => item.key === templateKey) || TICKET_TEMPLATE_TYPES[0]
  return {
    id: "",
    template_key: type.key,
    name: `${type.label} default`,
    description: "",
    paper_width: "80mm",
    is_default: true,
    status: "active",
    settings: mergeSettings()
  }
}

export function normalizeTicketTemplate(row = {}) {
  return {
    ...defaultTicketTemplate(row.template_key || "prebill"),
    ...row,
    paper_width: row.paper_width || "80mm",
    is_default: row.is_default ?? true,
    status: row.status || "active",
    settings: mergeSettings(row.settings || {})
  }
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")
  } catch {
    return {}
  }
}

function writeCache(templates = []) {
  const next = readCache()
  templates.forEach((template) => {
    next[template.template_key] = normalizeTicketTemplate(template)
  })
  localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent("ticket-templates-updated", { detail: next }))
  return next
}

export function getCachedTicketTemplate(templateKey) {
  const cached = readCache()
  return cached[templateKey] ? normalizeTicketTemplate(cached[templateKey]) : null
}

export async function listTicketTemplates() {
  if (!supabase) return { data: Object.values(readCache()).map(normalizeTicketTemplate), error: null, source: "local" }
  const { data, error } = await supabase
    .from("ticket_templates")
    .select("*")
    .order("template_key", { ascending: true })
    .order("is_default", { ascending: false })
  if (error) return { data: Object.values(readCache()).map(normalizeTicketTemplate), error, source: "local" }
  const normalized = (data || []).map(normalizeTicketTemplate)
  writeCache(normalized.filter((template) => template.status === "active" && template.is_default))
  return { data: normalized, error: null, source: "supabase" }
}

export async function getActiveTicketTemplate(templateKey) {
  const fallback = getCachedTicketTemplate(templateKey) || defaultTicketTemplate(templateKey)
  if (!supabase) return { data: fallback, error: null, source: "local" }
  const { data, error } = await supabase
    .from("ticket_templates")
    .select("*")
    .eq("template_key", templateKey)
    .eq("status", "active")
    .eq("is_default", true)
    .maybeSingle()
  if (error || !data) return { data: fallback, error, source: "local" }
  const normalized = normalizeTicketTemplate(data)
  writeCache([normalized])
  return { data: normalized, error: null, source: "supabase" }
}

export function validateTicketTemplate(template) {
  if (!template?.template_key) return "Selecciona el tipo de plantilla."
  if (!String(template.name || "").trim()) return "El nombre de la plantilla es obligatorio."
  const qr = template.settings?.qr || {}
  const blocks = template.settings?.blocks || {}
  if (blocks.showQr && qr.enabled && qr.url && !/^https?:\/\//i.test(qr.url)) return "La URL del QR debe iniciar con http:// o https://."
  const coupon = template.settings?.coupon || {}
  if (blocks.showCoupon && coupon.enabled && !String(coupon.code || coupon.description || "").trim()) return "El cupon requiere codigo o descripcion."
  return ""
}

export async function saveTicketTemplate(template) {
  const normalized = normalizeTicketTemplate(template)
  const validation = validateTicketTemplate(normalized)
  if (validation) return { data: null, error: { message: validation }, message: validation }
  writeCache([normalized])
  if (!supabase) return { data: normalized, error: null, source: "local" }
  const payload = {
    id: normalized.id || null,
    template_key: normalized.template_key,
    name: normalized.name,
    description: normalized.description || null,
    paper_width: normalized.paper_width,
    is_default: normalized.is_default,
    status: normalized.status,
    settings: normalized.settings
  }
  const { data, error } = await supabase.rpc("save_ticket_template", { p_data: payload })
  if (error) return { data: normalized, error, message: error.message, source: "local" }
  const saved = normalizeTicketTemplate(data)
  writeCache([saved])
  return { data: saved, error: null, source: "supabase" }
}

export async function uploadTicketAsset(file) {
  if (!file) return { data: "", error: null }
  if (!supabase) return { data: "", error: { message: "Supabase Storage no esta configurado." } }
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]
  if (!allowed.includes(file.type)) return { data: "", error: { message: "Formato no permitido. Usa png, jpg, webp o svg." } }
  const extension = file.name.split(".").pop() || "png"
  const path = `logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
  const { error } = await supabase.storage.from("ticket-assets").upload(path, file, { upsert: false })
  if (error) return { data: "", error }
  const { data } = supabase.storage.from("ticket-assets").getPublicUrl(path)
  return { data: data?.publicUrl || "", error: null }
}
