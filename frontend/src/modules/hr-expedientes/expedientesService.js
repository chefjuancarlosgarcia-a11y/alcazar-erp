import { supabase } from "../../lib/supabase"

const BUCKET = "employee-documents"

function message(error) {
  return typeof error === "string" ? error : error?.message || "No fue posible completar la operacion de expedientes."
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

function migrationHint(error, needsDocumentUx = false, needsDiscipline = false) {
  const text = message(error).toLowerCase()
  if (text.includes("could not find the function") || text.includes("does not exist") || text.includes("no_expires") || text.includes("employee_incidents")) {
    if (needsDiscipline) {
      return "Aplica las migraciones 090-093 en Supabase antes de usar disciplina e incidentes."
    }
    if (needsDocumentUx) {
      return "Aplica las migraciones 090, 091 y 092 en Supabase antes de usar esta funcion."
    }
    return "Aplica las migraciones 090 y 091 en Supabase antes de usar este modulo."
  }
  return message(error)
}

export async function getExpedientesDashboard() {
  const { data, error } = await supabase.rpc("get_employee_expedientes_dashboard")
  return result(data, error ? migrationHint(error) : null)
}

export async function listExpedientes(filters = {}) {
  const { data, error } = await supabase.rpc("get_employee_expedientes", {
    p_search: filters.search || null,
    p_area: filters.area || null,
    p_job_title: filters.jobTitle || null,
    p_status: filters.status || null,
    p_expired_only: Boolean(filters.expiredOnly),
    p_incomplete_only: Boolean(filters.incompleteOnly),
    p_limit: filters.limit || 300,
    p_offset: filters.offset || 0
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function getExpedienteDetail(profileId) {
  const { data, error } = await supabase.rpc("get_employee_expediente_detail", {
    p_profile_id: profileId
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function saveExpedienteProfile(profileId, payload) {
  const { data, error } = await supabase.rpc("upsert_employee_expediente_profile", {
    p_profile_id: profileId,
    p_data: payload
  })
  return result(data, error)
}

export async function syncExpedienteAlerts(profileId = null) {
  const { data, error } = await supabase.rpc("sync_employee_expediente_alerts", {
    p_profile_id: profileId
  })
  return result(data ?? 0, error)
}

export async function getExpedientesReport(reportType = "summary") {
  const { data, error } = await supabase.rpc("get_employee_expedientes_report", {
    p_report_type: reportType
  })
  return result(data, error)
}

export async function getSignedDocumentUrl(storagePath, expiresIn = 3600) {
  if (!storagePath) return result("", null)
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn)
  return result(data?.signedUrl || "", error)
}

function safeFileName(name) {
  return String(name || "documento").replace(/[^\w.\-]+/g, "_")
}

export async function uploadEmployeeDocument({
  profileId,
  fileTypeCode,
  storageFolder,
  file,
  issuedAt = null,
  expiresAt = null,
  noExpires = false,
  signatureStatus = null,
  notes = null,
  metadata = {}
}) {
  if (!file) return result(null, "Selecciona un archivo.")
  const path = `${profileId}/${storageFolder}/${fileTypeCode}/${Date.now()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
    upsert: false
  })
  if (uploadError) return result(null, uploadError)

  const { data, error } = await supabase.rpc("register_employee_file_version", {
    p_profile_id: profileId,
    p_file_type_code: fileTypeCode,
    p_storage_path: path,
    p_file_name: file.name,
    p_mime_type: file.type || null,
    p_file_size: file.size || null,
    p_issued_at: issuedAt || null,
    p_expires_at: expiresAt || null,
    p_no_expires: Boolean(noExpires),
    p_signature_status: signatureStatus || null,
    p_notes: notes || null,
    p_metadata: metadata
  })
  return result(data, error)
}

export async function updateEmployeeFileCurrent({
  profileId,
  fileTypeCode,
  issuedAt = null,
  expiresAt = null,
  noExpires = false,
  signatureStatus = null,
  notes = null
}) {
  const { data, error } = await supabase.rpc("update_employee_file_current", {
    p_profile_id: profileId,
    p_file_type_code: fileTypeCode,
    p_issued_at: issuedAt || null,
    p_expires_at: expiresAt || null,
    p_no_expires: Boolean(noExpires),
    p_signature_status: signatureStatus || null,
    p_notes: notes || null
  })
  return result(data, error ? migrationHint(error, true) : null)
}

export async function removeEmployeeFileCurrent(profileId, fileTypeCode) {
  const { data, error } = await supabase.rpc("remove_employee_file_current", {
    p_profile_id: profileId,
    p_file_type_code: fileTypeCode
  })
  return result(data, error ? migrationHint(error, true) : null)
}

export async function getDisciplineDetail(profileId) {
  const { data, error } = await supabase.rpc("get_employee_discipline_detail", {
    p_profile_id: profileId
  })
  return result(data, error ? migrationHint(error, false, true) : null)
}

export async function saveIncident(profileId, payload) {
  const { data, error } = await supabase.rpc("upsert_employee_incident", {
    p_profile_id: profileId,
    p_data: payload
  })
  return result(data, error ? migrationHint(error, false, true) : null)
}

export async function closeIncident(incidentId, closureSummary = null) {
  const { data, error } = await supabase.rpc("close_employee_incident", {
    p_incident_id: incidentId,
    p_closure_summary: closureSummary
  })
  return result(data, error ? migrationHint(error, false, true) : null)
}

export async function saveDisciplinaryAction(profileId, payload) {
  const { data, error } = await supabase.rpc("upsert_disciplinary_action", {
    p_profile_id: profileId,
    p_data: payload
  })
  return result(data, error ? migrationHint(error, false, true) : null)
}

export async function uploadIncidentEvidence({ profileId, incidentId, file, description = null }) {
  if (!file) return result(null, "Selecciona un archivo de evidencia.")
  const path = `${profileId}/incidents/${incidentId}/${Date.now()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
    upsert: false
  })
  if (uploadError) return result(null, uploadError)

  const { data, error } = await supabase.rpc("register_incident_evidence", {
    p_incident_id: incidentId,
    p_storage_path: path,
    p_file_name: file.name,
    p_mime_type: file.type || null,
    p_file_size: file.size || null,
    p_description: description
  })
  return result(data, error ? migrationHint(error, false, true) : null)
}

export async function uploadDisciplinaryDocument({ profileId, file }) {
  if (!file) return result(null, "Selecciona un documento.")
  const path = `${profileId}/discipline/${Date.now()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
    upsert: false
  })
  if (uploadError) return result(null, uploadError)
  return result({ storagePath: path, fileName: file.name }, null)
}
