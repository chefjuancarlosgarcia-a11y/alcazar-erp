export const MODULES = {
  dashboard: "/dashboard",
  inventory: "/inventory",
  requisitions: "/requisitions",
  pos: "/pos",
  cash: "/cash",
  production: "/production",
  hr: "/hr",
  tasks: "/tasks",
  reports: "/reports",
  catering: "/catering",
  finance: "/finance",
  settings: "/settings",
  operations_center: "/operations-center",
  bakery: "/bakery"
}

const REQUISITIONS_MODULE = "requisitions"

function withRequisitions(permissions) {
  if (permissions.includes(REQUISITIONS_MODULE)) return permissions
  return [...permissions, REQUISITIONS_MODULE]
}

export const ROLE_PERMISSIONS = {
  admin: withRequisitions(["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "finance", "settings", "operations_center", "bakery"]),
  ceo: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "settings"],
  gerente_general: withRequisitions(["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "finance", "settings", "operations_center", "bakery"]),
  gerente: withRequisitions(["dashboard", "inventory", "hr", "tasks", "bakery"]),
  gerente_operaciones: ["pos", "production", "hr", "catering"],
  encargado_almacen: withRequisitions(["inventory"]),
  rrhh: ["inventory", "hr", "tasks"],
  recursos_humanos: ["inventory", "hr", "tasks"],
  supervisor: withRequisitions(["dashboard", "pos", "cash", "production", "hr", "tasks", "inventory", "reports"]),
  ventas: ["tasks", "catering"],
  cajero: ["pos", "cash", "hr"],
  caja: ["pos", "cash", "hr"],
  mesero: ["pos", "hr"],
  cocinero: withRequisitions(["inventory", "production", "hr"]),
  cocina: withRequisitions(["inventory", "production", "hr"]),
  encargado_area: withRequisitions(["inventory", "production", "hr", "tasks"]),
  barista: withRequisitions(["production", "hr"]),
  bartender: ["production", "hr"],
  pizzero: ["production", "hr"],
  pizzeria: ["production", "hr"],
  repostero: ["production", "hr"],
  panadero: ["production", "hr"],
  servicio: ["pos", "hr"],
  cafeteria: ["production", "hr"],
  limpieza: ["hr", "tasks"],
  operativo: ["hr"],
  mantenimiento: ["hr", "tasks"],
  repartidor: ["hr"],
  colaborador: ["hr"],
  contador: ["dashboard", "finance"],
  supervisor_panaderia: ["bakery", "hr"]
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.colaborador
}

export function canAccessModule(role, module) {
  return permissionsForRole(role).includes(module)
}
