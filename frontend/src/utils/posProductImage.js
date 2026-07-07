import { compressInventoryImageFile, revokeCompressedImagePreview } from "./imageCompression"

export const POS_IMAGE_MAX_DIMENSION = 800
export const POS_IMAGE_TARGET_BYTES = 300 * 1024
export const POS_IMAGE_HEAVY_WARNING_BYTES = 5 * 1024 * 1024
export const POS_IMAGE_LOG_PREFIX = "[POS image]"

export function formatImageBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

export function logPosImageMetrics({ originalSize, optimizedSize, storage = "pending" }) {
  const ratio = originalSize > 0 ? 1 - optimizedSize / originalSize : 0
  console.info(POS_IMAGE_LOG_PREFIX, "original_size", originalSize, `(${formatImageBytes(originalSize)})`)
  console.info(POS_IMAGE_LOG_PREFIX, "optimized_size", optimizedSize, `(${formatImageBytes(optimizedSize)})`)
  console.info(POS_IMAGE_LOG_PREFIX, "compression_ratio", `${(ratio * 100).toFixed(1)}%`)
  if (storage) console.info(POS_IMAGE_LOG_PREFIX, "storage", storage)
}

export function isInlineImageValue(value) {
  return String(value || "").startsWith("data:")
}

export function isPublicImageUrl(value) {
  const url = String(value || "").trim()
  return url.startsWith("http://") || url.startsWith("https://")
}

/**
 * Optimizes a POS dish image for catalog storage (max 800px, WebP/JPG ~70–80%).
 */
export async function compressPosProductImageFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("El archivo seleccionado no es una imagen válida.")
  }

  const warnings = []
  if (file.size > POS_IMAGE_HEAVY_WARNING_BYTES) {
    warnings.push("La imagen es pesada. El sistema la optimizará antes de guardarla.")
  }

  let quality = 0.8
  let maxDimension = POS_IMAGE_MAX_DIMENSION
  let result = null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    result = await compressInventoryImageFile(file, {
      maxDimension,
      quality,
      maxBytes: null
    })
    if (result.compressedSize <= POS_IMAGE_TARGET_BYTES) break
    quality -= 0.08
    if (quality < 0.58) {
      maxDimension = 640
      quality = 0.72
    }
  }

  logPosImageMetrics({
    originalSize: result.originalSize,
    optimizedSize: result.compressedSize,
    storage: "client-optimized"
  })

  if (result.compressedSize > POS_IMAGE_TARGET_BYTES) {
    warnings.push(
      `Imagen optimizada a ${formatImageBytes(result.compressedSize)} (objetivo ${formatImageBytes(POS_IMAGE_TARGET_BYTES)}).`
    )
  }

  return { ...result, warnings }
}

export async function blobFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl)
  return response.blob()
}

export function revokePosImagePreview(previewUrl) {
  revokeCompressedImagePreview(previewUrl)
}
