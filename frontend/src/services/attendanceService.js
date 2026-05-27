import { supabase } from "../lib/supabase"

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

export function registerAttendanceMark({ employeeId, pin, markType, photoPath, deviceId, deviceName }) {
  return supabase.rpc("register_attendance_mark", {
    p_employee_id: employeeId,
    p_pin: pin,
    p_mark_type: markType,
    p_photo_path: photoPath,
    p_device_id: deviceId,
    p_device_name: deviceName
  })
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
