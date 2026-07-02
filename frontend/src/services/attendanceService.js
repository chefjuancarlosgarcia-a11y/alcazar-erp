import { supabase } from "../lib/supabase"
import { getMarkRegistrationMessage, getSchedulePreviewMessage } from "../utils/attendanceClassificationUtils"

export { getMarkRegistrationMessage, getSchedulePreviewMessage }

const EVIDENCE_BUCKET = "attendance-evidence"

export function getAttendanceTerminalProfiles() {
  return supabase.rpc("get_attendance_terminal_profiles")
}

export function setAttendancePin(employeeId, pin, authorizedDevice = "") {
  return supabase.rpc("set_attendance_pin", {
    p_employee_id: employeeId,
    p_pin: pin,
    p_authorized_device: authorizedDevice || null
  })
}

export function validateAttendancePinAvailable(pin, employeeId = null) {
  return supabase.rpc("validate_attendance_pin_available", {
    p_pin: pin,
    p_employee_id: employeeId
  })
}

export function setAttendanceDevice(employeeId, authorizedDevice = "") {
  return supabase.rpc("set_attendance_device", {
    p_employee_id: employeeId,
    p_authorized_device: authorizedDevice || null
  })
}

export function verifyAttendancePin(employeeId, pin) {
  return supabase.rpc("verify_attendance_pin", {
    p_employee_id: employeeId,
    p_pin: pin
  })
}

export async function uploadAttendanceEvidence(blob, employeeId) {
  const path = `${employeeId}/${Date.now()}-marcaje.jpg`
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, blob, { cacheControl: "3600", contentType: "image/jpeg", upsert: false })
  return { data: error ? null : { path }, error }
}

export function canEmployeeMarkAttendance(employeeId, date = null) {
  const markDate = date || new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" })
  return supabase.rpc("can_employee_mark_attendance", {
    p_employee_id: employeeId,
    p_date: markDate
  })
}

export function getAttendanceMarkingState(employeeId, markType = null) {
  return supabase.rpc("get_attendance_marking_state", {
    p_employee_id: employeeId,
    p_mark_type: markType || null
  })
}

export function diagnoseAttendanceEmployeeState(employeeName, startDate, endDate) {
  return supabase.rpc("diagnose_attendance_employee_state", {
    p_employee_name: employeeName,
    p_start_date: startDate,
    p_end_date: endDate
  })
}

export async function validateEmployeeScheduleForMarking(employeeId, markType = null) {
  const { data, error } = await getAttendanceMarkingState(employeeId, markType)
  if (import.meta.env.DEV) {
    console.log("[asistencia/marcaje] marking state", { employeeId, markType, data, error })
  }
  if (error) {
    return {
      allowed: false,
      allowed_for_entrada: false,
      allowed_for_completion: false,
      reason: error.message || "No se pudo validar el horario asignado.",
      reason_code: "validation_error",
      schedule_id: null,
      schedule_status: null,
      is_work_day: false,
      labor_date: null,
      has_open_entry: false,
      has_open_meal: false,
      overnight_shift: false,
      classification: null,
      approval_status: null,
      system_reason: null
    }
  }
  return data || {
    allowed: true,
    allowed_for_entrada: true,
    allowed_for_completion: false,
    reason: "Sin horario asignado. La marcación se registrará para revisión de RRHH.",
    reason_code: "no_schedule",
    schedule_id: null,
    schedule_status: null,
    is_work_day: false,
    labor_date: null,
    has_open_entry: false,
    has_open_meal: false,
    overnight_shift: false,
    classification: "no_schedule",
    approval_status: "pending",
    system_reason: null
  }
}

export function registerAttendanceMark({ employeeId, pin, markType, photoPath, deviceId, deviceName, observation = "", clientIp = null }) {
  return supabase.rpc("register_attendance_mark", {
    p_employee_id: employeeId,
    p_pin: pin,
    p_mark_type: markType,
    p_photo_path: photoPath,
    p_device_id: deviceId,
    p_device_name: deviceName,
    p_observation: observation || null,
    p_client_ip: clientIp || null
  })
}

