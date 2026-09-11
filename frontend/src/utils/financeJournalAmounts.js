/** NUMERIC(18,2) upper bound expressed in centavos (integer string → BigInt). */
export const MAX_AMOUNT_CENTS = 999999999999999999n

const AMOUNT_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/

export function normalizeAmountInput(value) {
  if (value === "" || value == null) return ""
  return String(value).trim().replace(/,/g, "")
}

export function parseAmountToCents(value) {
  const normalized = normalizeAmountInput(value)
  if (normalized === "") return { ok: true, cents: 0n }

  if (!AMOUNT_INPUT_PATTERN.test(normalized)) {
    return { ok: false, message: "Importe inválido: use hasta dos decimales sin signo negativo." }
  }

  const [wholePart, fractionPart = ""] = normalized.split(".")
  if (fractionPart.length > 2) {
    return { ok: false, message: "Importe inválido: máximo dos decimales." }
  }

  const cents = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"))
  if (cents > MAX_AMOUNT_CENTS) {
    return { ok: false, message: "Importe fuera del límite contable (NUMERIC 18,2)." }
  }

  return { ok: true, cents }
}

export function centsToDecimalNumber(cents) {
  return Number(cents) / 100
}

export function formatAmountPayload(value) {
  const parsed = parseAmountToCents(value)
  if (!parsed.ok) return null
  const whole = parsed.cents / 100n
  const frac = parsed.cents % 100n
  return `${whole}.${String(frac).padStart(2, "0")}`
}

export function amountsBalanced(debitCents, creditCents) {
  return debitCents === creditCents
}

export function sumLineAmountCents(lines, field) {
  let total = 0n
  for (const line of lines) {
    const parsed = parseAmountToCents(line[field])
    if (parsed.ok) total += parsed.cents
  }
  return total
}
