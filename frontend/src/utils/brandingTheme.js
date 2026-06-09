/** Theme tokens, palette generation, and CSS variable application for ERP branding. */

export const DEFAULT_THEME_TOKENS = {
  primaryColor: "#14b8a6",
  secondaryColor: "#0f766e",
  accentColor: "#2dd4bf",
  backgroundColor: "#071023",
  surfaceColor: "#0f172a",
  successColor: "#22c55e",
  warningColor: "#f59e0b",
  dangerColor: "#ef4444",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8"
}

export const PRESET_THEMES = {
  alcazar: {
    id: "alcazar",
    label: "Tema Alcázar",
    primaryColor: "#14b8a6",
    secondaryColor: "#0f766e",
    accentColor: "#2dd4bf",
    backgroundColor: "#071023",
    surfaceColor: "#0f172a",
    themeMode: "dark"
  },
  restaurant: {
    id: "restaurant",
    label: "Tema Restaurante",
    primaryColor: "#ea580c",
    secondaryColor: "#9a3412",
    accentColor: "#fbbf24",
    backgroundColor: "#1c1208",
    surfaceColor: "#291a0d",
    themeMode: "dark"
  },
  corporate: {
    id: "corporate",
    label: "Tema Corporativo",
    primaryColor: "#2563eb",
    secondaryColor: "#1e3a8a",
    accentColor: "#60a5fa",
    backgroundColor: "#0b1220",
    surfaceColor: "#111827",
    themeMode: "dark"
  },
  dark: {
    id: "dark",
    label: "Tema Oscuro",
    primaryColor: "#64748b",
    secondaryColor: "#334155",
    accentColor: "#94a3b8",
    backgroundColor: "#020617",
    surfaceColor: "#0f172a",
    themeMode: "dark"
  },
  modern: {
    id: "modern",
    label: "Tema Moderno",
    primaryColor: "#8b5cf6",
    secondaryColor: "#6d28d9",
    accentColor: "#c4b5fd",
    backgroundColor: "#120a24",
    surfaceColor: "#1e1035",
    themeMode: "dark"
  }
}

const DENSITY_SCALE = { compact: 0.88, normal: 1, comfortable: 1.12 }
const BORDER_RADIUS = { square: "6px", soft: "12px", modern: "18px" }

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function hexToRgb(hex) {
  const normalized = String(hex || "").replace("#", "").trim()
  if (normalized.length === 3) {
    return {
      r: parseInt(normalized[0] + normalized[0], 16),
      g: parseInt(normalized[1] + normalized[1], 16),
      b: parseInt(normalized[2] + normalized[2], 16)
    }
  }
  if (normalized.length !== 6) return { r: 20, g: 184, b: 166 }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  }
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0")).join("")}`
}

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (delta) {
    s = delta / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r: h = ((g - b) / delta) % 6; break
      case g: h = (b - r) / delta + 2; break
      default: h = (r - g) / delta + 4; break
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: s * 100, l: l * 100 }
}

function hslToHex(h, s, l) {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export function normalizeHexColor(value, fallback = DEFAULT_THEME_TOKENS.primaryColor) {
  const raw = String(value || "").trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase()
  }
  return fallback
}

function shiftHex(hex, { h = 0, s = 0, l = 0 } = {}) {
  const { r, g, b } = hexToRgb(hex)
  const hsl = rgbToHsl(r, g, b)
  return hslToHex((hsl.h + h + 360) % 360, clamp(hsl.s + s, 0, 100), clamp(hsl.l + l, 0, 100))
}

