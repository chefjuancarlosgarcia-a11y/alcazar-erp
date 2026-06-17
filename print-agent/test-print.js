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

function buildTicket({ title = "PRUEBA DE IMPRESIÓN", lines = [], includeTimestamp = true } = {}) {
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
    line("EL GRAN ALCÁZAR"),
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
