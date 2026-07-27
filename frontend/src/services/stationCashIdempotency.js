/** End-to-end idempotency intents for station cash (sessionStorage only). */

export const STATION_CASH_IDEMPOTENCY_STORAGE_KEY = "os2-station-cash-idemp-v1"

export const STATION_CASH_IDEMPOTENCY_UNKNOWN_MESSAGE =
  "Verificando resultado, no repita la operación."

const TERMINAL_BUSINESS_ERRORS = [
  "Ya existe una caja abierta.",
  "No hay caja abierta.",
  "Solo puedes cerrar tu propia caja.",
  "Tipo de movimiento invalido.",
  "Este movimiento requiere supervisor",
  "El motivo es obligatorio.",
  "Conflicto de idempotencia",
  "Operacion no permitida."
]

function readStore() {
  if (typeof sessionStorage === "undefined") return { intents: [] }
  try {
    const raw = sessionStorage.getItem(STATION_CASH_IDEMPOTENCY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : { intents: [] }
    return Array.isArray(parsed.intents) ? parsed : { intents: [] }
  } catch {
    return { intents: [] }
  }
}

function writeStore(store) {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.setItem(STATION_CASH_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(store))
}

function sortValue(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortValue(value[key])
      return acc
    }, {})
}

export function fingerprintStationCashPayload(actionType, payload) {
  return JSON.stringify(sortValue({ actionType, ...payload }))
}

export function acquireStationCashIdempotencyKey(actionType, payload) {
  const fingerprint = fingerprintStationCashPayload(actionType, payload)
  const store = readStore()
  const open = store.intents.find(
    (item) =>
      item.actionType === actionType &&
      item.fingerprint === fingerprint &&
      (item.status === "in_flight" || item.status === "unknown")
  )
  if (open) {
    return { key: open.key, fingerprint, reused: true }
  }
  const key = `${actionType}-${crypto.randomUUID()}`
  store.intents.push({
    actionType,
    fingerprint,
    key,
    status: "in_flight",
    createdAt: Date.now()
  })
  writeStore(store)
  return { key, fingerprint, reused: false }
}

export function completeStationCashIdempotencyKey(key) {
  const store = readStore()
  store.intents = store.intents.filter((item) => item.key !== key)
  writeStore(store)
}

export function markStationCashIdempotencyUnknown(key) {
  const store = readStore()
  for (const item of store.intents) {
    if (item.key === key) item.status = "unknown"
  }
  writeStore(store)
}

export function listUnknownStationCashIntents() {
  return readStore().intents.filter((item) => item.status === "unknown")
}

export function isStationCashBusinessError(error) {
  const message = String(error?.message || error || "")
  return TERMINAL_BUSINESS_ERRORS.some((fragment) => message.includes(fragment))
}

export function isStationCashAmbiguousError(error) {
  if (!error) return false
  if (isStationCashBusinessError(error)) return false
  const message = String(error.message || "").toLowerCase()
  if (message.includes("conflicto de idempotencia")) return false
  return true
}

export async function runStationCashIdempotentRpc(actionType, payload, invokeWithKey) {
  const { key } = acquireStationCashIdempotencyKey(actionType, payload)
  const { data, error } = await invokeWithKey(key)
  if (error) {
    if (isStationCashBusinessError(error)) {
      completeStationCashIdempotencyKey(key)
      return { data: null, error, idempotencyKey: key }
    }
    markStationCashIdempotencyUnknown(key)
    return {
      data: null,
      error: { message: STATION_CASH_IDEMPOTENCY_UNKNOWN_MESSAGE, cause: error },
      idempotencyUnknown: true,
      idempotencyKey: key
    }
  }
  completeStationCashIdempotencyKey(key)
  return { data, error: null, idempotencyKey: key }
}
