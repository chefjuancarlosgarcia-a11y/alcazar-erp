import { useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { normalizeRole } from "../utils/profilePermissions"
import useAppBranding from "../hooks/useAppBranding"
import BrandLogo from "./branding/BrandLogo"
import "./Sidebar.css"

function submenuAllowsRole(allowedRoles, userRole) {
  const normalizedUserRole = normalizeRole(userRole)
  return allowedRoles.some((role) => normalizeRole(role) === normalizedUserRole)
}

const navigationItems = [
  { module: "dashboard", to: "/dashboard", label: "Dashboard" },
  { module: "pos", to: "/pos", label: "Punto de Venta", submenu: "pos" },
  { module: "cash", to: "/cash", label: "Caja" },
  { module: "production", to: "/production", label: "Producción" },
  { module: "inventory", to: "/inventory", label: "Inventario", submenu: "inventory" },
  { module: "hr", to: "/hr", label: "Recursos Humanos", submenu: "hr" },
  { module: "tasks", to: "/tasks", label: "Tareas" },
  { module: "reports", to: "/reports", label: "Reportes" },
  { module: "finance", to: "/finance", label: "Finanzas", submenu: "finance" },
  { module: "catering", to: "/catering", label: "Catering" },
  { module: "settings", to: "/settings", label: "Configuración", submenu: "settings" }
]

const inventorySubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina"], to: "/inventory?section=inventario", label: "Productos" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor", "encargado_area", "cocina"], to: "/inventory?section=requisicion", label: "Requisiciones" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina"], to: "/inventory?section=movimientosInventario", label: "Movimientos" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina"], to: "/inventory?section=inventarioAreas", label: "Inventario por áreas" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=areas", label: "Áreas operativas" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen"], to: "/inventory?section=ordenes", label: "Órdenes de compra" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "recursos_humanos", "rrhh"], to: "/inventory?section=proveedores", label: "Proveedores" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/inventory?section=recetas", label: "Recetas estandarizadas" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor", "cocina", "pizzeria", "panadero", "repostero"], to: "/inventory?section=produccionInterna", label: "Producción interna" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/inventory?section=conversiones", label: "Conversiones" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor", "encargado_almacen"], to: "/inventory?section=rendimientos", label: "Rendimientos" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=auditoriasRendimiento", label: "Auditorías de rendimiento" }
]

const hrSubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "recursos_humanos", "rrhh"], to: "/hr?section=usuarios", label: "Colaboradores" },
  { roles: ["admin", "gerente_general", "recursos_humanos", "rrhh"], to: "/hr?section=expedientes", label: "Expedientes" },
  { roles: ["admin", "gerente_general", "recursos_humanos", "rrhh", "gerente", "supervisor"], to: "/hr?section=reclutamiento", label: "Reclutamiento" },
  { roles: ["admin", "gerente_general"], to: "/hr?section=catalogos", label: "Roles y áreas" },
  { roles: ["admin", "gerente", "gerente_general", "recursos_humanos", "rrhh", "supervisor", "caja", "mesero", "cocina", "barista", "bartender", "pizzeria", "repostero", "panadero", "colaborador"], to: "/hr?section=horarios", label: "Horarios" },
  { roles: ["admin", "gerente", "gerente_general", "recursos_humanos", "rrhh", "mesero", "cocina"], to: "/hr?section=asistencia", label: "Marcaje de asistencia" },
  { roles: ["admin", "gerente_general", "recursos_humanos", "rrhh"], to: "/hr?section=dispositivosMarcaje", label: "Dispositivos de marcaje" },
  { roles: ["admin", "gerente", "gerente_general", "recursos_humanos", "rrhh"], to: "/hr?section=reportesAsistencia", label: "Reportes de asistencia" }
]

const posSubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "mesero", "supervisor", "caja"], to: "/pos?section=pos", label: "Punto de Venta" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/pos?section=agregar-item", label: "Agregar platillo" },
  { roles: ["admin", "gerente", "gerente_general", "gerente_operaciones"], to: "/pos?section=categorias", label: "Secciones del menú" },
  { roles: ["admin", "gerente", "gerente_general", "gerente_operaciones"], to: "/pos?section=croquis", label: "Plano del restaurante" }
]

