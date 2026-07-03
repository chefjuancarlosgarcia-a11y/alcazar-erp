const GT_TZ = "America/Guatemala"

export function formatOpenShiftLaborDate(value) {
  if (!value) return "—"
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return String(value)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return date.toLocaleDateString("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: GT_TZ
  })
}

export function formatOpenShiftEntrada(value) {
  if (!value) return { date: "—", time: "" }
  const dateObj = new Date(value)
  if (Number.isNaN(dateObj.getTime())) return { date: "—", time: "" }
  return {
    date: dateObj.toLocaleDateString("es-GT", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: GT_TZ
    }),
    time: dateObj.toLocaleTimeString("es-GT", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: GT_TZ
    })
  }
}

export function getOpenShiftElapsed(entradaAt) {
  if (!entradaAt) {
    return { label: "—", hours: 0, tier: "unknown" }
  }
  const start = new Date(entradaAt)
  if (Number.isNaN(start.getTime())) {
    return { label: "—", hours: 0, tier: "unknown" }
  }

  const diffMs = Date.now() - start.getTime()
  const hours = Math.max(0, diffMs / 3600000)

  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(diffMs / 60000))
    return { label: `Hace ${minutes} min`, hours, tier: tierFromHours(hours) }
  }
  if (hours < 24) {
    const rounded = Math.max(1, Math.round(hours))
    return { label: `Hace ${rounded} hora${rounded === 1 ? "" : "s"}`, hours, tier: tierFromHours(hours) }
  }

  const days = Math.max(1, Math.floor(hours / 24))
  return { label: `Hace ${days} día${days === 1 ? "" : "s"}`, hours, tier: tierFromHours(hours) }
}

function tierFromHours(hours) {
  if (hours < 12) return "green"
  if (hours < 24) return "yellow"
  if (hours < 48) return "orange"
  return "red"
}

export function getOpenShiftStatusLabel(row) {
  if (row?.has_open_meal) {
    return "En comida — cierra comida en terminal primero"
  }
  if (row?.overnight_shift) {
    return "Turno nocturno abierto"
  }
  return "Turno abierto"
}
