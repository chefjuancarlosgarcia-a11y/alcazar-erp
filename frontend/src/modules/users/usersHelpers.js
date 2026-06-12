const HR_PERFORMANCE_FIELDS = [
  { key: "punctuality", label: "Puntualidad" },
  { key: "attendance", label: "Asistencia" },
  { key: "productivity", label: "Productividad" },
  { key: "teamwork", label: "Trabajo en equipo" },
  { key: "cleanliness", label: "Limpieza / orden" },
  { key: "checklistCompliance", label: "Cumplimiento de checklists" },
  { key: "training", label: "Capacitación" },
  { key: "discipline", label: "Disciplina" },
  { key: "culture", label: "Actitud / cultura" }
]

const HR_DOCUMENT_TYPES = [
  { key: "dpi", label: "DPI", legacyKeys: ["dpiFrontal", "dpiReverso"], requiresExpiration: false },
  { key: "contract", label: "Contrato", legacyKeys: ["contrato"], requiresExpiration: false },
  { key: "healthCard", label: "Tarjeta de salud", legacyKeys: ["tarjetaSalud"], requiresExpiration: true },
  { key: "foodHandling", label: "Manipulación de alimentos", legacyKeys: ["tarjetaManipulacionAlimentos"], requiresExpiration: true },
  { key: "backgroundCheck", label: "Antecedentes", legacyKeys: ["antecedentes"], requiresExpiration: true },
  { key: "cv", label: "CV", legacyKeys: ["cv"], requiresExpiration: false },
  { key: "certifications", label: "Certificaciones", legacyKeys: ["certificaciones"], requiresExpiration: false }
]

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysBetween(from, to) {
  const start = toDate(from)
  const end = toDate(to)
  if (!start || !end) return null
  return Math.ceil((end - start) / 86400000)
}

export function calculateEmployeeScore(employee) {
  const performance = employee?.performance || {}
  const values = HR_PERFORMANCE_FIELDS
    .map((field) => Number(performance[field.key]))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function getScoreLabel(score) {
  if (score === null || score === undefined) return { label: "Sin datos", tone: "muted" }
  if (score >= 90) return { label: "Excelente", tone: "good" }
  if (score >= 80) return { label: "Bueno", tone: "good" }
  if (score >= 70) return { label: "En observación", tone: "warning" }
  return { label: "Riesgo", tone: "danger" }
}

function getDocumentStatus(document) {
  if (!document?.file || (document.requiresExpiration && !document.expirationDate)) return "pendiente"
  if (!document.expirationDate) return "vigente"
  const days = daysBetween(new Date(), document.expirationDate)
  if (days === null) return "pendiente"
  if (days < 0) return "vencido"
  if (days <= 30) return "por vencer"
  return "vigente"
}

export function getEmployeeDocuments(employee) {
  const legacy = employee?.documentos || {}
  const structured = employee?.documentosRRHH || employee?.documents || {}
  return HR_DOCUMENT_TYPES.map((type) => {
    const data = structured[type.key] || {}
    const legacyFile = type.legacyKeys.map((key) => legacy[key]).find(Boolean)
    const document = {
      key: type.key,
      nombre: type.label,
      file: data.file || data.archivo || legacyFile || "",
      issueDate: data.issueDate || data.fechaEmision || "",
      expirationDate: data.expirationDate || data.fechaVencimiento || "",
      requiresExpiration: type.requiresExpiration
    }
    return { ...document, status: getDocumentStatus(document) }
  })
}

function getUpcomingBirthdays(employees, days = 30) {
  const today = new Date()
  return employees.filter((employee) => {
    const birth = toDate(employee.fechaCumpleanos || employee.birthDate)
    if (!birth) return false
    const next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate())
    if (next < today) next.setFullYear(today.getFullYear() + 1)
    const diff = daysBetween(today, next)
    return diff !== null && diff <= days
  })
}

function getTrainingStats(employee) {
  const records = employee?.trainingRecords || []
  const completed = records.filter((item) => item.status === "completed")
  const pending = records.filter((item) => item.status === "pending")
  const scores = completed.map((item) => Number(item.score)).filter((score) => Number.isFinite(score))
  return {
    completed: completed.length,
    pending: pending.length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    criticalPending: pending.filter((item) => /obligatoria|inocuidad|seguridad|salud/i.test(`${item.title} ${item.notes}`)).length
  }
}

export function obtenerInicialesColaborador(nombre) {
  const partes = String(nombre || "Colaborador")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  return partes.map((parte) => parte.charAt(0).toUpperCase()).join("") || "?"
}

