const UA_TAG = "__device_ua__:"

export function parseUserAgentToFriendly(userAgent = "") {
  const ua = String(userAgent || "").trim().toLowerCase()
  if (!ua) return "Dispositivo desconocido"
  if (ua.includes("ipad")) return "iPad"
  if (ua.includes("iphone")) return "iPhone"
  if (ua.includes("android")) {
    return ua.includes("mobile") && !ua.includes("tablet") ? "Celular / Android" : "Tablet / Android"
  }
  if (ua.includes("macintosh") || ua.includes("mac os")) return "Mac"
  if (ua.includes("windows")) return "PC / Windows"
  if (ua.includes("linux") && !ua.includes("android")) return "PC / Linux"
  return "Dispositivo desconocido"
}

export function looksLikeUserAgent(value = "") {
  const raw = String(value || "").trim()
  if (/^(Tablet \/ Android|Celular \/ Android|PC \/ (Windows|Linux)|iPhone|iPad|Mac|Dispositivo desconocido)$/i.test(raw)) {
    return false
  }
  return /Mozilla\/|AppleWebKit|KHTML|Chrome\/|Safari\/|Windows NT|Macintosh|; Android/i.test(raw)
}

export function formatAttendanceDeviceLabel(deviceNameOrUa = "") {
  const raw = String(deviceNameOrUa || "").trim()
  if (!raw) return "Dispositivo desconocido"
  if (looksLikeUserAgent(raw)) return parseUserAgentToFriendly(raw)
  if (/^(Tablet|Celular|PC|iPhone|iPad|Mac|Dispositivo)/i.test(raw)) return raw
  if (raw.length > 60 && /WebKit|Gecko|Mobile|Windows NT|Macintosh/i.test(raw)) {
    return parseUserAgentToFriendly(raw)
  }
  return raw
}

export function formatAttendanceDevice(record = {}) {
  for (const field of [record.device_name, record.registradoPor, record.dispositivoLabel]) {
    const value = String(field || "").trim()
    if (!value) continue
    const label = formatAttendanceDeviceLabel(value)
    if (!looksLikeUserAgent(label)) return label
  }

  const ua = extractStoredUserAgent(record)
  if (ua) {
    const label = formatAttendanceDeviceLabel(ua)
    if (!looksLikeUserAgent(label)) return label
  }

  return "Dispositivo desconocido"
}

export function resolveAttendanceUserAgent(record = {}) {
  const fromObservation = extractStoredUserAgent(record)
  if (fromObservation) return fromObservation
  const deviceName = String(record.device_name || record.registradoPor || "").trim()
  if (looksLikeUserAgent(deviceName)) return deviceName
  const cachedLabel = String(record.dispositivoLabel || "").trim()
  if (looksLikeUserAgent(cachedLabel)) return cachedLabel
  return ""
}

export function buildAttendanceDevicePayload(userObservation = "") {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""
  const deviceName = resolveAttendanceDeviceName(userAgent)
  return {
    deviceName,
    userAgent,
    observation: composeAttendanceObservation(userObservation, userAgent)
  }
}

export function resolveAttendanceDeviceName(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  if (typeof window !== "undefined" && window.matchMedia) {
    const coarse = window.matchMedia("(pointer: coarse)").matches
    const narrow = window.matchMedia("(max-width: 767px)").matches
    const ua = String(userAgent || "").toLowerCase()
    if (ua.includes("ipad")) return "iPad"
    if (ua.includes("iphone")) return "iPhone"
    if (ua.includes("android")) {
      if (narrow || (coarse && !ua.includes("tablet"))) return "Celular / Android"
      return "Tablet / Android"
    }
    if (ua.includes("macintosh") || ua.includes("mac os")) return "Mac"
    if (ua.includes("windows")) return "PC / Windows"
  }
  return parseUserAgentToFriendly(userAgent)
}

export function composeAttendanceObservation(userObservation = "", userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  const trimmed = String(userObservation || "").trim()
  const uaTag = `${UA_TAG}${String(userAgent || "").trim()}`
  return trimmed ? `${trimmed}\n${uaTag}` : uaTag
}

export function extractStoredUserAgent(mark = {}) {
  const observation = String(mark.observation || mark.observacion || "")
  const tagged = observation.match(new RegExp(`${UA_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(.+)$`, "m"))
  if (tagged?.[1]) return tagged[1].trim()
  const deviceName = mark.device_name || mark.registradoPorRaw || mark.registradoPor || ""
  if (looksLikeUserAgent(deviceName)) return deviceName.trim()
  return ""
}

export function extractUserObservation(mark = {}) {
  const observation = String(mark.observation || mark.observacion || "")
  if (!observation) return ""
  return observation.replace(new RegExp(`\\n?${UA_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+$`, "m"), "").trim()
}

const DEVICE_ID_STORAGE_KEY = "attendanceKioskDeviceId"

export function getOrCreateAttendanceDeviceId() {
  if (typeof localStorage === "undefined") return `kiosk-${Date.now().toString(36)}`
  const stored = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (stored) return stored
  const created = `kiosk-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, created)
  return created
}

export function shortenAttendanceDeviceId(deviceId = "") {
  const value = String(deviceId || "").trim()
  if (!value) return "—"
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function inferAttendanceDeviceType(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  const label = resolveAttendanceDeviceName(userAgent)
  if (/celular/i.test(label)) return "mobile"
  if (/tablet|ipad/i.test(label)) return "tablet"
  if (/pc|mac/i.test(label)) return "desktop"
  return "unknown"
}
