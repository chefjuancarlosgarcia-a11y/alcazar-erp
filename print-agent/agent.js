import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildPrebillTicket, buildReceiptTicket, buildTicket, sendWindowsRaw, writeTempTicket } from "./test-print.js"

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

const AGENT_BUILD_VERSION = "2026-06-18-receipt-lines-v2"

const env = { ...loadEnv(envPath), ...process.env }
const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "")
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const agentId = env.PRINT_AGENT_ID || "local-print-agent"
const location = env.PRINT_AGENT_LOCATION || ""
const pollMs = Math.max(1000, Number(env.PRINT_AGENT_POLL_MS || 2000))
const pollLimit = Math.max(1, Math.min(50, Number(env.PRINT_AGENT_POLL_LIMIT || 5)))
const agentDebugEnabled = String(env.PRINT_AGENT_DEBUG || "true").trim().toLowerCase() !== "false"

if (!supabaseUrl || !serviceKey) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en print-agent/.env.")
  process.exit(1)
}

function agentDebug(message, details = undefined) {
  if (!agentDebugEnabled) return
  if (details === undefined) {
    console.log(`[AGENT DEBUG] ${message}`)
    return
  }
  console.log(`[AGENT DEBUG] ${message}`, details)
}

async function rpc(name, body = {}) {
  const startedAt = Date.now()
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
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (parseError) {
    agentDebug("RPC JSON parse failed", {
      rpc: name,
      status: response.status,
      ms: Date.now() - startedAt,
      bodyPreview: text.slice(0, 500)
    })
    throw new Error(`RPC ${name} devolvio respuesta no JSON: ${text.slice(0, 200)}`)
  }

  if (!response.ok) {
    agentDebug("RPC HTTP error", {
      rpc: name,
      status: response.status,
      ms: Date.now() - startedAt,
      body: data || text
    })
    throw new Error(data?.message || data?.error || text || `RPC ${name} fallo con HTTP ${response.status}`)
  }

  agentDebug("RPC ok", {
    rpc: name,
    status: response.status,
    ms: Date.now() - startedAt,
    resultType: Array.isArray(data) ? "array" : typeof data,
    resultLength: Array.isArray(data) ? data.length : null
  })

  return data
}

async function probeAuthRole(context = "probe") {
  agentDebug("Supabase URL", supabaseUrl)
  agentDebug("service key prefix", serviceKey.slice(0, 10))

  try {
    const role = await rpc("debug_auth_role", {})
    const roleValue = typeof role === "string" ? role : JSON.stringify(role)
    console.log(`[AGENT DEBUG] auth.role() = ${roleValue}`)
    agentDebug("auth.role probe ok", { context, role: roleValue })
    return roleValue
  } catch (error) {
    agentDebug("auth.role probe failed", {
      context,
      error: error.message,
      hint: "Aplicar supabase/schema/100_debug_auth_role.sql en el proyecto Supabase"
    })
    return null
  }
}

async function logBeforePendingJobsRpc(context = "poll") {
  agentDebug("before get_pending_print_jobs RPC", {
    context,
    supabaseUrl,
    serviceKeyPrefix: serviceKey.slice(0, 10)
  })
  await probeAuthRole(context)
}

function titleForJob(job) {
  switch (job.job_type) {
    case "test":
      return job.payload?.title || "PRUEBA DE IMPRESIÓN ERP"
    case "receipt":
      return "RECIBO"
    case "prebill":
      return "PRECUENTA"
    case "delivery_order":
      return "ORDEN DELIVERY"
    default:
      return "IMPRESIÓN"
  }
}

function resolvePaperWidth(job) {
  return job.paper_width || job.payload?.paper_width || job.payload?.paperWidth || "58mm"
}

function buildTicketForJob(job) {
  const paperWidth = resolvePaperWidth(job)
  const payload = job.payload || {}

  switch (job.job_type) {
    case "prebill":
      return buildPrebillTicket(payload, { paperWidth })
    case "receipt":
      return buildReceiptTicket(payload, { paperWidth })
    case "test":
    case "delivery_order":
    default:
      return buildTicket({ title: titleForJob(job) })
  }
}

async function printJob(job) {
  if (!job.windows_printer_name) {
    throw new Error(`El job ${job.id} no tiene windows_printer_name.`)
  }

  switch (job.job_type) {
    case "receipt":
      console.log(`[${agentId}] Imprimiendo receipt`)
      console.log("[Print Agent] receipt payload lines count", job.payload?.lines?.length ?? 0)
      console.log("[Print Agent] first lines", job.payload?.lines?.slice(0, 10) ?? [])
      console.log("[Print Agent] payload keys", Object.keys(job.payload || {}))
      break
    case "prebill":
      console.log(`[${agentId}] Imprimiendo prebill`)
      break
    case "test":
      console.log(`[${agentId}] Imprimiendo test`)
      break
    case "delivery_order":
      console.log(`[${agentId}] Imprimiendo delivery_order`)
      break
    default:
      console.log(`[${agentId}] Imprimiendo job_type=${job.job_type || "desconocido"}`)
  }

  const ticket = buildTicketForJob(job)
  const filePath = writeTempTicket(ticket)
  console.log(`[${agentId}] Job ${job.id}: impresora=${job.windows_printer_name}, papel=${resolvePaperWidth(job)}, archivo=${filePath}`)
  await sendWindowsRaw(filePath, job.windows_printer_name)
}

