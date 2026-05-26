import { useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { BRANDING } from "../branding"
import { useAuth } from "../context/AuthContext"

const navigationItems = [
  { module: "dashboard", to: "/dashboard", label: "Dashboard" },
  { module: "pos", to: "/pos", label: "Punto de Venta", submenu: "pos" },
  { module: "cash", to: "/cash", label: "Caja", icon: "▣" },
  { module: "production", to: "/production", label: "Producción", icon: "🔥" },
  { module: "inventory", to: "/inventory", label: "Inventario", submenu: "inventory" },
  { module: "hr", to: "/hr", label: "Recursos Humanos", submenu: "hr" },
  { module: "tasks", to: "/tasks", label: "Tareas" },
  { module: "reports", to: "/reports", label: "Reportes" },
  { module: "settings", to: "/settings", label: "Configuración" }
]

const inventorySubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina", "cocinero"], to: "/inventory?section=inventario", label: "Productos" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor", "encargado_area", "cocina", "cocinero"], to: "/inventory?section=requisicion", label: "Requisiciones" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina", "cocinero"], to: "/inventory?section=movimientosInventario", label: "Movimientos" },
  { roles: ["admin", "gerente", "gerente_general", "encargado_almacen", "cocina", "cocinero"], to: "/inventory?section=inventarioAreas", label: "Inventario por áreas" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=areas", label: "Administrar áreas" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=ordenes", label: "Órdenes de compra" },
  { roles: ["admin", "gerente", "gerente_general"], to: "/inventory?section=proveedores", label: "Proveedores" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/inventory?section=recetas", label: "Recetas estandarizadas" }
]

const hrSubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "rrhh"], to: "/hr?section=usuarios", label: "Colaboradores" },
  { roles: ["admin", "gerente", "gerente_general", "rrhh", "mesero", "cocina", "cocinero"], to: "/hr?section=asistencia", label: "Marcaje de asistencia" },
  { roles: ["admin", "gerente", "gerente_general", "rrhh"], to: "/hr?section=reportesAsistencia", label: "Reportes de asistencia" }
]

const posSubmenu = [
  { roles: ["admin", "gerente", "gerente_general", "mesero", "supervisor", "cajero"], to: "/pos?section=pos", label: "Punto de Venta" },
  { roles: ["admin", "gerente", "gerente_general", "supervisor"], to: "/pos?section=agregar-item", label: "Agregar item" },
  { roles: ["admin", "gerente", "gerente_general", "gerente_operaciones"], to: "/pos?section=categorias", label: "Secciones del menú" },
  { roles: ["admin", "gerente", "gerente_general", "gerente_operaciones"], to: "/pos?section=croquis", label: "Croquis del restaurante" }
]

