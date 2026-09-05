/**
 * Provisional datetime_issue formatter for FELplex Guatemala FACT payloads.
 * Public docs mention YYYY-MM-dd; examples use YYYY-MM-ddTHH:mm:ss.
 * Blocked for real HTTP until Stage proof — see docs/felplex-guatemala-api-contract.md.
 */
const PROVISIONAL_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/

export function formatFelplexDatetimeIssue(input: string): string | null {
  const trimmed = String(input ?? "").trim()
  if (!trimmed) return null

  const match = PROVISIONAL_DATETIME_PATTERN.exec(trimmed)
  if (!match) return null

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const h = Number(hour)
  const min = Number(minute)
  const s = Number(second)

  if (
    !Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) ||
    !Number.isInteger(h) || !Number.isInteger(min) || !Number.isInteger(s)
  ) {
    return null
  }

  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59) {
    return null
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

export const FELPLEX_DATETIME_ISSUE_PROVISIONAL = true as const
