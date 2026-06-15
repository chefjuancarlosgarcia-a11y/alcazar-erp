import regularFontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url"
import boldFontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url"

export const PDF_FONT_FAMILY = "DejaVuSans"

const FONT_FILES = {
  normal: { url: regularFontUrl, vfs: "DejaVuSans.ttf" },
  bold: { url: boldFontUrl, vfs: "DejaVuSans-Bold.ttf" }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function fetchFontBase64(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`No se pudo cargar la fuente PDF: ${url}`)
  }
  const buffer = await response.arrayBuffer()
  return arrayBufferToBase64(buffer)
}

let fontDataPromise = null

function loadFontData() {
  if (!fontDataPromise) {
    fontDataPromise = Promise.all([
      fetchFontBase64(FONT_FILES.normal.url),
      fetchFontBase64(FONT_FILES.bold.url)
    ])
  }
  return fontDataPromise
}

export async function registerPdfFonts(doc) {
  if (doc.__cateringPdfFontsReady) {
    doc.setFont(PDF_FONT_FAMILY, "normal")
    return PDF_FONT_FAMILY
  }

  const [regularBase64, boldBase64] = await loadFontData()

  doc.addFileToVFS(FONT_FILES.normal.vfs, regularBase64)
  doc.addFileToVFS(FONT_FILES.bold.vfs, boldBase64)
  doc.addFont(FONT_FILES.normal.vfs, PDF_FONT_FAMILY, "normal")
  doc.addFont(FONT_FILES.bold.vfs, PDF_FONT_FAMILY, "bold")
  doc.setFont(PDF_FONT_FAMILY, "normal")
  doc.__cateringPdfFontsReady = true
  return PDF_FONT_FAMILY
}

export function setPdfFont(doc, style = "normal") {
  doc.setFont(PDF_FONT_FAMILY, style)
}
