/**
 * datetime_issue for FELplex Guatemala FACT payloads.
 * Confirmed: civil time in America/Guatemala as YYYY-MM-DDTHH:mm:ss (no Z/offset/ms).
 */
export const FELPLEX_GUATEMALA_TIME_ZONE = "America/Guatemala" as const

/** Payload datetime_issue must match exactly. */
export const FELPLEX_DATETIME_ISSUE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

const CIVIL_NO_ZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/

const INSTANT_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/i

const INSTANT_OFFSET_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?[+-]\d{2}:\d{2}$/

const guatemalaPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: FELPLEX_GUATEMALA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

/**
 * Formats datetime_issue for FELplex.
 *
 * - ISO instant (UTC `Z` or numeric offset): converted explicitly to America/Guatemala civil time.
 * - Civil string without zone (tests / deterministic injection): validated and normalized; not re-zoned.
 * - Anything else: null (fail-closed).
 */
export function formatFelplexDatetimeIssue(input: string): string | null {
  const trimmed = String(input ?? "").trim()
  if (!trimmed) return null

  if (INSTANT_UTC_PATTERN.test(trimmed) || INSTANT_OFFSET_PATTERN.test(trimmed)) {
    const instant = new Date(trimmed)
    if (Number.isNaN(instant.getTime())) return null
    return formatInstantToGuatemalaCivil(instant)
  }

  return normalizeValidatedCivilDatetime(trimmed)
}

function formatInstantToGuatemalaCivil(instant: Date): string | null {
  const parts = guatemalaPartsFormatter.formatToParts(instant)
  const pick = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((p) => p.type === type)?.value

  const year = pick("year")
  const month = pick("month")
  const day = pick("day")
  let hour = pick("hour")
  const minute = pick("minute")
  const second = pick("second")

  if (!year || !month || !day || hour === undefined || !minute || !second) {
    return null
  }

  if (hour === "24") hour = "00"

  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const h = Number(hour)
  const min = Number(minute)
  const s = Number(second)

  if (!isValidCivilComponents(y, m, d, h, min, s)) return null

  const assembled =
    `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` +
    `T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`

  return FELPLEX_DATETIME_ISSUE_PATTERN.test(assembled) ? assembled : null
}

function normalizeValidatedCivilDatetime(trimmed: string): string | null {
  const match = CIVIL_NO_ZONE_PATTERN.exec(trimmed)
  if (!match) return null

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const h = Number(hour)
  const min = Number(minute)
  const s = Number(second)

  if (!isValidCivilComponents(y, m, d, h, min, s)) return null

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

function isValidCivilComponents(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  s: number,
): boolean {
  if (
    !Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) ||
    !Number.isInteger(h) || !Number.isInteger(min) || !Number.isInteger(s)
  ) {
    return false
  }

  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59) {
    return false
  }

  const probe = new Date(Date.UTC(y, m - 1, d, h, min, s))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d &&
    probe.getUTCHours() === h &&
    probe.getUTCMinutes() === min &&
    probe.getUTCSeconds() === s
  )
}

export const FELPLEX_DATETIME_ISSUE_PROVISIONAL = false as const
