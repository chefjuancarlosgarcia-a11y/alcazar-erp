/** SessionStorage idempotency intents for station POS wrappers (no operator secrets in payload). */

export const STATION_POS_IDEMPOTENCY_STORAGE_KEY = "os2-station-pos-idemp-v1"

export const STATION_POS_IDEMPOTENCY_UNKNOWN_MESSAGE =
  "Verificando resultado, no repita la operación."

function readStore() {
  if (typeof sessionStorage === "undefined") return { intents: [] }
  try {
    const raw = sessionStorage.getItem(STATION_POS_IDEMPOTENCY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : { intents: [] }
    return Array.isArray(parsed.intents) ? parsed : { intents: [] }
  } catch {
    return { intents: [] }
  }
}

function writeStore(store) {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.setItem(STATION_POS_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(store))
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

export function fingerprintStationPosPayload(actionType, payload) {
  return JSON.stringify(sortValue({ actionType, ...payload }))
}

export function acquireStationPosIdempotencyKey(actionType, payload) {
  const fingerprint = fingerprintStationPosPayload(actionType, payload)
  const store = readStore()
  const open = store.intents.find(
    (item) =>
      item.actionType === actionType &&
      item.fingerprint === fingerprint &&
      (item.status === "in_flight" || item.status === "unknown")
  )
  if (open) return { key: open.key, fingerprint, reused: true }
  const key = crypto.randomUUID()
  store.intents.push({ actionType, fingerprint, key, status: "in_flight", createdAt: Date.now() })
  writeStore(store)
  return { key, fingerprint, reused: false }
}

export function completeStationPosIdempotencyKey(key) {
  const store = readStore()
  store.intents = store.intents.filter((item) => item.key !== key)
  writeStore(store)
}

export function markStationPosIdempotencyUnknown(key) {
  const store = readStore()
  const row = store.intents.find((item) => item.key === key)
  if (row) row.status = "unknown"
  writeStore(store)
}

export async function runStationPosIdempotentRpc(actionType, payload, invoke) {
  const { key } = acquireStationPosIdempotencyKey(actionType, payload)
  try {
    const { data, error } = await invoke(key)
    if (error) {
      const msg = String(error?.message || "")
      const business =
        /Envía o quita|Producto no|Variante no|Modificador invalido|Opcion invalida|Seleccion de opciones|Cantidad invalida|STATION_POS_PRICING_GAP|POS_RELEASE|POS_TABLE|La orden no|Solo una orden|No hay productos|Operacion no permitida/i.test(
          msg
        )
      if (business) completeStationPosIdempotencyKey(key)
      else markStationPosIdempotencyUnknown(key)
      return { data: null, error, idempotencyUnknown: !business, idempotencyKey: key }
    }
    completeStationPosIdempotencyKey(key)
    return { data, error: null, idempotencyKey: key }
  } catch (err) {
    markStationPosIdempotencyUnknown(key)
    return { data: null, error: err, idempotencyUnknown: true, idempotencyKey: key }
  }
}