export function getEstadoColaborador(employee) {
  return employee?.estado || (employee?.activo ? "Activo" : "Inactivo")
}

export function isColaboradorActivo(employee) {
  const estado = getEstadoColaborador(employee)
  return estado === "Activo" || employee?.activo === true
}

export function generateUsernameFromName(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
  return base || `usuario.${Date.now()}`
}

export function getUserAuth(user) {
  return {
    username: user?.auth?.username || user?.username || generateUsernameFromName(user?.nombre),
    passwordHash: user?.auth?.passwordHash || user?.password || "",
    temporaryPassword: "",
    mustChangePassword: user?.auth?.mustChangePassword ?? !user?.auth,
    lastLogin: user?.auth?.lastLogin || user?.lastLogin || null,
    isOnline: user?.auth?.isOnline ?? false,
    status: user?.auth?.status || (user?.estado === "Inactivo" || user?.activo === false ? "inactive" : user?.estado === "Suspendido" ? "suspended" : "active")
  }
}

export function filtrarColaboradores(employees, userSearch, hrFilters) {
  return employees.filter((u) => {
    const t = userSearch.toLowerCase()
    const matchesSearch = !t ||
      String(u.nombre || "").toLowerCase().includes(t) ||
      String(u.username || "").toLowerCase().includes(t) ||
      String(u.rol || "").toLowerCase().includes(t) ||
      String(u.departamento || "").toLowerCase().includes(t) ||
      String(u.puesto || "").toLowerCase().includes(t)
    const matchesPuesto = !hrFilters.puesto || String(u.puesto || "").toLowerCase().includes(hrFilters.puesto.toLowerCase())
    const matchesDepartamento = !hrFilters.departamento || String(u.departamento || "") === hrFilters.departamento
    const estadoActual = getEstadoColaborador(u)
    const matchesEstado = !hrFilters.estado || estadoActual === hrFilters.estado
    const docs = getEmployeeDocuments(u)
    const score = calculateEmployeeScore(u)
    const hasSpecial = !hrFilters.especial ||
      (hrFilters.especial === "docsVencidos" && docs.some((doc) => doc.status === "vencido")) ||
      (hrFilters.especial === "docsPorVencer" && docs.some((doc) => doc.status === "por vencer")) ||
      (hrFilters.especial === "bajoDesempeno" && score !== null && score < 70) ||
      (hrFilters.especial === "cumpleanos" && getUpcomingBirthdays([u]).length > 0) ||
      (hrFilters.especial === "capacitaciones" && getTrainingStats(u).pending > 0)
    return matchesSearch && matchesPuesto && matchesDepartamento && matchesEstado && hasSpecial
  }).sort((a, b) => {
    if (hrFilters.ordenar === "fechaIngreso") return String(a.fechaInicioLabores || "").localeCompare(String(b.fechaInicioLabores || ""))
    if (hrFilters.ordenar === "score") return (calculateEmployeeScore(b) || 0) - (calculateEmployeeScore(a) || 0)
    if (hrFilters.ordenar === "puntualidad") return Number(b.performance?.punctuality || 0) - Number(a.performance?.punctuality || 0)
    if (hrFilters.ordenar === "documentos") {
      return getEmployeeDocuments(b).filter((doc) => doc.status === "vencido").length -
        getEmployeeDocuments(a).filter((doc) => doc.status === "vencido").length
    }
    if (hrFilters.ordenar === "antiguedad") {
      return new Date(a.fechaInicioLabores || Date.now()) - new Date(b.fechaInicioLabores || Date.now())
    }
    return String(a.nombre || "").localeCompare(String(b.nombre || ""))
  })
}

export function computeUsersKpis(employees) {
  const activos = employees.filter(isColaboradorActivo).length
  const inactivos = employees.length - activos
  const porRol = Object.entries(
    employees.reduce((acc, employee) => {
      const rol = String(employee.rol || "Sin rol").trim() || "Sin rol"
      acc[rol] = (acc[rol] || 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const porArea = Object.entries(
    employees.reduce((acc, employee) => {
      const area = String(employee.departamento || "Sin área").trim() || "Sin área"
      acc[area] = (acc[area] || 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return {
    total: employees.length,
    activos,
    inactivos,
    porRol,
    porArea
  }
}

export function getEstadoBadgeClass(estado, activo) {
  if (estado === "Activo" || activo) return "erp-badge--success"
  if (estado === "Suspendido") return "erp-badge--warning"
  return "erp-badge--danger"
}
