import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { canManageAreaCatalog, canManageRoleCatalog } from "../utils/profilePermissions"
import RolesManagement from "./RolesManagement"
import AreasCatalogManagement from "./AreasCatalogManagement"
import "./HRCatalogsManagement.css"

const CATALOG_DENIED_MESSAGE = "Solo Administración puede administrar roles y áreas operativas."

function HRCatalogsManagement() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const initialTab = params.get("tab") === "areas" ? "areas" : "roles"
  const [activeTab, setActiveTab] = useState(initialTab)

  const canManageRoles = canManageRoleCatalog(user)
  const canManageAreas = canManageAreaCatalog(user)
  const canAccess = canManageRoles || canManageAreas

  useEffect(() => {
    setActiveTab(params.get("tab") === "areas" ? "areas" : "roles")
  }, [location.search])

  function switchTab(tab) {
    setActiveTab(tab)
    const nextParams = new URLSearchParams(location.search)
    nextParams.set("section", "catalogos")
    nextParams.set("tab", tab)
    navigate({ pathname: "/hr", search: `?${nextParams.toString()}` }, { replace: true })
  }

  if (!canAccess) {
    return (
      <section className="hr-catalogs-page">
        <article className="hr-catalogs-denied">
          <h1>Roles y áreas</h1>
          <p>{CATALOG_DENIED_MESSAGE}</p>
        </article>
      </section>
    )
  }

  const visibleTab = activeTab === "areas" && canManageAreas
    ? "areas"
    : canManageRoles
      ? "roles"
      : "areas"

  return (
    <section className="hr-catalogs-page">
      <header className="hr-catalogs-header">
        <div>
          <p className="hr-catalogs-eyebrow">Recursos Humanos</p>
          <h1>Roles y áreas</h1>
          <p>
            Administra el catálogo de roles y áreas operativas. Los cambios se reflejan en colaboradores,
            permisos, inventario, producción y POS.
          </p>
        </div>
      </header>

      <nav className="hr-catalogs-tabs" aria-label="Catálogos de RRHH">
        {canManageRoles && (
          <button
            type="button"
            className={`hr-catalogs-tab ${visibleTab === "roles" ? "active" : ""}`}
            onClick={() => switchTab("roles")}
          >
            Roles
          </button>
        )}
        {canManageAreas && (
          <button
            type="button"
            className={`hr-catalogs-tab ${visibleTab === "areas" ? "active" : ""}`}
            onClick={() => switchTab("areas")}
          >
            Áreas operativas
          </button>
        )}
      </nav>

      <div className="hr-catalogs-content">
        {visibleTab === "roles" && canManageRoles && <RolesManagement embedded />}
        {visibleTab === "areas" && canManageAreas && <AreasCatalogManagement embedded />}
      </div>
    </section>
  )
}

export default HRCatalogsManagement
