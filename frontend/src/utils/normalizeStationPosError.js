const NORMALIZED = Symbol.for("alcazar.stationPosErrorNormalized")

function stripFormattedMessage(message) {
  let text = String(message || "").trim()
  if (!text) return ""
  for (let i = 0; i < 4; i += 1) {
    const nested = text.match(/^message:\s*(.+)$/i)
    if (!nested) break
    text = nested[1].trim()
    const pipeIdx = text.indexOf(" | details:")
    if (pipeIdx >= 0) text = text.slice(0, pipeIdx).trim()
  }
  return text
}

function extractErrorCode(error, text) {
  if (error?.code && error.code !== "P0001") return String(error.code)
  const fromText = String(text || "").match(
    /\b(STATION_POS_[A-Z0-9_]+|POS_[A-Z0-9_]+)\b/
  )
  return fromText?.[1] || error?.code || "POS_RPC_ERROR"
}

const USER_MESSAGES = {
  STATION_POS_AUDIT_ACTOR_INVALID:
    "No se pudo atribuir la operación al mesero. Bloquea la sesión e ingresa nuevamente.",
  STATION_POS_ORDER_OWNER_MISMATCH:
    "Esta mesa está siendo atendida por otro mesero.",
  STATION_POS_ORDER_NOT_OPEN:
    "La comanda ya no está abierta. Actualiza la mesa.",
  STATION_POS_FORBIDDEN:
    "Operación no permitida en esta estación. Actualiza la mesa e intenta nuevamente.",
  STATION_POS_SESSION_INVALID:
    "Sesión expirada. Vuelve a ingresar tu PIN.",
  STATION_POS_PRICING_GAP:
    "Selecciona un tamaño o configuración antes de agregar el producto."
}

export function normalizeStationPosError(error, { operation } = {}) {
  if (error?.[NORMALIZED]) return error

  const rawMessage = stripFormattedMessage(error?.message)
  const code = extractErrorCode(error, rawMessage)
  const userMessage = USER_MESSAGES[code]
    || (rawMessage && !/^message:/i.test(rawMessage) && rawMessage.length < 240 && !rawMessage.includes("| details:")
      ? rawMessage
      : "No se pudo agregar el producto. Actualiza la mesa e intenta nuevamente.")

  const normalized = {
    name: "StationPosError",
    message: userMessage,
    code,
    userMessage,
    rawMessage: rawMessage || null,
    operation: operation || null,
    [NORMALIZED]: true
  }
  return normalized
}

export function stationPosErrorMessage(error, options) {
  return normalizeStationPosError(error, options).userMessage
}

export function isNormalizedStationPosError(error) {
  return Boolean(error?.[NORMALIZED])
}
