const MAX_CHECKLIST_PHOTO_DIMENSION = 1280
const JPEG_QUALITY = 0.82

export function readChecklistEvidenceFile(event, callback) {
  const file = event.target.files?.[0]
  if (!file) return

  if (!file.type.startsWith("image/")) {
    const reader = new FileReader()
    reader.onload = () => callback(String(reader.result || ""))
    reader.readAsDataURL(file)
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    const source = String(reader.result || "")
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, MAX_CHECKLIST_PHOTO_DIMENSION / Math.max(image.width, image.height, 1))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) {
        callback(source)
        return
      }
      context.drawImage(image, 0, 0, width, height)
      callback(canvas.toDataURL("image/jpeg", JPEG_QUALITY))
    }
    image.onerror = () => callback(source)
    image.src = source
  }
  reader.onerror = () => callback("")
  reader.readAsDataURL(file)
}
