import { normalizeRole } from "./profilePermissions.js"
import { canAccessModule } from "./authModulePermissions.js"

export const navigationItems = [
  { module: "dashboard", to: "/dashboard", label: "Dashboard" },
  { module: "pos", to: "/pos", label: "Punto de Venta", submenu: "pos" },
  { module: "cash", to: "/cash", label: "Caja" },
  { module: "production", to: "/production", label: "Producción" },
  { module: "bakery", to: "/bakery", label: "Panadería / Pastelería" },
  { module: "requisitions", to: "/requisitions", label: "Requisiciones" },
  { module: "inventory", to: "/inventory", label: "Inventario", submenu: "inventory" },
  { module: "hr", to: "/hr", label: "Recursos Humanos", submenu: "hr" },
  { module: "tasks", to: "/tasks?view=dashboard", label: "Tareas" },
  { module: "reports", to: "/reports", label: "Reportes" },
  { module: "finance", to: "/finance", label: "Finanzas", submenu: "finance" },
  { module: "catering", to: "/catering", label: "Catering" },
  { module: "settings", to: "/settings", label: "Configuración", submenu: "settings" }
]

export const inventorySubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina"], to: "/inventory?section=inventario", label: "Productos" },
  { roles: ["admin", "gerente_general", "encargado_almacen"], to: "/inventory?section=categorias", label: "Categorías" },
  { roles: ["admin", "gerente_general", "encargado_almacen"], to: "/inventory?section=duplicados", label: "Duplicados" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina"], to: "/inventory?section=movimientosInventario", label: "Movimientos" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina"], to: "/inventory?section=inventarioAreas", label: "Inventario por áreas" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=areas", label: "Áreas operativas" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen"], to: "/inventory?section=ordenes", label: "Órdenes de compra" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "recursos_humanos", "rrhh"], to: "/inventory?section=proveedores", label: "Proveedores" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/inventory?section=recetas", label: "Recetas estandarizadas" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/inventory?section=implementacionPos", label: "Implementación POS" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor", "cocina", "pizzeria", "panadero", "repostero"], to: "/inventory?section=produccionInterna", label: "Producción interna" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/inventory?section=conversiones", label: "Conversiones" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor", "encargado_almacen"], to: "/inventory?section=rendimientos", label: "Rendimientos" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=auditoriasRendimiento", label: "Auditorías de rendimiento" }
]

function submenuAllowsRole(allowedRoles, userRole) {
  const normalizedUserRole = normalizeRole(userRole)
  return allowedRoles.some((role) => normalizeRole(role) === normalizedUserRole)
}

export function getAllowedMainNavItems(role) {
  return navigationItems.filter((item) => canAccessModule(role, item.module))
}

export function getAllowedInventorySubmenu(role) {
  return inventorySubmenu.filter((item) => submenuAllowsRole(item.roles, role))
}
