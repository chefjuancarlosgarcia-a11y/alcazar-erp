export const MODULES = {
  dashboard: "/dashboard",
  inventory: "/inventory",
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

export const ROLE_PERMISSIONS = {
  admin: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "finance", "settings", "operations_center", "bakery"],
  ceo: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "settings"],
  gerente_general: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "finance", "settings", "operations_center", "bakery"],
  gerente: ["dashboard", "inventory", "hr", "tasks", "bakery"],
  gerente_operaciones: ["pos", "production", "hr", "catering"],
  encargado_almacen: ["inventory"],
  rrhh: ["inventory", "hr", "tasks"],
  recursos_humanos: ["inventory", "hr", "tasks"],
  supervisor: ["dashboard", "pos", "cash", "production", "hr", "tasks", "inventory", "reports"],
  ventas: ["tasks", "catering"],
  cajero: ["pos", "cash", "hr"],
  caja: ["pos", "cash", "hr"],
  mesero: ["pos", "hr"],
  cocinero: ["inventory", "production", "hr"],
  cocina: ["inventory", "production", "hr"],
  encargado_area: ["inventory", "production", "hr", "tasks"],
  barista: ["production", "hr"],
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
