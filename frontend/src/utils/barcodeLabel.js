import JsBarcode from "jsbarcode"
import { inferBarcodeType, normalizeBarcode } from "./barcodeUtils"

function resolveJsBarcodeFormat(barcodeType) {
  switch (String(barcodeType || "").toUpperCase()) {
    case "EAN13":
      return "EAN13"
    case "UPC":
      return "UPC"
    case "EAN8":
      return "EAN8"
    default:
      return "CODE128"
  }
}

export function renderBarcodeSvg(barcode, barcodeType) {
  const value = normalizeBarcode(barcode)
  if (!value) return ""

  const format = resolveJsBarcodeFormat(barcodeType || inferBarcodeType(value))
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

  try {
    JsBarcode(svg, value, {
      format,
      width: 2,
      height: 72,
      displayValue: true,
      fontSize: 14,
      margin: 8,
      textMargin: 4
    })
  } catch {
    JsBarcode(svg, value, {
      format: "CODE128",
      width: 2,
      height: 72,
      displayValue: true,
      fontSize: 14,
      margin: 8,
      textMargin: 4
    })
  }

  return svg.outerHTML
}

export function printInventoryBarcodeLabel({ name = "", barcode = "", barcodeType = "" } = {}) {
  const value = normalizeBarcode(barcode)
  if (!value) return { ok: false, error: "No hay código de barras para imprimir." }

  const svgMarkup = renderBarcodeSvg(value, barcodeType)
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=480,height=360")
  if (!printWindow) {
    return { ok: false, error: "El navegador bloqueó la ventana de impresión." }
  }

  printWindow.document.write(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Etiqueta ${value}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; }
    h1 { font-size: 14px; margin: 0 0 8px; font-weight: 600; }
    .label-wrap { display: inline-block; border: 1px solid #ddd; padding: 12px; }
  </style>
</head>
<body>
  <div class="label-wrap">
    <h1>${String(name || "Producto").replace(/</g, "&lt;")}</h1>
    ${svgMarkup}
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`)
  printWindow.document.close()

  return { ok: true }
}