function paletteFromPrimary(primaryHex, variant) {
  const primary = normalizeHexColor(primaryHex)
  if (variant === "corporate") {
    return {
      primaryColor: primary,
      secondaryColor: shiftHex(primary, { l: -14, s: 8 }),
      accentColor: shiftHex(primary, { l: 18, s: -6 }),
      backgroundColor: shiftHex(primary, { l: -42, s: -20 }),
      surfaceColor: shiftHex(primary, { l: -34, s: -16 })
    }
  }
  if (variant === "modern") {
    return {
      primaryColor: primary,
      secondaryColor: shiftHex(primary, { h: 18, l: -8 }),
      accentColor: shiftHex(primary, { h: -24, l: 22, s: 10 }),
      backgroundColor: "#0a1020",
      surfaceColor: shiftHex(primary, { l: -38, s: -28 })
    }
  }
  return {
    primaryColor: primary,
    secondaryColor: shiftHex(primary, { l: -22, s: -10 }),
    accentColor: shiftHex(primary, { l: 12 }),
    backgroundColor: "#020617",
    surfaceColor: shiftHex(primary, { l: -36, s: -24 })
  }
}

export function generatePaletteVariants(primaryHex) {
  return {
    corporate: { id: "corporate", label: "Corporativo", ...paletteFromPrimary(primaryHex, "corporate") },
    modern: { id: "modern", label: "Moderno", ...paletteFromPrimary(primaryHex, "modern") },
    dark: { id: "dark", label: "Oscuro", ...paletteFromPrimary(primaryHex, "dark") }
  }
}

export function resolveBrandingTokens(branding = {}) {
  const themeMode = branding.themeMode === "light" ? "light" : "dark"
  const base = {
    ...DEFAULT_THEME_TOKENS,
    primaryColor: normalizeHexColor(branding.primaryColor || branding.accentColor),
    secondaryColor: normalizeHexColor(branding.secondaryColor, DEFAULT_THEME_TOKENS.secondaryColor),
    accentColor: normalizeHexColor(branding.accentColor || branding.primaryColor),
    backgroundColor: branding.backgroundColor || DEFAULT_THEME_TOKENS.backgroundColor,
    surfaceColor: branding.surfaceColor || DEFAULT_THEME_TOKENS.surfaceColor,
    successColor: normalizeHexColor(branding.successColor, DEFAULT_THEME_TOKENS.successColor),
    warningColor: normalizeHexColor(branding.warningColor, DEFAULT_THEME_TOKENS.warningColor),
    dangerColor: normalizeHexColor(branding.dangerColor, DEFAULT_THEME_TOKENS.dangerColor),
    textPrimary: branding.textPrimary || DEFAULT_THEME_TOKENS.textPrimary,
    textSecondary: branding.textSecondary || DEFAULT_THEME_TOKENS.textSecondary
  }

  if (themeMode === "light") {
    base.backgroundColor = branding.backgroundColor || "#f8fafc"
    base.surfaceColor = branding.surfaceColor || "#ffffff"
    base.textPrimary = branding.textPrimary || "#0f172a"
    base.textSecondary = branding.textSecondary || "#64748b"
  }

  const density = DENSITY_SCALE[branding.density] || 1
  const radius = BORDER_RADIUS[branding.borderStyle] || BORDER_RADIUS.soft

  return {
    ...base,
    themeMode,
    densityScale: String(density),
    borderRadius: radius,
    borderRadiusSm: branding.borderStyle === "square" ? "4px" : branding.borderStyle === "modern" ? "14px" : "8px"
  }
}

const CSS_VAR_MAP = {
  primaryColor: "--erp-primary-color",
  secondaryColor: "--erp-secondary-color",
  accentColor: "--erp-accent-color",
  backgroundColor: "--erp-background-color",
  surfaceColor: "--erp-surface-color",
  successColor: "--erp-success-color",
  warningColor: "--erp-warning-color",
  dangerColor: "--erp-danger-color",
  textPrimary: "--erp-text-primary",
  textSecondary: "--erp-text-secondary",
  borderRadius: "--erp-border-radius",
  borderRadiusSm: "--erp-border-radius-sm",
  densityScale: "--erp-density-scale"
}

export function applyBrandingTheme(branding, target = document.documentElement) {
  if (!target) return
  const tokens = resolveBrandingTokens(branding)
  Object.entries(CSS_VAR_MAP).forEach(([key, cssVar]) => {
    if (tokens[key] != null) target.style.setProperty(cssVar, tokens[key])
  })
  target.style.setProperty("--sidebar-accent", tokens.primaryColor)
  target.style.setProperty("--accent", tokens.primaryColor)
  target.dataset.erpThemeMode = tokens.themeMode
  target.dataset.erpDensity = branding.density || "normal"
  target.dataset.erpBorderStyle = branding.borderStyle || "soft"
}

