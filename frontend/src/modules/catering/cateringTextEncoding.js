const REPLACEMENT_CHAR = "\uFFFD"
/** UTF-8 U+FFFD leido como Latin-1: EF BF BD */
const REPLACEMENT_MOJIBAKE = "\u00EF\u00BF\u00BD"
const CORRUPTED_CHAR = `(?:${REPLACEMENT_CHAR}|${REPLACEMENT_MOJIBAKE})`

const MOJIBAKE_MARKERS = /(?:Ã.|Â.|â[\u0080-\u00BF]{2}|[\u0080-\u00FF])/

function decodeUtf8FromLatin1Bytes(text) {
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff)
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  if (!decoded || decoded.includes(REPLACEMENT_CHAR)) return null
  return decoded
}

function repairEnyeFromCorruption(text) {
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

function repairSpanishTextOnce(text) {
  if (MOJIBAKE_MARKERS.test(text)) {
    const decoded = decodeUtf8FromLatin1Bytes(text)
    if (decoded) return decoded
  }

  const withEnye = repairEnyeFromCorruption(text)
  if (withEnye !== text) return withEnye

  return text
}

/**
 * Repara texto espanol dañado por encoding incorrecto.
 * Restaura UTF-8 correcto (incluye ñ) sin quitar tildes.
 */
export function repairSpanishText(value) {
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

export function repairSpanishFields(source = {}, fields = []) {
  if (!source || typeof source !== "object") return source
  const next = { ...source }
  fields.forEach((field) => {
    if (typeof next[field] === "string") {
      next[field] = repairSpanishText(next[field])
    }
  })
  return next
}

export const CATERING_REQUEST_TEXT_FIELDS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "event_location",
  "event_type",
  "notes",
  "status",
  "conversion_status",
  "source"
]

export const CATERING_QUOTE_TEXT_FIELDS = [
  "quote_number",
  "status",
  "notes",
  "terms"
]

export const CATERING_QUOTE_ITEM_TEXT_FIELDS = [
  "description",
  "item_type",
  "quantity_unit"
]

export const CATERING_COMPANY_TEXT_FIELDS = [
  "commercialName",
  "headerText",
  "address",
  "phone",
  "whatsapp",
  "email",
  "website",
  "nit",
  "defaultTerms"
]

export function repairCateringRequest(request) {
  return repairSpanishFields(request, CATERING_REQUEST_TEXT_FIELDS)
}

export function repairCateringQuote(quote) {
  return repairSpanishFields(quote, CATERING_QUOTE_TEXT_FIELDS)
}

export function repairCateringQuoteItems(items = []) {
  return items.map((item) => repairSpanishFields(item, CATERING_QUOTE_ITEM_TEXT_FIELDS))
}

export function repairCateringCompanySettings(settings = {}) {
  return repairSpanishFields(settings, CATERING_COMPANY_TEXT_FIELDS)
}