async function processJob(job) {
  console.log(`[${agentId}] Job recibido`, {
    id: job.id,
    job_type: job.job_type,
    printer_id: job.printer_id,
    location: job.location || null,
    status: job.status
  })
  console.log(`[${agentId}] Tipo: ${job.job_type}`)

  const taken = await rpc("mark_print_job_printing", { p_job_id: job.id })
  if (!taken?.id) {
    agentDebug("skipping reason", {
      jobId: job.id,
      reason: "mark_print_job_printing did not claim job (already taken or not pending)"
    })
    console.log(`[${agentId}] Job ${job.id} ya fue tomado por otro agente.`)
    return
  }

  try {
    await printJob(job)
    await rpc("mark_print_job_printed", { p_job_id: job.id })
    if (job.job_type === "receipt") {
      console.log(`[${agentId}] Receipt impreso correctamente`)
    } else {
      console.log(`[${agentId}] Job ${job.id} impreso correctamente.`)
    }
  } catch (error) {
    await rpc("mark_print_job_failed", {
      p_job_id: job.id,
      p_error_message: error.message || "Error de impresion"
    })
    console.error(`[${agentId}] Job ${job.id} fallo: ${error.message}`)
  }
}

let polling = false
let pollCycle = 0
let pollStartedAt = 0

async function poll() {
  pollCycle += 1
  const cycle = pollCycle

  agentDebug("polling...", {
    cycle,
    agentId,
    location: location || null,
    pollMs,
    pollLimit,
    pollingLocked: polling,
    supabaseUrl
  })

  if (polling) {
    agentDebug("skipping reason", {
      cycle,
      reason: "poll already in progress",
      lockedForMs: pollStartedAt ? Date.now() - pollStartedAt : null,
      hint: "Si lockedForMs crece, el ciclo anterior esta colgado (ej. impresion Windows)"
    })
    return
  }

  polling = true
  pollStartedAt = Date.now()

  const pollFilters = {
    rpc: "get_pending_print_jobs",
    status: "pending",
    job_type: "all (no filter in RPC)",
    printer_id: "any (no filter in RPC)",
    location: location || null,
    p_limit: pollLimit,
    note: "RPC also requires auth.role()=service_role and pos_printers.is_active=true"
  }

  try {
    agentDebug("RPC request", pollFilters)

    await logBeforePendingJobsRpc(`poll cycle ${cycle}`)

    const jobs = await rpc("get_pending_print_jobs", {
      p_location: location || null,
      p_limit: pollLimit
    })

    const pendingJobs = Array.isArray(jobs) ? jobs : []

    agentDebug("jobs returned", {
      cycle,
      count: pendingJobs.length,
      rawType: Array.isArray(jobs) ? "array" : typeof jobs,
      filters: pollFilters
    })

    agentDebug("job ids", pendingJobs.map((job) => job.id))

    agentDebug("receipt jobs", pendingJobs
      .filter((job) => job.job_type === "receipt")
      .map((job) => ({
        id: job.id,
        created_at: job.created_at,
        printer_id: job.printer_id,
        location: job.location || null
      })))

    if (!pendingJobs.length) {
      agentDebug("skipping reason", {
        cycle,
        reason: "RPC returned zero pending jobs",
        filters: pollFilters,
        hints: [
          "Verificar agente corriendo con service role key correcta",
          "Verificar pos_printers.location coincide con PRINT_AGENT_LOCATION",
          "Verificar impresora is_active=true",
          "Verificar no hay >5 pending mas antiguos bloqueando cola (p_limit)",
          "En SQL Editor get_pending_print_jobs devuelve 0 (auth.role no es service_role)"
        ]
      })
    } else {
      console.log(`[${agentId}] ${pendingJobs.length} trabajo(s) pendiente(s).`, pollFilters)
      for (const job of pendingJobs) {
        console.log(`[${agentId}] Pendiente detectado`, {
          id: job.id,
          job_type: job.job_type,
          printer_id: job.printer_id,
          location: job.location || null,
          windows_printer_name: job.windows_printer_name || null,
          created_at: job.created_at
        })
      }
    }

    for (const job of pendingJobs) {
      await processJob(job)
    }
  } catch (error) {
    agentDebug("skipping reason", {
      cycle,
      reason: "RPC poll failed",
      error: error.message
    })
    console.error(`[${agentId}] Error consultando trabajos: ${error.message}`)
  } finally {
    agentDebug("poll finished", {
      cycle,
      durationMs: Date.now() - pollStartedAt
    })
    polling = false
    pollStartedAt = 0
  }
}

console.log(`[${agentId}] Print agent iniciado.`)
console.log(`[${agentId}] Version: ${AGENT_BUILD_VERSION}`)
console.log(`[${agentId}] Supabase: ${supabaseUrl}`)
console.log(`[${agentId}] Ubicacion: ${location || "todas"}`)
console.log(`[${agentId}] Intervalo: ${pollMs} ms`)
console.log(`[${agentId}] Limite por poll: ${pollLimit}`)
console.log(`[${agentId}] Debug: ${agentDebugEnabled ? "on" : "off"}`)

agentDebug("startup config", {
  agentId,
  location: location || null,
  pollMs,
  pollLimit,
  serviceKeyPresent: Boolean(serviceKey),
  serviceKeyPrefix: serviceKey ? `${serviceKey.slice(0, 10)}` : null
})

async function startAgent() {
  await probeAuthRole("startup")
  await poll()
  setInterval(poll, pollMs)
}

startAgent()