export function brandingTokensEqual(a, b) {
  return JSON.stringify(resolveBrandingTokens(a)) === JSON.stringify(resolveBrandingTokens(b))
    && JSON.stringify(normalizeBrandingDraft(a)) === JSON.stringify(normalizeBrandingDraft(b))
}

export function normalizeBrandingDraft(value = {}) {
  return {
    commercialName: String(value.commercialName || "").trim(),
    subtitle: String(value.subtitle || "").trim(),
    logoUrl: String(value.logoUrl || "").trim(),
    compactLogoUrl: String(value.compactLogoUrl || "").trim(),
    monogram: String(value.monogram || "GA").trim().slice(0, 3).toUpperCase(),
    presetTheme: value.presetTheme || "custom",
    paletteVariant: value.paletteVariant || "corporate",
    themeMode: value.themeMode === "light" ? "light" : "dark",
    density: ["compact", "normal", "comfortable"].includes(value.density) ? value.density : "normal",
    borderStyle: ["square", "soft", "modern"].includes(value.borderStyle) ? value.borderStyle : "soft",
    primaryColor: normalizeHexColor(value.primaryColor || value.accentColor),
    secondaryColor: normalizeHexColor(value.secondaryColor, DEFAULT_THEME_TOKENS.secondaryColor),
    accentColor: normalizeHexColor(value.accentColor || value.primaryColor),
    backgroundColor: value.backgroundColor || DEFAULT_THEME_TOKENS.backgroundColor,
    surfaceColor: value.surfaceColor || DEFAULT_THEME_TOKENS.surfaceColor,
    successColor: normalizeHexColor(value.successColor, DEFAULT_THEME_TOKENS.successColor),
    warningColor: normalizeHexColor(value.warningColor, DEFAULT_THEME_TOKENS.warningColor),
    dangerColor: normalizeHexColor(value.dangerColor, DEFAULT_THEME_TOKENS.dangerColor),
    textPrimary: value.textPrimary || DEFAULT_THEME_TOKENS.textPrimary,
    textSecondary: value.textSecondary || DEFAULT_THEME_TOKENS.textSecondary
  }
}

export async function extractColorsFromImageFile(file) {
  const objectUrl = URL.createObjectURL(file)
  try {
    return await extractColorsFromImageUrl(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function extractColorsFromImageUrl(url) {
  const image = await loadImage(url)
  const canvas = document.createElement("canvas")
  const size = 72
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  const buckets = new Map()

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]
    if (alpha < 40) continue
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    const hsl = rgbToHsl(r, g, b)
    if (hsl.l > 92 || hsl.l < 8 || hsl.s < 8) continue
    const key = `${Math.round(hsl.h / 20)}-${Math.round(hsl.s / 25)}-${Math.round(hsl.l / 18)}`
    const hex = rgbToHex(r, g, b)
    const current = buckets.get(key) || { hex, count: 0, score: 0 }
    current.count += 1
    current.score += hsl.s
    buckets.set(key, current)
  }

  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count || b.score - a.score)
  const dominant = ranked[0]?.hex || DEFAULT_THEME_TOKENS.primaryColor
  const secondary = ranked[1]?.hex || shiftHex(dominant, { l: -16 })
  const accent = ranked[2]?.hex || shiftHex(dominant, { l: 18, h: 20 })

  return {
    dominant,
    secondary,
    accent,
    palettes: generatePaletteVariants(dominant)
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

export function applyPresetTheme(presetId) {
  const preset = PRESET_THEMES[presetId]
  if (!preset) return null
  return {
    ...normalizeBrandingDraft(preset),
    presetTheme: presetId,
    paletteVariant: presetId === "dark" ? "dark" : presetId === "modern" ? "modern" : "corporate"
  }
}
