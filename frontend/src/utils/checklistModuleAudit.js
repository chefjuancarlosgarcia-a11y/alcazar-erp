import {
  getChecklistOperationalDate,
  getChecklistTodayDateCandidates,
  isChecklistRunActive,
  isChecklistRunDateToday,
  isChecklistRunHistoricPending,
  isChecklistRunTodayWork,
  isChecklistTemplateDueOnDate,
  normalizeChecklistRunDate
} from "./checklistOperationalStatus"

const WEEKDAY_LABELS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

function isoWeekdayFromDateString(dateStr) {
  const [year, month, day] = String(dateStr).slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return null
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

function summarizeTemplateFrequency(template, dateStr) {
  const frequency = template?.frequency || "manual"
  if (frequency === "diaria") return "Diaria"
  if (frequency === "manual") return template?.auto_generate ? "Manual (auto)" : "Manual"
  if (frequency === "semanal") {
    const days = Array.isArray(template?.recurrence_days) ? template.recurrence_days.map(Number) : []
    if (!days.length) return "Semanal (todos los días)"
    const weekday = isoWeekdayFromDateString(dateStr)
    const dueToday = weekday != null && days.includes(weekday)
    const labels = days.map((day) => WEEKDAY_LABELS[day] || day).join(", ")
    return dueToday ? `Semanal (${labels}) · toca hoy` : `Semanal (${labels}) · hoy no toca`
  }
  return frequency
}

export function buildChecklistModuleAudit({
  runs = [],
  templates = [],
  operationalToday = getChecklistOperationalDate(),
  todayCandidates = getChecklistTodayDateCandidates(),
  fallback = null
} = {}) {
  const activeTemplates = (templates || []).filter((template) => template?.status === "active")
  const visibleRuns = runs || []

  const todayActiveRuns = visibleRuns.filter((run) => isChecklistRunTodayWork(run))
  const todayAnyRuns = visibleRuns.filter((run) => (
    run?.status !== "cancelled" && isChecklistRunDateToday(run?.run_date)
  ))
  const todayCompletedRuns = todayAnyRuns.filter((run) => run?.status === "completed")
  const todayInactiveRuns = todayAnyRuns.filter((run) => !isChecklistRunActive(run) && run?.status !== "completed")
  const historicPendingRuns = visibleRuns.filter((run) => isChecklistRunHistoricPending(run))
  const staleActiveRuns = visibleRuns.filter((run) => isChecklistRunActive(run) && !isChecklistRunTodayWork(run))

  const templatesDueToday = activeTemplates.filter((template) => isChecklistTemplateDueOnDate(template, operationalToday))
  const templatesSkippedToday = activeTemplates.filter((template) => !isChecklistTemplateDueOnDate(template, operationalToday))

  const weekday = isoWeekdayFromDateString(operationalToday)
  const weekdayLabel = WEEKDAY_LABELS[weekday] || operationalToday

  let userMessage = ""
  if (todayActiveRuns.length) {
    userMessage = `Listo: ${todayActiveRuns.length} checklist(s) activa(s) para hoy.`
  } else if (todayCompletedRuns.length) {
    userMessage = `Hay ${todayCompletedRuns.length} checklist(s) de hoy ya completadas. Revisa la pestaña Completadas.`
  } else if (fallback?.created > 0) {
    userMessage = `Se generaron ${fallback.created} checklist(s) para el día operativo ${operationalToday}.`
  } else if (historicPendingRuns.length) {
    userMessage = `Hoy no hay checklists nuevas (${weekdayLabel}). Hay ${historicPendingRuns.length} vencida(s) pendientes de días anteriores — abre la pestaña Vencidas.`
  } else if (templatesDueToday.length === 0 && activeTemplates.length) {
    userMessage = `Ninguna de las ${activeTemplates.length} plantillas activas está programada para hoy (${weekdayLabel}).`
  } else if (fallback?.error) {
    userMessage = fallback.error.message || "No se pudieron generar checklists para hoy."
  } else if (fallback?.attempted > 0 && fallback.created === 0 && fallback.ensured === 0) {
    userMessage = "Se intentó generar checklists pero ninguna se creó. Revisa permisos o la migración 112 en Supabase."
  } else {
    userMessage = "No hay checklists activas para el día operativo actual."
  }

  return {
    operationalToday,
    todayCandidates,
    weekdayLabel,
    todayActiveCount: todayActiveRuns.length,
    todayAnyCount: todayAnyRuns.length,
    todayCompletedCount: todayCompletedRuns.length,
    todayInactiveCount: todayInactiveRuns.length,
    historicPendingCount: historicPendingRuns.length,
    staleActiveCount: staleActiveRuns.length,
    activeTemplateCount: activeTemplates.length,
    templatesDueTodayCount: templatesDueToday.length,
    templatesSkippedTodayCount: templatesSkippedToday.length,
    fallback,
    userMessage,
    templateSummaries: activeTemplates.map((template) => ({
      id: template.id,
      title: template.title,
      frequencyLabel: summarizeTemplateFrequency(template, operationalToday),
      dueToday: isChecklistTemplateDueOnDate(template, operationalToday)
    })),
    staleDates: [...new Set(staleActiveRuns.map((run) => normalizeChecklistRunDate(run.run_date)).filter(Boolean))].sort(),
    todayDates: [...new Set(todayAnyRuns.map((run) => normalizeChecklistRunDate(run.run_date)).filter(Boolean))].sort()
  }
}
