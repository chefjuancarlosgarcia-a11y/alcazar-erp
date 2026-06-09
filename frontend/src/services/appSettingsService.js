import { BRANDING } from "../branding"
import { supabase } from "../lib/supabase"
import { DEFAULT_THEME_TOKENS, normalizeBrandingDraft, PRESET_THEMES } from "../utils/brandingTheme"

export const BRANDING_SETTINGS_KEY = "system_branding"
const LOCAL_KEY = "app-setting:system_branding"
const BRANDING_BUCKET = "branding-assets"
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"]

export const DEFAULT_BRANDING_SETTINGS = normalizeBrandingDraft({
  commercialName: BRANDING.appName,
  subtitle: BRANDING.tagline,
  logoUrl: BRANDING.logoUrl,
  compactLogoUrl: "",
  monogram: BRANDING.monogram,
  primaryColor: BRANDING.accentColor,
  accentColor: BRANDING.accentColor,
  secondaryColor: DEFAULT_THEME_TOKENS.secondaryColor,
  backgroundColor: DEFAULT_THEME_TOKENS.backgroundColor,
  surfaceColor: DEFAULT_THEME_TOKENS.surfaceColor,
  successColor: DEFAULT_THEME_TOKENS.successColor,
  warningColor: DEFAULT_THEME_TOKENS.warningColor,
  dangerColor: DEFAULT_THEME_TOKENS.dangerColor,
  textPrimary: DEFAULT_THEME_TOKENS.textPrimary,
  textSecondary: DEFAULT_THEME_TOKENS.textSecondary,
  presetTheme: "alcazar",
  paletteVariant: "corporate",
  themeMode: "dark",
  density: "normal",
  borderStyle: "soft"
})

function normalizeBranding(value = {}) {
  const draft = normalizeBrandingDraft({
    ...DEFAULT_BRANDING_SETTINGS,
    ...value,
    commercialName: value.commercialName || value.appName || DEFAULT_BRANDING_SETTINGS.commercialName,
    subtitle: value.subtitle || value.tagline || DEFAULT_BRANDING_SETTINGS.subtitle,
    logoUrl: String(value.logoUrl || value.logo_url || "").trim(),
    compactLogoUrl: String(value.compactLogoUrl || value.compact_logo_url || "").trim(),
    primaryColor: value.primaryColor || value.primary_color || value.accentColor || value.accent_color,
    accentColor: value.accentColor || value.accent_color || value.primaryColor || value.primary_color
  })
  return draft
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

export async function uploadBrandingLogo(file, variant = "main") {
  if (!file) return { data: "", error: null }
  if (!supabase) return { data: "", error: { message: "Supabase Storage no esta configurado." } }
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { data: "", error: { message: "Formato no permitido. Usa PNG, JPG o SVG." } }
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "png"
  const folder = variant === "compact" ? "compact" : "main"
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type
  })
  if (error) return { data: "", error }
  const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path)
  return { data: data?.publicUrl || "", error: null }
}

export { PRESET_THEMES }
