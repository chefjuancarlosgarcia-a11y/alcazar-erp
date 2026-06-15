import { extractUserObservation } from "./attendanceDevice"

const TECHNICAL_PREFIXES = [
  /^__device_ua__/i,
  /^device_ua\b/i,
  /^user_agent\b/i,
  /^session_id\b/i,
  /^raw_metadata\b/i,
  /^ip_address\b/i,
  /^ip\b/i
]

const TECHNICAL_PATTERNS = [
  /Mozilla\/[\d. ]+/i,
  /AppleWebKit\/[\d. ]+/i,
  /Chrome\/[\d. ]+/i,
  /Safari\/[\d. ]+/i,
  /Windows NT/i,
  /Android/i
]

function isTechnicalObservationPart(value = "") {
  const trimmed = String(value || "").trim()
  if (!trimmed) return true
  if (TECHNICAL_PREFIXES.some((pattern) => pattern.test(trimmed))) return true
  if (/^[\[{].*[\]}]$/.test(trimmed)) return true
  if (TECHNICAL_PATTERNS.filter((pattern) => pattern.test(trimmed)).length >= 2) return true
  return false
}

export function sanitizeAttendanceObservation(value = "") {
  const raw = String(value || "").trim()
  if (!raw) return ""

  const parts = raw.split(/\s+\/\s+/).flatMap((part) => part.split(/\n+/))
  const cleaned = parts
    .map((part) => extractUserObservation({ observation: part }) || part.trim())
    .map((part) => part.replace(/(\n|\r\n)?__device_ua__:[^\n]*/gi, "").trim())
    .filter((part) => part && !isTechnicalObservationPart(part))

  return cleaned.join(" / ")
}
