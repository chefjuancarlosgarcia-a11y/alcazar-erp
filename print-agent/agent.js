import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildTicket, sendWindowsRaw, writeTempTicket } from "./test-print.js"

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
const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "")
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const agentId = env.PRINT_AGENT_ID || "local-print-agent"
const location = env.PRINT_AGENT_LOCATION || ""
const pollMs = Math.max(1000, Number(env.PRINT_AGENT_POLL_MS || 2000))

if (!supabaseUrl || !serviceKey) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en print-agent/.env.")
  process.exit(1)
}

async function rpc(name, body = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(data?.message || data?.error || text || `RPC ${name} fallo con HTTP ${response.status}`)
  }
  return data
}

function titleForJob(job) {
  if (job.job_type === "test") return job.payload?.title || "PRUEBA DE IMPRESIÓN ERP"
  if (job.job_type === "prebill") return "PRECUENTA"
  if (job.job_type === "receipt") return "RECIBO"
  if (job.job_type === "delivery_order") return "ORDEN DELIVERY"
  return "IMPRESIÓN"
}

function money(value) {
  const number = Number(value)
  return `Q${(Number.isFinite(number) ? number : 0).toFixed(2)}`
}

function trimLine(text, width = 32) {
  const value = String(text || "")
  return value.length > width ? `${value.slice(0, width - 1)}.` : value
}

function prebillTicketLines(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : []
  const lines = [
    `Mesa: ${payload.table_name || payload.table || "Mesa"}`,
    `Mesero: ${payload.waiter_name || "POS"}`,
    `Fecha: ${payload.printed_at_gt || new Date().toLocaleString("es-GT", { timeZone: "America/Guatemala" })}`,
    ""
  ]

  for (const item of items) {
    const quantity = Number(item.quantity || item.cantidad || 1)
    const name = trimLine(item.name || item.nombre || "Producto", 24)
    lines.push(`${quantity} x ${name}`)
    lines.push(`  ${money(item.unit_price || item.precio)}  ${money(item.subtotal || item.total)}`)
    if (item.notes) lines.push(`  ${trimLine(item.notes, 28)}`)
  }

  lines.push("")
  lines.push(`Total: ${money(payload.total)}`)
  if (payload.notes) {
    lines.push("")
    lines.push(trimLine(payload.notes, 32))
  }
  lines.push("")
  lines.push("Documento no fiscal")

  return lines
}

async function printJob(job) {
  if (!job.windows_printer_name) {
    throw new Error(`El job ${job.id} no tiene windows_printer_name.`)
  }
  const ticket = job.job_type === "prebill"
    ? buildTicket({ title: "PRECUENTA", lines: prebillTicketLines(job.payload), includeTimestamp: false })
    : buildTicket({ title: titleForJob(job) })
  const filePath = writeTempTicket(ticket)
  console.log(`[${agentId}] Job ${job.id}: impresora=${job.windows_printer_name}, archivo=${filePath}`)
  await sendWindowsRaw(filePath, job.windows_printer_name)
}

async function processJob(job) {
  const taken = await rpc("mark_print_job_printing", { p_job_id: job.id })
  if (!taken?.id) {
    console.log(`[${agentId}] Job ${job.id} ya fue tomado por otro agente.`)
    return
  }

  try {
    await printJob(job)
    await rpc("mark_print_job_printed", { p_job_id: job.id })
    console.log(`[${agentId}] Job ${job.id} impreso correctamente.`)
  } catch (error) {
    await rpc("mark_print_job_failed", {
      p_job_id: job.id,
      p_error_message: error.message || "Error de impresion"
    })
    console.error(`[${agentId}] Job ${job.id} fallo: ${error.message}`)
  }
}

let polling = false

async function poll() {
  if (polling) return
  polling = true
  try {
    const jobs = await rpc("get_pending_print_jobs", {
      p_location: location || null,
      p_limit: 5
    })
    if (jobs.length) {
      console.log(`[${agentId}] ${jobs.length} trabajo(s) pendiente(s).`)
    }
    for (const job of jobs) {
      await processJob(job)
    }
  } catch (error) {
    console.error(`[${agentId}] Error consultando trabajos: ${error.message}`)
  } finally {
    polling = false
  }
}

console.log(`[${agentId}] Print agent iniciado.`)
console.log(`[${agentId}] Supabase: ${supabaseUrl}`)
console.log(`[${agentId}] Ubicacion: ${location || "todas"}`)
console.log(`[${agentId}] Intervalo: ${pollMs} ms`)

poll()
setInterval(poll, pollMs)
