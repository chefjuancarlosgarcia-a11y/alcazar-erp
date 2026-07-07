/**
 * POS catalog RPC benchmark (requires authenticated session).
 *
 * Usage:
 *   node scripts/pos-catalog-perf-benchmark.mjs
 *
 * Env (optional):
 *   POS_PERF_EMAIL, POS_PERF_PASSWORD — login credentials
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY — from frontend/.env
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

function loadEnv() {
  const path = resolve(root, "frontend/.env")
  const text = readFileSync(path, "utf8")
  const env = {}
  for (const line of text.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) env[match[1].trim()] = match[2].trim().replace(/\r$/, "")
  }
  return env
}

function estimateBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

async function supabaseAuth(url, anonKey, email, password) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error_description || body?.msg || "Login failed")
  return body.access_token
}

async function timedRpc(url, anonKey, token, fn, args) {
  const started = performance.now()
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token || anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(args)
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  const rpcMs = Math.round(performance.now() - started)
  const error = response.ok ? null : (data?.message || data?.error || text || `HTTP ${response.status}`)
  return { data, error, rpcMs, payloadBytes: estimateBytes(data), status: response.status }
}

async function main() {
  const env = { ...loadEnv(), ...process.env }
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const email = env.POS_PERF_EMAIL
  const password = env.POS_PERF_PASSWORD

  if (!url || !anonKey) {
    console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend/.env")
    process.exit(1)
  }

  let token = null
  if (email && password) {
    token = await supabaseAuth(url, anonKey, email, password)
    console.log("[POS PERF] authenticated as", email)
  } else {
    console.warn("[POS PERF] No POS_PERF_EMAIL/POS_PERF_PASSWORD — using anon key (RPC may fail)")
  }

  const health = await timedRpc(url, anonKey, token, "diagnose_pos_catalog_health", {})
  console.log("[POS PERF] diagnose_ms", health.rpcMs, "status", health.status)
  if (health.error) {
    console.error("diagnose_pos_catalog_health error:", health.error)
  } else {
    const h = health.data || {}
    console.log("[POS PERF] catalog_size", h.total_products)
    console.log("[POS PERF] products_with_inline_image", h.products_with_inline_image)
    console.log("[POS PERF] products_with_storage_image", h.products_with_storage_image)
    console.log("[POS PERF] products_with_data_image", h.products_with_data_image)
    console.log("[POS PERF] max_image_url_bytes", h.max_image_url_bytes)
    console.log("[POS PERF] avg_image_url_bytes", h.avg_image_url_bytes)
  }

  const pages = [
    { label: "page_1", args: { p_limit: 50, p_offset: 0, p_search: null, p_category_id: null, p_active: null } },
    { label: "page_2", args: { p_limit: 50, p_offset: 50, p_search: null, p_category_id: null, p_active: null } },
    { label: "page_3", args: { p_limit: 50, p_offset: 100, p_search: null, p_category_id: null, p_active: true } }
  ]

  const samples = []
  for (const page of pages) {
    const result = await timedRpc(url, anonKey, token, "list_pos_catalog_page", page.args)
    const sample = {
      phase: "rpc_benchmark",
      label: page.label,
      catalog_size: result.data?.total ?? null,
      rpc_ms: result.rpcMs,
      payload_bytes: result.payloadBytes,
      items: Array.isArray(result.data?.items) ? result.data.items.length : null,
      status: result.status,
      error: result.error,
      timeout: /timeout|canceling statement|57014/i.test(String(result.error || ""))
    }
    console.log("[POS PERF]", sample)
    samples.push(sample)
    if (sample.timeout) {
      console.error("[POS PERF] TIMEOUT on", page.label, "— run 166_pos_catalog_perf_explain.sql")
    }
  }

  const rpcValues = samples.filter((s) => !s.error).map((s) => s.rpc_ms)
  const avg = rpcValues.length
    ? Math.round(rpcValues.reduce((a, b) => a + b, 0) / rpcValues.length)
    : null
  console.log("[POS PERF] audit_summary", {
    rpc_ms_avg: avg,
    rpc_ms_max: rpcValues.length ? Math.max(...rpcValues) : null,
    payload_bytes_avg: samples.length
      ? Math.round(samples.reduce((a, s) => a + (s.payload_bytes || 0), 0) / samples.length)
      : null,
    target_rpc_ms: 300,
    pass: avg != null && avg < 300
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
