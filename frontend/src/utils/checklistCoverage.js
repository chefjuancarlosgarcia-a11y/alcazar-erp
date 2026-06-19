export const CHECKLIST_AVAILABILITY_STATES = {
  AVAILABLE_PRESENT: "available_present",
  SCHEDULED_NOT_CHECKED_IN: "scheduled_not_checked_in",
  OFFICIAL_DAY_OFF: "official_day_off",
  APPROVED_LEAVE: "approved_leave",
  NO_SCHEDULE: "no_schedule",
  UNKNOWN: "unknown"
}

export const CHECKLIST_AVAILABILITY_LABELS = {
  available_present: "Presente",
  scheduled_not_checked_in: "No marcó entrada",
  official_day_off: "Descanso o asueto",
  approved_leave: "Vacaciones o permiso",
  no_schedule: "Sin horario",
  unknown: "No determinado"
}

export const CHECKLIST_COVERAGE_SOURCE_LABELS = {
  primary: "Reemplazo principal",
  secondary: "Reemplazo secundario",
  escalation: "Escalar a",
  candidate: "Candidato",
  none: "Sin sugerencia"
}

export function getChecklistAvailabilityLabel(state) {
  return CHECKLIST_AVAILABILITY_LABELS[state] || state || "No determinado"
}

export function getChecklistCoverageSourceLabel(source) {
  return CHECKLIST_COVERAGE_SOURCE_LABELS[source] || source || ""
}

export function needsChecklistCoverageAlert(coverage) {
  return Boolean(coverage?.needs_coverage_alert)
}

export function getChecklistCoverageAlertMessage(coverage) {
  if (!coverage?.needs_coverage_alert) return ""
  const label = coverage?.responsible_availability?.availability_label
    || getChecklistAvailabilityLabel(coverage?.responsible_availability?.availability_state)
  return `Responsable no disponible: ${label}.`
}

export function getChecklistSuggestedReplacement(coverage) {
  if (!coverage?.suggested_replacement_profile_id) return null
  return {
    profileId: coverage.suggested_replacement_profile_id,
    source: coverage.suggested_replacement_source,
    reason: coverage.suggested_replacement_reason || "ausencia"
  }
}

export function buildChecklistCoverageMap(rows = []) {
  return Object.fromEntries((rows || []).map((row) => [row.run_id, row.coverage]))
}
