import { supabase } from "../lib/supabase"
import {
  blobFromDataUrl,
  compressPosProductImageFile,
  isInlineImageValue,
  isPublicImageUrl,
  logPosImageMetrics,
  POS_IMAGE_LOG_PREFIX
} from "../utils/posProductImage"

export const POS_PRODUCT_IMAGES_BUCKET = "pos-product-images"

function buildStoragePath(productId, extension) {
  const folder = productId ? `products/${productId}` : `products/draft/${crypto.randomUUID()}`
  return `${folder}/${Date.now()}.${extension}`
}

export async function uploadPOSProductImage(file, { productId = null } = {}) {
  if (!file) return { data: null, error: new Error("No hay archivo de imagen para subir.") }

  const allowed = ["image/jpeg", "image/png", "image/webp"]
  if (!allowed.includes(file.type)) {
    return { data: null, error: new Error("Formato no permitido. Usa JPG, PNG o WebP optimizado.") }
  }
  if (file.size > 2 * 1024 * 1024) {
    return { data: null, error: new Error("La imagen optimizada supera 2 MB. Prueba con otra foto.") }
  }

  const extension = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg"
  const path = buildStoragePath(productId, extension)

  const { error } = await supabase.storage
    .from(POS_PRODUCT_IMAGES_BUCKET)
    .upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: true
    })

  if (error) {
    console.error(POS_IMAGE_LOG_PREFIX, "upload_error", error.message)
    return { data: null, error }
  }

  const { data: urlData } = supabase.storage.from(POS_PRODUCT_IMAGES_BUCKET).getPublicUrl(path)
  console.info(POS_IMAGE_LOG_PREFIX, "storage", "uploaded", { path, publicUrl: urlData.publicUrl })
  return { data: { path, publicUrl: urlData.publicUrl }, error: null }
}

/**
 * Resolves the image_url to persist — never returns base64.
 */
export async function resolvePOSProductImageForSave({
  imageFile = null,
  previewUrl = "",
  productId = null,
  removeImage = false
} = {}) {
  if (removeImage) return { url: null, error: null, migratedFromInline: false }

  if (imageFile) {
    const upload = await uploadPOSProductImage(imageFile, { productId })
    if (upload.error) return { url: null, error: upload.error, migratedFromInline: false }
    return { url: upload.data.publicUrl, error: null, migratedFromInline: false }
  }

  const current = String(previewUrl || "").trim()
  if (!current) return { url: null, error: null, migratedFromInline: false }
  if (isPublicImageUrl(current)) return { url: current, error: null, migratedFromInline: false }

  if (isInlineImageValue(current)) {
    try {
      const blob = await blobFromDataUrl(current)
      const legacyFile = new File([blob], "legacy-inline.jpg", { type: blob.type || "image/jpeg" })
      const compressed = await compressPosProductImageFile(legacyFile)
      const upload = await uploadPOSProductImage(compressed.file, { productId })
      if (upload.error) return { url: null, error: upload.error, migratedFromInline: false }
      logPosImageMetrics({
        originalSize: compressed.originalSize,
        optimizedSize: compressed.compressedSize,
        storage: "migrated-from-inline"
      })
      return { url: upload.data.publicUrl, error: null, migratedFromInline: true }
    } catch (error) {
      return {
        url: null,
        error: new Error(error?.message || "No se pudo migrar la imagen inline a Storage."),
        migratedFromInline: false
      }
    }
  }

  return { url: null, error: null, migratedFromInline: false }
}
