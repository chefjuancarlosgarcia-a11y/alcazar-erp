import net from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, ".env")

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=")
        if (separator === -1) return [line, ""]
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")
        return [key, value]
      })
  )
}

const env = { ...loadEnv(envPath), ...process.env }
const printMode = String(env.PRINT_MODE || "tcp").trim().toLowerCase()
const printerIp = env.PRINTER_IP
const printerPort = Number(env.PRINTER_PORT || 9100)
const windowsPrinterName = env.WINDOWS_PRINTER_NAME

const ESC = 0x1b
const GS = 0x1d

function validateLocalTestConfig() {
  if (!["tcp", "windows"].includes(printMode)) {
    console.error("PRINT_MODE no es valido. Usa PRINT_MODE=tcp o PRINT_MODE=windows.")
    process.exit(1)
  }

  if (printMode === "tcp" && !printerIp) {
    console.error("Falta PRINTER_IP. Crea print-agent/.env usando .env.example.")
    process.exit(1)
  }

  if (printMode === "tcp" && (!Number.isInteger(printerPort) || printerPort <= 0 || printerPort > 65535)) {
    console.error("PRINTER_PORT no es valido. Usa un puerto TCP como 9100.")
    process.exit(1)
  }

  if (printMode === "windows" && !windowsPrinterName) {
    console.error("Falta WINDOWS_PRINTER_NAME. Ejemplo: WINDOWS_PRINTER_NAME=CAJA.")
    process.exit(1)
  }
}

function cp850(text) {
  const map = {
    "Á": 0xb5,
    "É": 0x90,
    "Í": 0xd6,
    "Ó": 0xe0,
    "Ú": 0xe9,
    "Ñ": 0xa5,
    "á": 0xa0,
    "é": 0x82,
    "í": 0xa1,
    "ó": 0xa2,
    "ú": 0xa3,
    "ñ": 0xa4,
    "¿": 0xa8,
    "¡": 0xad
  }
  return Buffer.from([...String(text)].map((char) => map[char] ?? char.charCodeAt(0)))
}

function line(text = "") {
  return Buffer.concat([cp850(text), Buffer.from("\n")])
}

function normalizePayloadLines(rawLines) {
  if (Array.isArray(rawLines)) {
    return rawLines.map((entry) => String(entry ?? ""))
  }
  if (typeof rawLines === "string") {
    const trimmed = rawLines.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry ?? ""))
      }
    } catch {
      return [rawLines]
    }
  }
  return null
}

function findPrematureCut(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null
  const cuts = []
  for (let index = 0; index < buffer.length - 2; index += 1) {
    if (buffer[index] === GS && buffer[index + 1] === 0x56) {
      cuts.push({
        offset: index,
        hex: buffer.slice(index, Math.min(index + 3, buffer.length)).toString("hex"),
        atEnd: index >= buffer.length - 3
      })
    }
  }
  const premature = cuts.filter((entry) => !entry.atEnd)
  return premature.length ? premature : null
}

function decodeLineBuffer(lineBuffer) {
  if (!Buffer.isBuffer(lineBuffer)) return ""
  const withoutNewline = lineBuffer[lineBuffer.length - 1] === 0x0a
    ? lineBuffer.subarray(0, -1)
    : lineBuffer
  return withoutNewline.toString("latin1")
}

function bufferReadablePreview(ticket, { maxLines = 10 } = {}) {
  if (!Buffer.isBuffer(ticket)) return []

  const preview = []
  let current = Buffer.alloc(0)

  for (let index = 0; index < ticket.length; index += 1) {
    const byte = ticket[index]
    if (byte === 0x0a) {
      preview.push(decodeLineBuffer(Buffer.concat([current, Buffer.from("\n")])))
      current = Buffer.alloc(0)
      if (preview.length >= maxLines) break
      continue
    }
    if (byte === ESC || byte === GS) {
      if (current.length) {
        preview.push(decodeLineBuffer(Buffer.concat([current, Buffer.from("\n")])))
        current = Buffer.alloc(0)
        if (preview.length >= maxLines) break
      }
      preview.push(`<esc ${ticket.slice(index, index + 3).toString("hex")}>`)
      index += 2
      if (preview.length >= maxLines) break
      continue
    }
    current = Buffer.concat([current, Buffer.from([byte])])
  }

  if (preview.length < maxLines && current.length) {
    preview.push(decodeLineBuffer(Buffer.concat([current, Buffer.from("\n")])))
  }

  return preview.slice(0, maxLines)
}

