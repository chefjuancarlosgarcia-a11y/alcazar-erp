import { supabase } from "../../lib/supabase"
import { DEFAULT_QUOTE_TERMS } from "./cateringQuoteTemplates"
import { repairCateringCompanySettings } from "./cateringTextEncoding"

const BRANDING_BUCKET = "branding-assets"
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"]

function result(data, error = null) {
  return {
    data,
    error: error ? (typeof error === "string" ? error : error.message || "Error de configuracion.") : ""
  }
}

export const DEFAULT_QUOTE_SETTINGS = {
  commercialName: "Pizzeria El Gran Alcazar",
  logoUrl: "",
  address: "",
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  nit: "",
  headerText: "Cotización de Catering",
  defaultTerms: DEFAULT_QUOTE_TERMS,
  pricesIncludeVat: true
}

export function buildCompanyFooterLines(company = {}) {
  const lines = []
  if (company.commercialName) lines.push(company.commercialName)
  if (company.nit) lines.push(`NIT: ${company.nit}`)
  if (company.address) lines.push(company.address)
  const contacts = [
    company.phone ? `Tel: ${company.phone}` : "",
    company.whatsapp ? `WhatsApp: ${company.whatsapp}` : "",
    company.email ? company.email : "",
    company.website ? company.website : ""
  ].filter(Boolean)
  if (contacts.length) lines.push(contacts.join(" · "))
  return lines
}

export async function getCateringQuoteSettings() {
  const { data, error } = await supabase.rpc("get_catering_quote_settings")
  return result(repairCateringCompanySettings({ ...DEFAULT_QUOTE_SETTINGS, ...(data || {}) }), error)
}

export async function saveCateringQuoteSettings(settings) {
  const { data, error } = await supabase.rpc("save_catering_quote_settings", {
    p_settings: settings
  })
  return result(repairCateringCompanySettings({ ...DEFAULT_QUOTE_SETTINGS, ...(data || {}) }), error)
}

export async function uploadCateringQuoteLogo(file) {
  if (!file) return result("", null)
  if (!supabase) return result("", "Supabase Storage no esta configurado.")
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return result("", "Formato no permitido. Usa PNG, JPG, WEBP o SVG.")
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "png"
  const path = `catering-quotes/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type
  })
  if (error) return result("", error)
  const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path)
  return result(data?.publicUrl || "", null)
}

export function mergeQuoteSettings(quoteSettings, branding = {}) {
  const brandingLogo = branding.logoUrl || branding.logo_url || ""
  return {
    ...DEFAULT_QUOTE_SETTINGS,
    ...quoteSettings,
    logoUrl: quoteSettings?.logoUrl ?? brandingLogo,
    commercialName:
      quoteSettings?.commercialName
      || branding.commercialName
      || branding.appName
      || DEFAULT_QUOTE_SETTINGS.commercialName
  }
}
