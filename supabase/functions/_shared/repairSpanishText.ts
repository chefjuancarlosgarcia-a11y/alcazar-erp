const REPLACEMENT_CHAR = "\uFFFD"
const REPLACEMENT_MOJIBAKE = "\u00EF\u00BF\u00BD"
const CORRUPTED_CHAR = `(?:${REPLACEMENT_CHAR}|${REPLACEMENT_MOJIBAKE})`

function decodeUtf8FromLatin1Bytes(text: string): string | null {
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff)
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  if (!decoded || decoded.includes(REPLACEMENT_CHAR)) return null
  return decoded
}

function repairEnyeFromCorruption(text: string): string {
  if (!text.includes(REPLACEMENT_CHAR) && !text.includes(REPLACEMENT_MOJIBAKE)) {
    return text
  }

  return text
    .replace(new RegExp(`([aeiouAEIOU])${CORRUPTED_CHAR}(?=o)`, "g"), "$1ñ")
    .replace(new RegExp(`([aeiouAEIOU])${CORRUPTED_CHAR}(?=a)`, "gi"), "$1ñ")
    .replace(new RegExp(`([aeiouAEIOU])${CORRUPTED_CHAR}(?=e)`, "gi"), "$1ñ")
    .replace(new RegExp(`Ni${CORRUPTED_CHAR}([oO])`, "g"), "Niñ$1")
    .replace(new RegExp(`ni${CORRUPTED_CHAR}([oO])`, "g"), "niñ$1")
}

function repairSpanishTextOnce(text: string): string {
  if (/[\u0080-\u00FF]/.test(text)) {
    const decoded = decodeUtf8FromLatin1Bytes(text)
    if (decoded) return decoded
  }

  const withEnye = repairEnyeFromCorruption(text)
  if (withEnye !== text) return withEnye

  return text
}

export function repairSpanishText(value: unknown): unknown {
  if (value == null) return value
  let text = String(value)
  if (!text) return text

  for (let pass = 0; pass < 4; pass += 1) {
    const next = repairSpanishTextOnce(text)
    if (next === text) break
    text = next
  }

  return text
}

export function repairSpanishRecord<T extends Record<string, unknown>>(
  source: T,
  fields: string[]
): T {
  const next = { ...source }
  for (const field of fields) {
    const value = next[field]
    if (typeof value === "string") {
      next[field] = repairSpanishText(value) as T[typeof field]
    }
  }
  return next
}

export const CATERING_REQUEST_TEXT_FIELDS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "event_location",
  "event_type",
  "notes"
]