function auditEscPosBuffer(label, ticket, { normalizedLines = [], lineBuffers = [] } = {}) {
  const contentBytes = lineBuffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const prematureCuts = findPrematureCut(ticket)

  console.log(`[Print Agent] ${label}`, {
    linesReceived: normalizedLines.length,
    renderedLineBuffers: lineBuffers.length,
    contentBytes,
    bufferLength: ticket.length,
    concatMatchesContent: lineBuffers.length === 0 || ticket.length > contentBytes,
    prematureCutCommands: prematureCuts,
    cutAtEndHex: ticket.slice(-3).toString("hex"),
    bufferReadableFirst10: bufferReadablePreview(ticket, { maxLines: 10 })
  })

  if (prematureCuts?.length) {
    console.warn("[Print Agent] premature cut detected before end of buffer", prematureCuts)
  }
}

export function paperWidthChars(paperWidth = "58mm") {
  const normalized = String(paperWidth || "58mm").trim().toLowerCase()
  return normalized === "80mm" ? 48 : 32
}

function repeatChar(char, width) {
  return String(char || "-").repeat(Math.max(0, width))
}

export function money(value) {
  const number = Number(value)
  return `Q${(Number.isFinite(number) ? number : 0).toFixed(2)}`
}

function padRight(text, width) {
  const value = String(text ?? "")
  if (value.length >= width) return value.slice(0, width)
  return `${value}${" ".repeat(width - value.length)}`
}

function padLeft(text, width) {
  const value = String(text ?? "")
  if (value.length >= width) return value.slice(-width)
  return `${" ".repeat(width - value.length)}${value}`
}

function wrapText(text, width) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean)
  if (!words.length) return [""]
  const lines = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= width) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word.length > width ? word.slice(0, width) : word
  }
  if (current) lines.push(current)
  return lines
}

export function buildPrebillTicketLines(payload = {}, { paperWidth = "58mm" } = {}) {
  const width = paperWidthChars(paperWidth)
  const qtyWidth = 4
  const totalWidth = 8
  const nameWidth = Math.max(8, width - qtyWidth - 1 - totalWidth)
  const indent = " ".repeat(qtyWidth + 1)
  const items = Array.isArray(payload.items) ? payload.items : []
  const lines = [
    `Mesa: ${payload.table_name || payload.table || "Mesa"}`,
    `Mesero: ${payload.waiter_name || "POS"}`,
    `Fecha: ${payload.printed_at_gt || new Date().toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      dateStyle: "short",
      timeStyle: "medium"
    })}`,
    "",
    repeatChar("-", width),
    `${padRight("Cant", qtyWidth)} ${padRight("Producto", nameWidth)}${padLeft("Total", totalWidth)}`.slice(0, width),
    repeatChar("-", width)
  ]

  for (const item of items) {
    const quantity = Number(item.quantity || item.cantidad || 1)
    const total = money(item.subtotal ?? item.total ?? (quantity * Number(item.unit_price || item.precio || 0)))
    const nameLines = wrapText(item.name || item.nombre || "Producto", nameWidth)
    lines.push(
      `${padRight(String(quantity), qtyWidth)} ${padRight(nameLines[0], nameWidth)}${padLeft(total, totalWidth)}`.slice(0, width)
    )
    for (let index = 1; index < nameLines.length; index += 1) {
      lines.push(`${indent}${padRight(nameLines[index], nameWidth)}`.slice(0, width))
    }
    if (item.notes) {
      for (const noteLine of wrapText(item.notes, width - indent.length)) {
        lines.push(`${indent}${noteLine}`.slice(0, width))
      }
    }
  }

  lines.push(
    repeatChar("-", width),
    `${padRight("TOTAL:", width - totalWidth)}${padLeft(money(payload.total), totalWidth)}`.slice(0, width),
    repeatChar("-", width),
    "",
    "Documento no fiscal",
    "Gracias por visitarnos"
  )

  return lines
}