export function getAttendanceMarksForReview({ status = "pending", from = null, to = null } = {}) {
  return supabase.rpc("get_attendance_marks_for_review", {
    p_status: status || "pending",
    p_from: from || null,
    p_to: to || null
  })
}

export function reviewAttendanceMark({ markId, action, notes = "" }) {
  return supabase.rpc("review_attendance_mark", {
    p_mark_id: markId,
    p_action: action,
    p_notes: notes || null
  })
}

export function getOpenAttendanceShifts() {
  return supabase.rpc("get_open_attendance_shifts")
}

export function closeOpenAttendanceShift({ employeeId, closedAt = null, observation = "" } = {}) {
  return supabase.rpc("close_open_attendance_shift", {
    p_employee_id: employeeId,
    p_closed_at: closedAt || new Date().toISOString(),
    p_observation: observation || null
  })
}

export function getOrRegisterAttendanceDevice({ deviceId, deviceName, userAgent, deviceType, clientIp = null }) {
  return supabase.rpc("get_or_register_attendance_device", {
    p_device_id: deviceId,
    p_device_name: deviceName || null,
    p_user_agent: userAgent || null,
    p_device_type: deviceType || null,
    p_client_ip: clientIp || null
  })
}

export function getAttendanceSecurityStatus({ deviceId, clientIp = null, userAgent = null }) {
  return supabase.rpc("get_attendance_security_status", {
    p_device_id: deviceId,
    p_client_ip: clientIp || null,
    p_user_agent: userAgent || null
  })
}

export function getAttendanceDevices() {
  return supabase.rpc("get_attendance_devices")
}

export function authorizeAttendanceDevice(deviceId, deviceName = "", notes = "") {
  return supabase.rpc("authorize_attendance_device", {
    p_device_id: deviceId,
    p_device_name: deviceName || null,
    p_notes: notes || null
  })
}

export function blockAttendanceDevice(deviceId, notes = "") {
  return supabase.rpc("block_attendance_device", {
    p_device_id: deviceId,
    p_notes: notes || null
  })
}

export function updateAttendanceDevice(deviceId, deviceName = "", notes = "") {
  return supabase.rpc("update_attendance_device", {
    p_device_id: deviceId,
    p_device_name: deviceName || null,
    p_notes: notes || null
  })
}

export function getAttendanceSecuritySettings() {
  return supabase.rpc("get_attendance_security_settings")
}

export function updateAttendanceSecuritySettings(value) {
  return supabase.rpc("update_attendance_security_settings", {
    p_value: value
  })
}

export function getAttendanceLateArrivalsSetupStatus() {
  return supabase.rpc("attendance_late_arrivals_setup_status")
}

export function probeAttendanceLateArrival(date, employeeName = null) {
  return supabase.rpc("probe_attendance_late_arrival", {
    p_date: date,
    p_employee_name: employeeName || null
  })
}

export function getAttendanceLateGraceMinutes() {
  return supabase.rpc("get_attendance_late_grace_minutes")
}

export async function getAttendanceDailyLateArrivals(date, employeeId = null) {
  const request = {
    date,
    employeeId: employeeId || null
  }
  console.log("[asistencia/tardanza] rpc request", request)
  const { data, error } = await supabase.rpc("get_attendance_daily_late_arrivals", {
    p_date: date,
    p_employee_id: employeeId || null
  })
  console.log("[asistencia/tardanza] rpc response", data)
  console.log("[asistencia/tardanza] rpc error", error)
  console.log("[asistencia/tardanza] lateArrivals count", data?.length)
  if (!error && Array.isArray(data) && data.length === 0) {
    console.warn("[asistencia/tardanza] empty result")
  }
  return { data, error }
}

export async function getAttendanceMarks(includeEvidence = false) {
  if (!includeEvidence) {
    const { data, error } = await supabase.rpc("get_attendance_terminal_marks")
    return { data: data || [], error }
  }
  const { data, error } = await supabase
    .from("attendance_marks")
    .select("*")
    .order("marked_at", { ascending: false })
    .limit(1000)
  if (error) return { data: [], error }
  const records = await Promise.all((data || []).map(async (record) => {
    const { data: signedData } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(record.photo_path, 3600)
    return { ...record, photo_url: signedData?.signedUrl || "" }
  }))
  return { data: records, error: null }
}
