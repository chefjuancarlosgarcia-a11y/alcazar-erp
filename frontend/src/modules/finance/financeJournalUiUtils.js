export function formatDateTime(value) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })
}

export function formatUserRef(value) {
  if (!value) return "—"
  const text = String(value)
  return text.length > 12 ? `…${text.slice(-8)}` : text
}

export function periodLabel(periods, periodId) {
  const period = periods.find((row) => row.id === periodId)
  if (!period) return "—"
  return `${period.period_year}-${String(period.period_month).padStart(2, "0")}`
}

export function sumEntryLines(entry, lineTotalsFn) {
  return lineTotalsFn(entry?.lines || [])
}
