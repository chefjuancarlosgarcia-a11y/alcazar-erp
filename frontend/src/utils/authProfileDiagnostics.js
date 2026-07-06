/** Logs temporales de diagnóstico — eliminar cuando se resuelva carga de perfil. */
const ENABLED = import.meta.env.DEV

function pickHttpStatus(error) {
  if (!error || typeof error !== "object") return undefined
  return error.status ?? error.statusCode ?? error.httpStatus
}

export function logAuthProfileDiagnostic(event, payload = {}) {
  if (!ENABLED) return
  console.group(`[Auth][profile-diagnostic] ${event}`)
  console.log("timestamp:", new Date().toISOString())
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) console.log(`${key}:`, value)
  })
  console.groupEnd()
}

export function logSupabaseQueryFailure({
  sourceFunction,
  table,
  queryDescription,
  authUserId,
  authEmail,
  sessionPresent,
  error
}) {
  if (!ENABLED) return
  logAuthProfileDiagnostic("supabase_query_failed", {
    sourceFunction,
    table,
    query: queryDescription,
    authUserId: authUserId || "(sin uid)",
    authEmail: authEmail || "(sin email)",
    sessionPresent: Boolean(sessionPresent),
    "error.code": error?.code,
    "error.message": error?.message,
    "error.details": error?.details,
    "error.hint": error?.hint,
    httpStatus: pickHttpStatus(error),
    fullError: error
  })
}

export function logSupabaseQueryAttempt({
  sourceFunction,
  table,
  queryDescription,
  authUserId,
  authEmail
}) {
  if (!ENABLED) return
  logAuthProfileDiagnostic("supabase_query_attempt", {
    sourceFunction,
    table,
    query: queryDescription,
    authUserId: authUserId || "(sin uid)",
    authEmail: authEmail || "(sin email)"
  })
}

export function logProfileLoadOutcome({
  sourceFunction,
  authUserId,
  authEmail,
  outcome,
  profileId,
  profileStatus,
  error
}) {
  if (!ENABLED) return
  logAuthProfileDiagnostic(`profile_load_${outcome}`, {
    sourceFunction,
    authUserId: authUserId || "(sin uid)",
    authEmail: authEmail || "(sin email)",
    profileId: profileId || "(sin fila)",
    profileStatus: profileStatus || "(n/a)",
    "error.code": error?.code,
    "error.message": error?.message,
    "error.details": error?.details,
    httpStatus: pickHttpStatus(error)
  })
}

export function logBrandingQueryFailure({ sourceFunction, table, queryDescription, error, note }) {
  if (!ENABLED) return
  console.group(`[Settings][branding-diagnostic] ${sourceFunction}`)
  console.log("timestamp:", new Date().toISOString())
  console.log("table:", table)
  console.log("query:", queryDescription)
  console.log("note:", note)
  console.log("error.code:", error?.code)
  console.log("error.message:", error?.message)
  console.log("error.details:", error?.details)
  console.log("error.hint:", error?.hint)
  console.log("httpStatus:", pickHttpStatus(error))
  console.log("fullError:", error)
  console.groupEnd()
}