export function buildPrebillTicket(payload = {}, { paperWidth = "58mm" } = {}) {
  return buildTicket({
    businessName: payload.business_name || "EL GRAN ALCÁZAR",
    title: "PRECUENTA",
    lines: buildPrebillTicketLines(payload, { paperWidth }),
    includeTimestamp: false
  })
}

export function buildReceiptTicketLines(payload = {}, { paperWidth = "58mm" } = {}) {
  const width = paperWidthChars(paperWidth)
  const qtyWidth = 4
  const totalWidth = 8
  const nameWidth = Math.max(8, width - qtyWidth - 1 - totalWidth)
  const indent = " ".repeat(qtyWidth + 1)
  const items = Array.isArray(payload.items) ? payload.items : []
  const discountAmount = Number(payload.discount_amount || 0)
  const tipAmount = Number(payload.tip_amount || 0)
  const lines = [
    `Mesa: ${payload.table_name || "Mesa"}`,
    `Mesero: ${payload.waiter_name || "—"}`,
    `Cajero: ${payload.cashier_name || "Caja"}`,
    `Fecha: ${payload.printed_at_gt || new Date().toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      dateStyle: "short",
      timeStyle: "medium"
    })}`,
    `Orden: ${payload.order_label || payload.receipt_number || payload.order_id || "—"}`,
    "",
    repeatChar("-", width),
    `${padRight("Cant", qtyWidth)} ${padRight("Producto", nameWidth)}${padLeft("Total", totalWidth)}`.slice(0, width),
    repeatChar("-", width)
  ]

  for (const item of items) {
    const quantity = Number(item.quantity || 1)
    const total = money(item.subtotal ?? (quantity * Number(item.unit_price || 0)))
    const nameLines = wrapText(item.name || "Producto", nameWidth)
    lines.push(
      `${padRight(String(quantity), qtyWidth)} ${padRight(nameLines[0], nameWidth)}${padLeft(total, totalWidth)}`.slice(0, width)
    )
    for (let index = 1; index < nameLines.length; index += 1) {
      lines.push(`${indent}${padRight(nameLines[index], nameWidth)}`.slice(0, width))
    }
  }

  lines.push(repeatChar("-", width))
  lines.push(`${padRight("Subtotal:", width - totalWidth)}${padLeft(money(payload.subtotal), totalWidth)}`.slice(0, width))

  if (discountAmount > 0) {
    lines.push(`${padRight("Descuento:", width - totalWidth)}${padLeft(money(discountAmount), totalWidth)}`.slice(0, width))
  }
  if (tipAmount > 0) {
    lines.push(`${padRight("Propina:", width - totalWidth)}${padLeft(money(tipAmount), totalWidth)}`.slice(0, width))
  }

  lines.push(
    `${padRight("TOTAL:", width - totalWidth)}${padLeft(money(payload.total), totalWidth)}`.slice(0, width),
    repeatChar("-", width)
  )

  if (payload.payment_methods) {
    lines.push(`Pago: ${payload.payment_methods}`.slice(0, width))
  }

  lines.push("", payload.footer_message || "Gracias por visitarnos")
  return lines
}