const financeSubmenu = [
  { roles: ["admin", "gerente_general", "contador"], to: "/finance?tab=resumen", label: "Resumen" },
  { roles: ["admin", "gerente_general", "contador"], to: "/finance?tab=bancos", label: "Bancos" },
  { roles: ["admin", "gerente_general", "contador"], to: "/finance?tab=pagos", label: "Cuentas por pagar" },
  { roles: ["admin", "gerente_general", "contador"], to: "/finance?tab=cobros", label: "Cuentas por cobrar" },
  { roles: ["admin", "gerente_general", "contador"], to: "/finance?tab=flujo", label: "Flujo de caja" },
  { roles: ["admin", "gerente_general", "contador"], to: "/finance?tab=conciliacion", label: "Conciliación" }
]

const settingsSubmenu = [
  { roles: ["admin", "gerente_general"], to: "/settings", label: "Apariencia y Marca" },
  { roles: ["admin", "gerente_general", "supervisor"], to: "/settings/tickets", label: "Diseno de Tickets" }
]

function Sidebar({ compact = false, mobile = false, onNavigate }) {
  const { user, canAccess, logout } = useAuth()
  const branding = useAppBranding()
  const location = useLocation()
  const accent = branding.primaryColor || branding.accentColor
  const [openSubmenu, setOpenSubmenu] = useState(
    location.pathname === "/inventory"
      ? "inventory"
      : location.pathname === "/hr"
        ? "hr"
        : location.pathname === "/finance"
          ? "finance"
        : location.pathname === "/pos"
          ? "pos"
          : location.pathname.startsWith("/settings")
            ? "settings"
            : null
  )
  const visibleSubmenu = ["/inventory", "/hr", "/finance", "/pos"].includes(location.pathname) || location.pathname.startsWith("/settings") ? openSubmenu : null
  const allowedItems = navigationItems.filter((item) => canAccess(item.module))
  const allowedInventorySubmenu = inventorySubmenu.filter((item) => submenuAllowsRole(item.roles, user?.role))
  const allowedPosSubmenu = posSubmenu.filter((item) => submenuAllowsRole(item.roles, user?.role))
  const allowedHrSubmenu = hrSubmenu.filter((item) => submenuAllowsRole(item.roles, user?.role))
  const allowedFinanceSubmenu = financeSubmenu.filter((item) => submenuAllowsRole(item.roles, user?.role))
  const allowedSettingsSubmenu = settingsSubmenu.filter((item) => submenuAllowsRole(item.roles, user?.role))

  function isMainActive(item) {
    if (item.to === "/dashboard") return location.pathname === "/dashboard" || location.pathname === "/"
    return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  }

  function clearFocus(event) {
    event.currentTarget?.blur?.()
  }

  function handleMainClick(item, event) {
    clearFocus(event)
    if (item.submenu) setOpenSubmenu((current) => (current === item.submenu ? null : item.submenu))
    if (!item.submenu) setOpenSubmenu(null)
    onNavigate?.()
  }

  async function handleLogout() {
    await logout()
    onNavigate?.()
  }

  function renderSubmenu(module, items) {
    if (visibleSubmenu !== module) return null
    return (
      <div style={submenuStyle}>
        {items.map((subitem) => {
          const isSubActive = location.pathname + location.search === subitem.to || (subitem.to === "/pos?section=pos" && location.pathname === "/pos" && !location.search)
          return (
            <NavLink
              className={`erp-sidebar-subitem ${isSubActive ? "active" : ""}`}
              key={subitem.to}
              to={subitem.to}
              onClick={(event) => {
                clearFocus(event)
                onNavigate?.()
              }}
              style={{
                ...submenuLinkStyle,
                ...(isSubActive ? activeSubmenuLinkStyle : {})
              }}
            >
              {subitem.label}
            </NavLink>
          )
        })}
      </div>
    )
  }

  return (
    <aside className="erp-sidebar" style={{ ...sidebarStyle, "--sidebar-accent": accent, ...(compact ? compactSidebarStyle : {}), ...(mobile ? mobileSidebarStyle : {}) }}>
      <BrandLogo branding={branding} variant="sidebar" showText={!compact} className="brand-logo-sidebar" />

      <nav style={navStyle}>
        {allowedItems.map((item) => (
          <div key={item.to} style={navGroupStyle}>
            <NavLink
              className={`erp-sidebar-link ${isMainActive(item) ? "active" : ""}`}
              to={item.to}
              end={!["/inventory", "/production", "/pos", "/hr", "/finance", "/settings"].includes(item.to)}
              onClick={(event) => handleMainClick(item, event)}
              style={() => ({
                ...linkStyle,
                ...(isMainActive(item) ? activeLinkStyle : {})
              })}
            >
              <span style={navLabelStyle}>{item.label}</span>
              {item.submenu && <span style={chevronStyle}>{visibleSubmenu === item.submenu ? "▾" : "▸"}</span>}
            </NavLink>
            {item.module === "inventory" && renderSubmenu("inventory", allowedInventorySubmenu)}
            {item.module === "pos" && renderSubmenu("pos", allowedPosSubmenu)}
            {item.module === "hr" && renderSubmenu("hr", allowedHrSubmenu)}
            {item.module === "finance" && renderSubmenu("finance", allowedFinanceSubmenu)}
            {item.module === "settings" && renderSubmenu("settings", allowedSettingsSubmenu)}
          </div>
        ))}
      </nav>

      <button type="button" onClick={handleLogout} style={logoutButtonStyle}>
        Cerrar sesión
      </button>
    </aside>
  )
}

