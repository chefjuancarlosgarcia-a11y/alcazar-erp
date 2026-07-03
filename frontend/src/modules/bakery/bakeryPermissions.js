const BAKERY_ALLOWED_ROLES = [
  "admin",
  "gerente",
  "gerente_general",
  "supervisor_panaderia"
]

const BAKERY_PLAN_MANAGER_ROLES = [
  "admin",
  "gerente",
  "gerente_general"
]

export function canAccessBakeryModule(role) {
  return BAKERY_ALLOWED_ROLES.includes(role)
}

export function canManageBakeryPlans(role) {
  return BAKERY_PLAN_MANAGER_ROLES.includes(role)
}

export function canOperateBakeryProduction(role) {
  return BAKERY_ALLOWED_ROLES.includes(role)
}

export const BAKERY_PLAN_STATUSES = [
  { value: "planned", label: "Planificado" },
  { value: "in_progress", label: "En producción" },
  { value: "delivered", label: "Entregado" },
  { value: "partial", label: "Parcial" },
  { value: "cancelled", label: "Cancelado" }
]

export const BAKERY_PRIORITIES = [
  { value: "low", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" }
]

export const BAKERY_QUALITY_OPTIONS = [
  { value: "good", label: "Buena" },
  { value: "acceptable", label: "Aceptable" },
  { value: "failed", label: "Fallida" }
]

export const BAKERY_DOUGH_STATUSES = [
  { value: "mixed", label: "Mezclada" },
  { value: "resting", label: "Reposo" },
  { value: "balled", label: "Boleada" },
  { value: "cold_room", label: "Cuarto frío" },
  { value: "ready", label: "Lista" },
  { value: "used", label: "Usada" },
  { value: "discarded", label: "Descartada" }
]

export const BAKERY_WASTE_REASONS = [
  { value: "burned", label: "Quemado" },
  { value: "overfermented", label: "Sobre fermentado" },
  { value: "expired", label: "Vencido" },
  { value: "dropped", label: "Caído / accidente" },
  { value: "recipe_error", label: "Error de receta" },
  { value: "poor_quality", label: "Mala calidad" },
  { value: "overproduction", label: "Sobreproducción" },
  { value: "other", label: "Otro" }
]

export const COLD_ROOM_ALERT_HOURS = 48

export { BAKERY_ALLOWED_ROLES, BAKERY_PLAN_MANAGER_ROLES }
