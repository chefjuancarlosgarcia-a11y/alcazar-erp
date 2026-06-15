import { supabase } from "../../lib/supabase"

const BRANDING_BUCKET = "branding-assets"

export function resolveQuoteLogoUrl(quoteSettings = {}, branding = {}) {
  const quoteLogo = String(quoteSettings.logoUrl || quoteSettings.logo_url || "").trim()
  const brandingLogo = String(
    branding.logoUrl
    || branding.logo_url
    || branding.compactLogoUrl
    || branding.compact_logo_url
    || ""
  ).trim()
  return quoteLogo || brandingLogo
}

export function extractBrandingAssetPath(url) {
  if (!url) return null
  const text = String(url)
  const patterns = [
    /\/storage\/v1\/object\/public\/branding-assets\/(.+)$/i,
    /\/storage\/v1\/object\/sign\/branding-assets\/(.+?)(?:\?|$)/i,
    /\/storage\/v1\/object\/authenticated\/branding-assets\/(.+?)(?:\?|$)/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return decodeURIComponent(match[1])
  }
  return null
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function rasterizeImageDataUrl(dataUrl) {
  if (typeof document === "undefined") return dataUrl
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      const width = image.naturalWidth || 256
      const height = image.naturalHeight || 256
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) {
        resolve(dataUrl)
        return
      }
      context.drawImage(image, 0, 0, width, height)
      resolve(canvas.toDataURL("image/png"))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

export async function loadQuoteLogoDataUrl(logoUrl) {
  if (!logoUrl) return null

  const path = extractBrandingAssetPath(logoUrl)
  if (path && supabase) {
    const { data, error } = await supabase.storage.from(BRANDING_BUCKET).download(path)
    if (!error && data) {
      try {
        const dataUrl = await blobToDataUrl(data)
        if (String(dataUrl).includes("image/svg") || String(logoUrl).toLowerCase().includes(".svg")) {
          return rasterizeImageDataUrl(dataUrl)
        }
        return dataUrl
      } catch {
        // fallback to fetch
      }
    }
  }

  try {
    const response = await fetch(logoUrl)
    if (!response.ok) return null
    const dataUrl = await blobToDataUrl(await response.blob())
    if (String(dataUrl).includes("image/svg")) {
      return rasterizeImageDataUrl(dataUrl)
    }
    return dataUrl
  } catch {
    return null
  }
}

export function detectImageFormat(dataUrl, fallbackUrl = "") {
  const source = String(dataUrl || fallbackUrl).toLowerCase()
  if (source.includes("image/jpeg") || source.includes("image/jpg")) return "JPEG"
  if (source.includes("image/webp")) return "WEBP"
  if (source.includes("image/svg")) return "SVG"
  return "PNG"
}