export function buildReceiptTicket(payload = {}, { paperWidth = "58mm" } = {}) {
  const resolvedPaperWidth = payload.paper_width || payload.paperWidth || paperWidth
  const normalizedLines = normalizePayloadLines(payload.lines)
  const hasPayloadLines = Array.isArray(normalizedLines) && normalizedLines.length > 0

  console.log("[Print Agent] buildReceiptTicket input", {
    linesType: payload.lines === undefined ? "undefined" : typeof payload.lines,
    linesIsArray: Array.isArray(payload.lines),
    linesRawLength: Array.isArray(payload.lines) ? payload.lines.length : null,
    normalizedLinesLength: normalizedLines?.length ?? null,
    itemsLength: Array.isArray(payload.items) ? payload.items.length : null
  })

  if (hasPayloadLines) {
    console.log("[Print Agent] receipt renderer = payload.lines")
    console.log("[Print Agent] receipt payload lines count", normalizedLines.length)
    console.log("[Print Agent] first 10 lines", normalizedLines.slice(0, 10))
    return buildEscPosFromLines(normalizedLines)
  }

  console.log("[Print Agent] receipt renderer = fallback")

  const fallbackLines = buildReceiptTicketLines(payload, { paperWidth: resolvedPaperWidth })
  console.log("[Print Agent] receipt payload lines count", payload.lines?.length ?? 0)
  console.log("[Print Agent] first 10 lines", Array.isArray(payload.lines) ? payload.lines.slice(0, 10) : payload.lines)
  console.log("[Print Agent] fallback generated lines count", fallbackLines.length)
  console.log("[Print Agent] fallback first 10 lines", fallbackLines.slice(0, 10))

  const ticket = buildTicket({
    businessName: payload.restaurant_name || "EL GRAN ALCÁZAR",
    title: "RECIBO",
    lines: fallbackLines,
    includeTimestamp: false
  })

  auditEscPosBuffer("buildReceiptTicket fallback buffer", ticket, {
    normalizedLines: fallbackLines,
    lineBuffers: fallbackLines.map((text) => line(text))
  })

  return ticket
}

function buildTicket({
  businessName = "EL GRAN ALCÁZAR",
  title = "PRUEBA DE IMPRESIÓN",
  lines = [],
  includeTimestamp = true
} = {}) {
  const now = new Date().toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    dateStyle: "short",
    timeStyle: "medium"
  })

  return Buffer.concat([
    Buffer.from([ESC, 0x40]), // init
    Buffer.from([ESC, 0x74, 0x02]), // CP850 on many ESC/POS printers
    Buffer.from([ESC, 0x61, 0x01]), // center
    Buffer.from([ESC, 0x45, 0x01]), // bold on
    line(businessName),
    line(title),
    Buffer.from([ESC, 0x45, 0x00]), // bold off
    line(""),
    Buffer.from([ESC, 0x61, 0x00]), // left
    ...(includeTimestamp ? [line(now)] : []),
    ...lines.map((text) => line(text)),
    line(""),
    line(""),
    line(""),
    Buffer.from([GS, 0x56, 0x00]) // full cut if supported
  ])
}

export function buildEscPosFromLines(lines = []) {
  const normalizedLines = normalizePayloadLines(lines) ?? (Array.isArray(lines) ? lines.map((text) => String(text ?? "")) : [])
  const lineBuffers = normalizedLines.map((text) => line(text))
  const initBuffer = Buffer.from([ESC, 0x40])
  const codepageBuffer = Buffer.from([ESC, 0x74, 0x02])
  const alignBuffer = Buffer.from([ESC, 0x61, 0x00])
  const trailingBlankBuffers = [line(""), line("")]
  const cutBuffer = Buffer.from([GS, 0x56, 0x00])

  const headerChunks = [initBuffer, codepageBuffer, alignBuffer]
  const contentChunks = lineBuffers
  const footerChunks = [...trailingBlankBuffers, cutBuffer]
  const allChunks = [...headerChunks, ...contentChunks, ...footerChunks]

  const expectedBufferLength = allChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const ticket = Buffer.concat(allChunks)
  const contentBytes = lineBuffers.reduce((sum, buffer) => sum + buffer.length, 0)

  const newlineChecks = normalizedLines.slice(0, 10).map((text, index) => ({
    index,
    preview: text.slice(0, 80),
    endsWithNewlineByte: lineBuffers[index]?.[lineBuffers[index].length - 1] === 0x0a
  }))

  console.log("[Print Agent] buildEscPosFromLines concat audit", {
    headerChunkCount: headerChunks.length,
    contentChunkCount: contentChunks.length,
    footerChunkCount: footerChunks.length,
    totalChunkCount: allChunks.length,
    expectedBufferLength,
    actualBufferLength: ticket.length,
    concatComplete: expectedBufferLength === ticket.length,
    linesReceived: normalizedLines.length,
    renderedLineBuffers: lineBuffers.length,
    contentBytes,
    bufferLength: ticket.length
  })

  console.log("[Print Agent] buildEscPosFromLines newline checks (first 10)", newlineChecks)

  auditEscPosBuffer("buildEscPosFromLines buffer", ticket, {
    normalizedLines,
    lineBuffers
  })

  return ticket
}

function tempTicketPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return path.join(os.tmpdir(), `alcazar-escpos-${stamp}.bin`)
}

function writeTempTicket(ticket) {
  const filePath = tempTicketPath()
  fs.writeFileSync(filePath, ticket)
  return filePath
}

function sendWindowsRaw(filePath, printerName) {
  return new Promise((resolve, reject) => {
    const script = `
param([string]$PrinterName, [string]$Path)
$source = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOC_INFO_1 di);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

  public static void SendFile(string printerName, string filePath) {
    IntPtr printerHandle;
    if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero)) {
      throw new Exception("No se pudo abrir la impresora: " + printerName);
    }

    try {
      DOC_INFO_1 docInfo = new DOC_INFO_1();
      docInfo.pDocName = "Alcazar ESC/POS Test";
      docInfo.pDataType = "RAW";
      byte[] bytes = File.ReadAllBytes(filePath);

      if (!StartDocPrinter(printerHandle, 1, docInfo)) throw new Exception("No se pudo iniciar el documento RAW.");
      try {
        if (!StartPagePrinter(printerHandle)) throw new Exception("No se pudo iniciar la pagina.");
        try {
          int written;
          if (!WritePrinter(printerHandle, bytes, bytes.Length, out written)) throw new Exception("No se pudo escribir en la impresora.");
          if (written != bytes.Length) throw new Exception("Solo se escribieron " + written + " de " + bytes.Length + " bytes.");
        } finally {
          EndPagePrinter(printerHandle);
        }
      } finally {
        EndDocPrinter(printerHandle);
      }
    } finally {
      ClosePrinter(printerHandle);
    }
  }
}
"@
Add-Type -TypeDefinition $source
[RawPrinterHelper]::SendFile($PrinterName, $Path)
`

    const command = `& {\n${script}\n}`
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
      printerName,
      filePath
    ], { windowsHide: true })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `PowerShell termino con codigo ${code}.`))
    })
  })
}

function printTcpTest() {
  const socket = new net.Socket()
  const timeoutMs = Number(env.PRINTER_TIMEOUT_MS || 5000)

  socket.setTimeout(timeoutMs)

  socket.once("connect", () => {
    console.log(`Conectado a impresora ${printerIp}:${printerPort}. Enviando prueba...`)
    socket.write(buildTicket(), (error) => {
      if (error) {
        console.error("No se pudo enviar la impresion:", error.message)
        socket.destroy()
        process.exitCode = 1
        return
      }
      socket.end()
    })
  })

  socket.once("timeout", () => {
    console.error(`No se pudo conectar a ${printerIp}:${printerPort}: tiempo de espera agotado (${timeoutMs} ms).`)
    socket.destroy()
    process.exitCode = 1
  })

  socket.once("error", (error) => {
    console.error(`No se pudo conectar a ${printerIp}:${printerPort}: ${error.message}`)
    process.exitCode = 1
  })

  socket.once("close", (hadError) => {
    if (!hadError && process.exitCode !== 1) {
      console.log("Prueba enviada. Revisa la impresora.")
    }
  })

  socket.connect(printerPort, printerIp)
}

async function printWindowsTest() {
  const ticket = buildTicket({ title: "PRUEBA DE IMPRESIÓN WINDOWS" })
  const filePath = writeTempTicket(ticket)
  console.log(`Modo de impresion: windows`)
  console.log(`Impresora seleccionada: ${windowsPrinterName}`)
  console.log(`Archivo temporal generado: ${filePath}`)

  try {
    await sendWindowsRaw(filePath, windowsPrinterName)
    console.log("Prueba enviada a la cola de impresion de Windows. Revisa la impresora.")
  } catch (error) {
    console.error(`No se pudo imprimir en Windows printer "${windowsPrinterName}": ${error.message}`)
    process.exitCode = 1
  }
}

async function main() {
  validateLocalTestConfig()
  console.log(`Modo de impresion: ${printMode}`)
  if (printMode === "windows") {
    await printWindowsTest()
    return
  }
  console.log(`Impresora TCP seleccionada: ${printerIp}:${printerPort}`)
  printTcpTest()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

export { buildTicket, sendWindowsRaw, writeTempTicket }
