/**
 * Structured logging and error classification for POS catalog operations.
 * Logs are always emitted; use DevTools filter: [POS catalog]
 */

export const CATALOG_LOG_PREFIX = "[POS catalog]"

export function classifyCatalogError(error) {
  const message = String(error?.message || error || "")
  const code = String(error?.code || "")
  if (/timeout|canceling statement|57014/i.test(message)) return "timeout"
  if (/permission|row-level security|42501|not authorized|jwt expired|invalid.*key/i.test(message)) return "rls"
  if (/401|403/.test(code) || /unauthorized|forbidden/i.test(message)) return "rls"
  return "other"
}

export function catalogErrorUserMessage(kind, rawMessage = "") {
  if (kind === "timeout") {
    return "No se pudo cargar el catálogo por tiempo de espera. Los platillos pueden existir en Supabase, pero la consulta tardó demasiado."
  }
  if (kind === "rls") {
    return "No se pudo cargar el catálogo por permisos o sesión. Vuelve a iniciar sesión e intenta de nuevo."
  }
  return rawMessage || "No se pudo cargar el catálogo POS desde Supabase."
}

export function logCatalogOperation(phase, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    phase,
    ...payload
  }
  console.info(CATALOG_LOG_PREFIX, entry)
  return entry
}

export function logCatalogSaveAttempt(payload) {
  return logCatalogOperation("save_attempt", payload)
}

export function logCatalogSaveResult(payload) {
  return logCatalogOperation("save_result", payload)
}

export function logCatalogLoadResult(payload) {
  return logCatalogOperation("load_result", payload)
}

export function logCatalogVerifyResult(payload) {
  return logCatalogOperation("verify_result", payload)
}

export function measureInlineImage(imageUrl) {
  const value = String(imageUrl || "")
  if (!value) return { hasImage: false, bytes: 0, isBase64: false }
  return {
    hasImage: true,
    bytes: value.length,
    isBase64: value.startsWith("data:")
  }
}
