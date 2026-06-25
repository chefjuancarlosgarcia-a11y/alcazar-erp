export const RECRUITMENT_FULL_ACCESS_ROLES = [
  "admin",
  "gerente_general",
  "gerente",
  "recursos_humanos",
  "rrhh"
]

export const RECRUITMENT_VACANCY_REQUEST_ROLES = [
  ...RECRUITMENT_FULL_ACCESS_ROLES,
  "gerente",
  "supervisor"
]

export const RECRUITMENT_ACCESS_DENIED =
  "No tienes permiso para acceder al módulo de reclutamiento."

export const VACANCY_PRIORITIES = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Crítica" }
]

export const VACANCY_REASONS = [
  { value: "resignation", label: "Renuncia" },
  { value: "replacement", label: "Reemplazo" },
  { value: "expansion", label: "Expansión" },
  { value: "temporary", label: "Temporal" },
  { value: "operational_reinforcement", label: "Refuerzo operativo" }
]

export const VACANCY_STATUSES = [
  { value: "open", label: "Abierta" },
  { value: "recruiting", label: "En reclutamiento" },
  { value: "interviewing", label: "En entrevistas" },
  { value: "filled", label: "Cubierta" },
  { value: "cancelled", label: "Cancelada" }
]

export const PIPELINE_COLUMNS = [
  { value: "applied", label: "Aplicó" },
  { value: "contacted", label: "Contactado" },
  { value: "interview_scheduled", label: "Entrevista programada" },
  { value: "interviewed", label: "Entrevistado" },
  { value: "offer", label: "Oferta" },
  { value: "hired", label: "Contratado" },
  { value: "discarded", label: "Descartado" }
]

export const CANDIDATE_SOURCES = [
  { value: "facebook", label: "Facebook" },
  { value: "empleo_restaurantes_xela", label: "Empleo Restaurantes Xela" },
  { value: "referral", label: "Referido" },
  { value: "walk_in", label: "Walk-in" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "other", label: "Otro" }
]

export const CONTACT_TYPES = [
  { value: "call", label: "Llamada" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "in_person", label: "Presencial" },
  { value: "other", label: "Otro" }
]

export const CONTACT_RESULTS = [
  { value: "answered", label: "Contestó" },
  { value: "no_answer", label: "No contestó" },
  { value: "wrong_number", label: "Número incorrecto" },
  { value: "callback_requested", label: "Pidió devolución" },
  { value: "not_interested", label: "No interesado" }
]

export const INTERVIEW_RESULTS = [
  { value: "attended", label: "Asistió" },
  { value: "no_show", label: "No llegó" },
  { value: "rescheduled", label: "Reagendó" },
  { value: "cancelled", label: "Canceló" }
]

export const EVAL_RECOMMENDATIONS = [
  { value: "hire", label: "Contratar" },
  { value: "second_interview", label: "Segunda entrevista" },
  { value: "discard", label: "Descartar" }
]

export const DISCARD_REASONS = [
  { value: "no_response", label: "No respondió" },
  { value: "no_show", label: "No llegó" },
  { value: "salary", label: "Salario" },
  { value: "schedule", label: "Horario" },
  { value: "no_experience", label: "Sin experiencia" },
  { value: "far_location", label: "Vive lejos" },
  { value: "bad_attitude", label: "Mala actitud" },
  { value: "bad_presentation", label: "Mala presentación" },
  { value: "profile_mismatch", label: "No cumple perfil" },
  { value: "other", label: "Otro" }
]

export function normalizeRecruitmentRole(role) {
  const value = String(role || "").trim().toLowerCase()
  return value === "rrhh" ? "recursos_humanos" : value
}

export function canManageRecruitment(role) {
  const normalized = normalizeRecruitmentRole(role)
  return RECRUITMENT_FULL_ACCESS_ROLES.some((item) => normalizeRecruitmentRole(item) === normalized)
}

export function canRequestRecruitmentVacancy(role) {
  const normalized = normalizeRecruitmentRole(role)
  return RECRUITMENT_VACANCY_REQUEST_ROLES.some((item) => normalizeRecruitmentRole(item) === normalized)
}

export function labelFor(options, value) {
  return options.find((item) => item.value === value)?.label || value || "—"
}

export function priorityTone(priority) {
  if (priority === "critical") return "critical"
  if (priority === "high") return "high"
  if (priority === "medium") return "medium"
  return "low"
}

export function statusTone(status) {
  if (status === "filled" || status === "hired") return "success"
  if (status === "cancelled" || status === "discarded") return "muted"
  if (status === "critical" || status === "interviewing") return "warning"
  return "default"
}

export function defaultMonthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10)
  }
}

export function emptyVacancyForm(userId = "") {
  return {
    id: "",
    position_title: "",
    area: "",
    quantity_required: 1,
    requested_by: userId,
    request_date: new Date().toISOString().slice(0, 10),
    target_date: "",
    priority: "medium",
    reason: "replacement",
    status: "open",
    notes: ""
  }
}

export const ONBOARDING_STATUSES = [
  { value: "none", label: "Sin proceso" },
  { value: "pending_conversion", label: "Contratado — pendiente convertir" },
  { value: "employee_created", label: "Colaborador creado" },
  { value: "expediente_created", label: "Expediente creado" },
  { value: "onboarding_active", label: "Onboarding activo" },
  { value: "onboarding_completed", label: "Onboarding completado" }
]

export const CONTRACT_TYPES = [
  { value: "indefinido", label: "Indefinido" },
  { value: "temporal", label: "Temporal" },
  { value: "medio_tiempo", label: "Medio tiempo" },
  { value: "por_servicios", label: "Por servicios" }
]

export const RETENTION_STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "yes", label: "Sigue activo" },
  { value: "no", label: "No sigue activo" }
]

export function canViewRecruitmentOnboarding(role) {
  const normalized = normalizeRecruitmentRole(role)
  return canManageRecruitment(role) || normalized === "supervisor"
}

export function onboardingStatusTone(status) {
  if (status === "onboarding_completed") return "success"
  if (status === "pending_conversion") return "warning"
  if (status === "onboarding_active") return "default"
  return "muted"
}

export function emptyConversionForm(detail = {}, profiles = []) {
  const candidate = detail?.candidate || {}
  const vacancy = detail?.vacancy || {}
  return {
    hire_date: new Date().toISOString().slice(0, 10),
    area: vacancy.area || candidate.final_area || "",
    area_id: "",
    final_position: candidate.position_applied || vacancy.position_title || "",
    erp_role: "colaborador",
    contract_type: "indefinido",
    agreed_salary: candidate.salary_expectation || "",
    initial_schedule: candidate.schedule_availability || "",
    supervisor_profile_id: "",
    create_erp_user: true,
    create_expediente: true,
    create_onboarding: true,
    existing_profile_id: "",
    email: "",
    username: "",
    password: "",
    employee_id: "",
    profile_status: "active",
    hire_reason: vacancy.reason || "replacement"
  }
}

export function emptyCandidateForm(vacancyId = "") {
  return {
    id: "",
    vacancy_id: vacancyId,
    full_name: "",
    phone: "",
    whatsapp: "",
    age: "",
    address: "",
    position_applied: "",
    source: "other",
    prior_experience: "",
    schedule_availability: "",
    salary_expectation: "",
    pipeline_status: "applied",
    applied_at: new Date().toISOString().slice(0, 10),
    notes: "",
    internal_notes: ""
  }
}
