import { createClient } from "@supabase/supabase-js"
import {
  createDevRestFetchLogger,
  getSupabaseConfigStatus,
  logSupabaseClientBootstrap,
  logSupabaseConfigWarnings,
  resolveSupabaseClientConfig
} from "../services/supabaseConnectivity"

const resolved = resolveSupabaseClientConfig()
const config = getSupabaseConfigStatus()
logSupabaseConfigWarnings(config)
logSupabaseClientBootstrap(resolved)

if (import.meta.env.DEV && !config.configured) {
  console.error("[Supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en frontend/.env")
}

const devFetch = createDevRestFetchLogger()
const clientOptions = devFetch ? { global: { fetch: devFetch } } : undefined

export const supabase = createClient(resolved.url, resolved.anonKey, clientOptions)

logSupabaseClientBootstrap(resolved, supabase)

export const isSupabaseClientConfigured = config.configured

/** Solo diagnóstico DEV — prefijos de key usados por el singleton. */
export function getSupabaseClientAuditSnapshot() {
  return {
    url: resolved.url,
    keyPrefix: resolved.anonKey.slice(0, 20),
    keyType: resolved.anonKey.startsWith("sb_publishable_")
      ? "publishable"
      : resolved.anonKey.startsWith("eyJ")
        ? "legacy"
        : "unknown",
    clientKeyPrefix: String(supabase.supabaseKey || "").slice(0, 20),
    clientUrl: supabase.supabaseUrl || "",
    keysMatch: supabase.supabaseKey === resolved.anonKey
  }
}