function Sidebar({ compact = false, mobile = false, onNavigate }) {
  const { user, canAccess, logout } = useAuth()
  const location = useLocation()
  const [openSubmenu, setOpenSubmenu] = useState(location.pathname === "/inventory" ? "inventory" : location.pathname === "/hr" ? "hr" : location.pathname === "/pos" ? "pos" : null)
  const visibleSubmenu = ["/inventory", "/hr", "/pos"].includes(location.pathname) ? openSubmenu : null
  const allowedItems = navigationItems.filter((item) => canAccess(item.module))
  const showInventorySubmenu = canAccess("inventory") && visibleSubmenu === "inventory"
  const showPosSubmenu = canAccess("pos") && visibleSubmenu === "pos"
  const showHrSubmenu = canAccess("hr") && visibleSubmenu === "hr"
  const allowedInventorySubmenu = inventorySubmenu.filter((item) => item.roles.includes(user?.role))
  const allowedPosSubmenu = posSubmenu.filter((item) => item.roles.includes(user?.role))
  const allowedHrSubmenu = hrSubmenu.filter((item) => item.roles.includes(user?.role))

  function handleMainClick(item) {
    if (item.submenu) {
      setOpenSubmenu((current) => (current === item.submenu ? null : item.submenu))
    }

    if (!item.submenu) setOpenSubmenu(null)
    onNavigate?.()
  }

  async function handleLogout() {
    await logout()
    onNavigate?.()
  }

  return (
    <aside style={{ ...sidebarStyle, ...(compact ? compactSidebarStyle : {}), ...(mobile ? mobileSidebarStyle : {}) }}>
      <div style={{ ...brandStyle, ...(compact ? compactBrandStyle : {}) }}>
        <span style={brandIconStyle}>{BRANDING.logo}</span>
        <div>
          <strong>{BRANDING.appName}</strong>
          {!compact && <span style={brandSubtitleStyle}>{user?.name || BRANDING.tagline}</span>}
        </div>
      </div>

      <nav style={navStyle}>
        {allowedItems.map((item) => (
          <div key={item.to} style={navGroupStyle}>
            <NavLink
              to={item.to}
              end={!["/inventory", "/production"].includes(item.to)}
              onClick={() => handleMainClick(item)}
              style={({ isActive }) => ({
                ...linkStyle,
                ...(isActive ? activeLinkStyle : {})
              })}
            >
              <span style={navLabelStyle}>{item.icon && <span aria-hidden="true">{item.icon}</span>}{item.label}</span>
              {item.submenu && <span style={chevronStyle}>{visibleSubmenu === item.submenu ? "▾" : "▸"}</span>}
            </NavLink>

            {item.module === "inventory" && showInventorySubmenu && (
              <div style={submenuStyle}>
                {allowedInventorySubmenu.map((subitem) => (
                  <NavLink
                    key={subitem.to}
                    to={subitem.to}
                    onClick={onNavigate}
                    style={() => ({
                      ...submenuLinkStyle,
                      ...(location.pathname + location.search === subitem.to ? activeSubmenuLinkStyle : {})
                    })}
                  >
                    {subitem.label}
                  </NavLink>
                ))}
              </div>
            )}

            {item.module === "pos" && showPosSubmenu && (
              <div style={submenuStyle}>
                {allowedPosSubmenu.map((subitem) => (
                  <NavLink
                    key={subitem.to}
                    to={subitem.to}
                    onClick={onNavigate}
                    style={() => ({
                      ...submenuLinkStyle,
                      ...((location.pathname + location.search === subitem.to || (subitem.to === "/pos?section=pos" && location.pathname === "/pos" && !location.search)) ? activeSubmenuLinkStyle : {})
                    })}
                  >
                    {subitem.label}
                  </NavLink>
                ))}
              </div>
            )}

            {item.module === "hr" && showHrSubmenu && (
              <div style={submenuStyle}>
                {allowedHrSubmenu.map((subitem) => (
                  <NavLink
                    key={subitem.to}
                    to={subitem.to}
                    onClick={onNavigate}
                    style={() => ({
                      ...submenuLinkStyle,
                      ...(location.pathname + location.search === subitem.to ? activeSubmenuLinkStyle : {})
                    })}
                  >
                    {subitem.label}
                  </NavLink>
                ))}
              </div>
            )}
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
  background: "#0f172a",
  borderRight: "1px solid #263244",
  color: "#e6eef8",
  boxSizing: "border-box",
  overflowY: "auto",
  pointerEvents: "auto"
}

const compactSidebarStyle = {
  width: "224px",
  flexBasis: "224px",
  padding: "15px"
}

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
  marginBottom: "28px"
}

const compactBrandStyle = {
  marginBottom: "18px"
}

const brandIconStyle = {
  fontSize: "28px"
}

const brandSubtitleStyle = {
  display: "block",
  color: "#94a3b8",
  fontSize: "0.85rem",
  marginTop: "2px"
}

const navStyle = {
  display: "grid",
  gap: "8px"
}

const navGroupStyle = {
  display: "grid",
  gap: "6px"
}

const linkStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "10px 12px",
  borderRadius: "8px",
  color: "#cbd5e1",
  textDecoration: "none",
  border: "1px solid transparent",
  cursor: "pointer",
  pointerEvents: "auto"
}

const navLabelStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "9px"
}

const activeLinkStyle = {
  background: "#0ea5a4",
  borderColor: "#14b8a6",
  color: "#021"
}

const chevronStyle = {
  fontSize: "0.9rem",
  lineHeight: 1
}

const submenuStyle = {
  display: "grid",
  gap: "4px",
  paddingLeft: "12px"
}

const submenuLinkStyle = {
  display: "block",
  padding: "8px 10px",
  borderRadius: "7px",
  color: "#94a3b8",
  textDecoration: "none",
  border: "1px solid transparent",
  fontSize: "0.92rem",
  cursor: "pointer",
  pointerEvents: "auto"
}

const activeSubmenuLinkStyle = {
  color: "#e6eef8",
  background: "#1f2937",
  borderColor: "#334155"
}

const logoutButtonStyle = {
  width: "100%",
  marginTop: "24px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #334155",
  background: "#111827",
  color: "#e6eef8",
  cursor: "pointer"
}

export default Sidebar
