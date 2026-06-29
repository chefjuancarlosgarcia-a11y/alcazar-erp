const DEFAULT_MAX_DIMENSION = 1600
const DEFAULT_QUALITY = 0.75

let webpSupportCache = null

async function detectWebpSupport() {
  if (webpSupportCache != null) return webpSupportCache
  if (typeof createImageBitmap === "function") {
    try {
      const blob = await fetch(
        "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgQAA"
      ).then((response) => response.blob())
      await createImageBitmap(blob)
      webpSupportCache = true
      return true
    } catch {
      webpSupportCache = false
      return false
    }
  }
  const canvas = document.createElement("canvas")
  webpSupportCache = canvas.toDataURL("image/webp").startsWith("data:image/webp")
  return webpSupportCache
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("No se pudo leer la imagen seleccionada."))
    }
    image.src = objectUrl
  })
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fallback for browsers that reject certain camera formats via createImageBitmap.
    }
  }
  return loadImageElement(file)
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo optimizar la imagen."))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality
    )
  })
}

function buildOutputFile(blob, originalFile, mimeType, extension) {
  const baseName = String(originalFile.name || "imagen")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "imagen"
  return new File([blob], `${baseName}.${extension}`, {
    type: mimeType,
    lastModified: Date.now()
  })
}

/**
 * Compresses an image file in the browser for inventory uploads.
 * @param {File} file
 * @param {{ maxDimension?: number, quality?: number, maxBytes?: number }} [options]
 */
export async function compressInventoryImageFile(file, options = {}) {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const quality = options.quality ?? DEFAULT_QUALITY
  const maxBytes = options.maxBytes ?? null

  if (!file?.type?.startsWith("image/")) {
    throw new Error("El archivo seleccionado no es una imagen válida.")
  }

  const source = await loadImageSource(file)
  const sourceWidth = source.width || source.naturalWidth
  const sourceHeight = source.height || source.naturalHeight
  if (!sourceWidth || !sourceHeight) {
    if (typeof source.close === "function") source.close()
    throw new Error("No se pudo leer el tamaño de la imagen.")
  }

  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    if (typeof source.close === "function") source.close()
    throw new Error("Tu navegador no puede optimizar imágenes en este dispositivo.")
  }

  context.drawImage(source, 0, 0, width, height)
  if (typeof source.close === "function") source.close()

  const supportsWebp = await detectWebpSupport()
  const mimeType = supportsWebp ? "image/webp" : "image/jpeg"
  const extension = supportsWebp ? "webp" : "jpg"
  const blob = await canvasToBlob(canvas, mimeType, quality)
  const outputFile = buildOutputFile(blob, file, mimeType, extension)

  if (maxBytes != null && outputFile.size > maxBytes) {
    throw new Error(
      "La imagen sigue siendo demasiado pesada después de optimizarla. Prueba con otra foto o un encuadre más cercano."
    )
  }

  return {
    file: outputFile,
    previewUrl: URL.createObjectURL(blob),
    originalSize: file.size,
    compressedSize: outputFile.size,
    mimeType,
    width,
    height
  }
}

export function revokeCompressedImagePreview(previewUrl) {
  if (previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(previewUrl)
  }
}
