import { BRANDING } from "../branding"
import { supabase } from "../lib/supabase"

export const BRANDING_SETTINGS_KEY = "system_branding"
const LOCAL_KEY = "app-setting:system_branding"

export const DEFAULT_BRANDING_SETTINGS = {
  commercialName: BRANDING.appName,
  subtitle: BRANDING.tagline,
  logoUrl: BRANDING.logoUrl,
  accentColor: BRANDING.accentColor,
  monogram: BRANDING.monogram
}

function normalizeBranding(value = {}) {
  return {
    ...DEFAULT_BRANDING_SETTINGS,
    ...value,
    commercialName: String(value.commercialName || value.appName || DEFAULT_BRANDING_SETTINGS.commercialName).trim() || DEFAULT_BRANDING_SETTINGS.commercialName,
    subtitle: String(value.subtitle || value.tagline || DEFAULT_BRANDING_SETTINGS.subtitle).trim() || DEFAULT_BRANDING_SETTINGS.subtitle,
    logoUrl: String(value.logoUrl || value.logo_url || "").trim(),
    accentColor: String(value.accentColor || value.accent_color || DEFAULT_BRANDING_SETTINGS.accentColor).trim() || DEFAULT_BRANDING_SETTINGS.accentColor,
    monogram: String(value.monogram || DEFAULT_BRANDING_SETTINGS.monogram).trim().slice(0, 3).toUpperCase() || DEFAULT_BRANDING_SETTINGS.monogram
  }
}

function readLocalBranding() {
  try {
    return normalizeBranding(JSON.parse(localStorage.getItem(LOCAL_KEY) || "null") || {})
  } catch {
    return DEFAULT_BRANDING_SETTINGS
  }
}

export async function getBrandingSettings() {
  const fallback = readLocalBranding()
  if (!supabase) return { data: fallback, error: null, source: "local" }
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", BRANDING_SETTINGS_KEY)
    .maybeSingle()
  if (error) {
    console.warn("[Settings] No se pudo leer branding desde Supabase.", error)
    return { data: fallback, error, source: "local" }
  }
  const normalized = normalizeBranding(data?.value || fallback)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(normalized))
  return { data: normalized, error: null, source: data ? "supabase" : "local" }
}

export async function saveBrandingSettings(settings) {
  const normalized = normalizeBranding(settings)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent("branding-updated", { detail: normalized }))
  if (!supabase) return { data: normalized, error: null, source: "local" }
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: BRANDING_SETTINGS_KEY, value: normalized }, { onConflict: "key" })
  if (error) {
    console.warn("[Settings] No se pudo guardar branding en Supabase.", error)
    return { data: normalized, error, source: "local" }
  }
  return { data: normalized, error: null, source: "supabase" }
}