const sidebarStyle = {
  position: "relative",
  zIndex: 20,
  width: "280px",
  minHeight: "100vh",
  flex: "0 0 280px",
  padding: "20px",
  boxSizing: "border-box",
  overflowY: "auto",
  pointerEvents: "auto"
}

const compactSidebarStyle = { width: "224px", flexBasis: "224px", padding: "15px" }

const mobileSidebarStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  bottom: 0,
  zIndex: 70,
  width: "min(300px, 86vw)",
  minHeight: "100svh",
  boxShadow: "18px 0 42px rgba(0, 0, 0, .42)"
}

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "28px",
  padding: "12px",
  border: "1px solid #1f3046",
  borderRadius: "16px",
  background: "rgba(15, 23, 42, .72)"
}

const compactBrandStyle = { marginBottom: "18px", padding: "10px" }

const brandIconStyle = {
  display: "grid",
  placeItems: "center",
  width: "42px",
  height: "42px",
  flex: "0 0 42px",
  border: "1px solid",
  borderRadius: "14px",
  background: "rgba(20, 184, 166, .1)",
  fontWeight: 950,
  letterSpacing: "-.04em"
}

const brandLogoImageStyle = { width: "100%", height: "100%", objectFit: "cover", borderRadius: "12px" }
const brandTextStyle = { minWidth: 0 }
const brandSubtitleStyle = { display: "block", color: "#94a3b8", fontSize: "0.82rem", marginTop: "2px" }
const navStyle = { display: "grid", gap: "6px" }
const navGroupStyle = { display: "grid", gap: "5px" }

const linkStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "11px 12px 11px 14px",
  borderRadius: "12px",
  color: "var(--erp-text-secondary, #cbd5e1)",
  textDecoration: "none",
  border: "1px solid transparent",
  outline: "none",
  background: "transparent",
  cursor: "pointer",
  pointerEvents: "auto"
}

const navLabelStyle = { display: "inline-flex", alignItems: "center", gap: "9px", fontWeight: 750 }

const activeLinkStyle = {
  color: "var(--erp-text-primary, #f0fdfa)"
}

const chevronStyle = { color: "#64748b", fontSize: "0.9rem", lineHeight: 1 }
const submenuStyle = { display: "grid", gap: "4px", padding: "2px 0 5px 14px" }

const submenuLinkStyle = {
  display: "block",
  padding: "8px 10px",
  borderRadius: "10px",
  color: "#94a3b8",
  textDecoration: "none",
  border: "1px solid transparent",
  outline: "none",
  background: "transparent",
  fontSize: "0.9rem",
  cursor: "pointer",
  pointerEvents: "auto"
}

const activeSubmenuLinkStyle = {
  color: "#e6eef8",
  background: "rgba(30, 41, 59, .7)"
}

const logoutButtonStyle = {
  width: "100%",
  marginTop: "24px",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid color-mix(in srgb, var(--erp-primary, #14b8a6) 20%, #24344a)",
  background: "var(--erp-surface, #111827)",
  color: "var(--erp-text-primary, #e6eef8)",
  cursor: "pointer"
}

export default Sidebar
