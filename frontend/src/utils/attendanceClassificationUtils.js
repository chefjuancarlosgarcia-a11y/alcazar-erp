export const ATTENDANCE_CLASSIFICATION_LABELS = {
  normal: "Normal",
  late: "Tarde",
  early: "Anticipada",
  out_of_schedule: "Fuera de horario",
  no_schedule: "Sin horario",
  rest_day_worked: "Descanso trabajado",
  authorized_overtime: "Extraordinaria autorizada",
  pending_overtime: "Extraordinaria pendiente",
  manual_adjustment: "Ajuste manual"
}

export const ATTENDANCE_APPROVAL_LABELS = {
  not_required: "No requiere",
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada"
}

export function getSchedulePreviewMessage(validation) {
  if (!validation) return ""
  const code = validation.reason_code
  if (code === "open_entry") return ""
  if (code === "authorized_overtime") {
    return "Tienes tiempo extraordinario autorizado para hoy."
  }
  if (code === "no_schedule") {
    return "Sin horario asignado. Si marcas, quedará pendiente de revisión de RRHH."
  }
  if (code === "rest_day") {
    return "Hoy tienes descanso. Si marcas, se registrará como descanso trabajado pendiente de revisión."
  }
  if (code === "out_of_schedule") {
    return "Estás fuera del horario asignado. Si marcas, quedará pendiente de revisión."
  }
  return validation.reason || ""
}

export function getMarkRegistrationMessage(mark, markTypeLabel) {
  const classification = mark?.classification
  const approvalStatus = mark?.approval_status

  if (classification === "authorized_overtime" || approvalStatus === "approved") {
    return `${markTypeLabel} registrada como tiempo extraordinario autorizado.`
  }
  if (classification === "no_schedule") {
    return `${markTypeLabel} registrada sin horario asignado. Pendiente de revisión de RRHH.`
  }
  if (classification === "rest_day_worked") {
    return `${markTypeLabel} registrada como descanso trabajado. Pendiente de revisión de RRHH.`
  }
  if (["out_of_schedule", "pending_overtime"].includes(classification) || approvalStatus === "pending") {
    return `${markTypeLabel} registrada como tiempo extraordinario pendiente de revisión.`
  }
  if (classification === "late") {
    return `${markTypeLabel} registrada. Se detectó llegada tarde.`
  }
  return `${markTypeLabel} registrada correctamente.`
}

export function isExtraordinaryClassification(classification) {
  return [
    "no_schedule",
    "rest_day_worked",
    "out_of_schedule",
    "pending_overtime",
    "authorized_overtime",
    "manual_adjustment"
  ].includes(classification)
}
