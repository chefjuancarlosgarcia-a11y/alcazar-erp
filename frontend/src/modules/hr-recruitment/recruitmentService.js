import { supabase } from "../../lib/supabase"

function message(error) {
  return typeof error === "string" ? error : error?.message || "Error en reclutamiento."
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

const MIGRATION_HINT = "Aplica las migraciones 117, 118 y 126 de reclutamiento en Supabase."

function migrationHint(error) {
  const text = message(error)
  if (/does not exist|Could not find the function|schema cache/i.test(text)) {
    return `${text} ${MIGRATION_HINT}`
  }
  return text
}

export async function listRecruitmentVacancies(filters = {}) {
  const { data, error } = await supabase.rpc("list_recruitment_vacancies", {
    p_status: filters.status || null,
    p_area: filters.area || null,
    p_priority: filters.priority || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function upsertRecruitmentVacancy(payload) {
  const { data, error } = await supabase.rpc("upsert_recruitment_vacancy", { p_payload: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function listRecruitmentCandidates(filters = {}) {
  const { data, error } = await supabase.rpc("list_recruitment_candidates", {
    p_vacancy_id: filters.vacancyId || null,
    p_pipeline_status: filters.pipelineStatus || null,
    p_source: filters.source || null,
    p_area: filters.area || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function getRecruitmentCandidateDetail(candidateId) {
  const { data, error } = await supabase.rpc("get_recruitment_candidate_detail", {
    p_candidate_id: candidateId
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function upsertRecruitmentCandidate(payload) {
  const { data, error } = await supabase.rpc("upsert_recruitment_candidate", { p_payload: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateRecruitmentCandidatePipeline(candidateId, pipelineStatus, notes = null) {
  const { data, error } = await supabase.rpc("update_recruitment_candidate_pipeline", {
    p_candidate_id: candidateId,
    p_pipeline_status: pipelineStatus,
    p_notes: notes
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function registerRecruitmentContact(payload) {
  const { data, error } = await supabase.rpc("register_recruitment_contact", { p_payload: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function scheduleRecruitmentInterview(payload) {
  const { data, error } = await supabase.rpc("schedule_recruitment_interview", { p_payload: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateRecruitmentInterviewResult(interviewId, interviewResult, notes = null) {
  const { data, error } = await supabase.rpc("update_recruitment_interview_result", {
    p_interview_id: interviewId,
    p_result: interviewResult,
    p_notes: notes
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function saveRecruitmentInterviewEvaluation(payload) {
  const { data, error } = await supabase.rpc("save_recruitment_interview_evaluation", { p_payload: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function discardRecruitmentCandidate(candidateId, reason, notes = null) {
  const { data, error } = await supabase.rpc("discard_recruitment_candidate", {
    p_candidate_id: candidateId,
    p_reason: reason,
    p_notes: notes
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function deleteRecruitmentCandidate(candidateId) {
  const { data, error } = await supabase.rpc("delete_recruitment_candidate", {
    p_candidate_id: candidateId
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function hireRecruitmentCandidate(candidateId) {
  const { data, error } = await supabase.rpc("hire_recruitment_candidate", {
    p_candidate_id: candidateId
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getRecruitmentKpis(filters = {}) {
  const { data, error } = await supabase.rpc("get_recruitment_kpis", {
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_position: filters.position || null,
    p_area: filters.area || null,
    p_source: filters.source || null
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getRecruitmentWeeklyReport(weeks = 8) {
  const { data, error } = await supabase.rpc("get_recruitment_weekly_report", {
    p_weeks: weeks
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function listRecruitmentProfiles() {
  const { data, error } = await supabase.rpc("list_recruitment_profiles")
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function convertRecruitmentCandidateToEmployee(candidateId, profileId, payload = {}) {
  const { data, error } = await supabase.rpc("convert_recruitment_candidate_to_employee", {
    p_candidate_id: candidateId,
    p_profile_id: profileId,
    p_payload: payload
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function listRecruitmentOnboardings(status = null) {
  const { data, error } = await supabase.rpc("list_recruitment_onboardings", {
    p_status: status || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function updateRecruitmentOnboardingTaskStatus(taskId, status, notes = null) {
  const { data, error } = await supabase.rpc("update_recruitment_onboarding_task_status", {
    p_task_id: taskId,
    p_status: status,
    p_notes: notes
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function listRecruitmentRetentionCases() {
  const { data, error } = await supabase.rpc("list_recruitment_retention_cases")
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function recordRecruitmentRetentionReview(candidateId, reviewDay, activeStatus, evaluationNotes = null, exitReason = null) {
  const { data, error } = await supabase.rpc("record_recruitment_retention_review", {
    p_candidate_id: candidateId,
    p_review_day: reviewDay,
    p_active_status: activeStatus,
    p_evaluation_notes: evaluationNotes,
    p_exit_reason: exitReason
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getRecruitmentPhase2Dashboard(filters = {}) {
  const { data, error } = await supabase.rpc("get_recruitment_phase2_dashboard", {
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getRecruitmentOriginForProfile(profileId) {
  const { data, error } = await supabase.rpc("get_recruitment_origin_for_profile", {
    p_profile_id: profileId
  })
  return result(data, error ? migrationHint(error) : null)
}
