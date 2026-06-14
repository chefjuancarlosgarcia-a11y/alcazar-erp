import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import ProductionToast from "../components/production/ProductionToast"
import {
  canAccessKDS,
  canManageProductionAreas,
  canSelectKDSArea,
  getDefaultKDSArea,
  requestKDSAreaAssignment
} from "../utils/kds"
import {
  getProductionAreasEnriched,
  resolveUserProductionAreaIds
} from "../services/productionAreasService"
import "./Production.css"

function ProductionHub() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [areas, setAreas] = useState([])
  const [assignedAreaIds, setAssignedAreaIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [toastTone, setToastTone] = useState("info")
  const canManage = canManageProductionAreas(user)
  const canSwitch = canSelectKDSArea(user)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const [{ data: areaRows, error }, assignedIds] = await Promise.all([
        getProductionAreasEnriched(),
        resolveUserProductionAreaIds(user)
      ])
      if (!mounted) return
      if (error) {
        setMessage("No se pudieron cargar las áreas de producción.")
        setToastTone("error")
      }
      setAreas(areaRows || [])
      setAssignedAreaIds(assignedIds)
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [user])

  const visibleKdsAreas = useMemo(() => {
    if (canSwitch) return areas
    return areas.filter((area) => assignedAreaIds.includes(area.id))
  }, [areas, assignedAreaIds, canSwitch])

  const defaultAreaId = getDefaultKDSArea(user, areas)
  const hasAssignedArea = assignedAreaIds.length > 0 || Boolean(defaultAreaId)

  if (!canAccessKDS(user)) {
    return (
      <section className="production-hub">
        <article className="production-empty-card">
          <h1>Producción</h1>
          <p>No tienes acceso al módulo de Producción.</p>
        </article>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="production-hub">
        <article className="production-empty-card">
          <h1>Producción</h1>
          <p>Cargando estaciones de trabajo...</p>
        </article>
      </section>
    )
  }

  return (
    <section className="production-hub">
      <header className="production-hub__hero">
        <div>
          <p className="kds-eyebrow">Operación en vivo</p>
          <h1>Producción</h1>
          <p className="production-hub__subtitle">
            Gestiona las estaciones de trabajo y los tickets de producción del restaurante.
          </p>
        </div>
        {canSwitch && defaultAreaId && (
          <button type="button" className="production-hub__quick-btn" onClick={() => navigate(`/production/kds/${defaultAreaId}`)}>
            Abrir mi KDS principal
          </button>
        )}
      </header>

      <ProductionToast message={message} tone={toastTone} />

      {!canSwitch && !hasAssignedArea && (
        <article className="production-empty-card">
          <h2>Sin área asignada</h2>
          <p>No tienes un área de producción asignada. Contacta a un administrador.</p>
          <button
            type="button"
            className="production-hub__quick-btn"
            onClick={() => {
              requestKDSAreaAssignment(user)
              setMessage("Solicitud enviada a administración.")
              setToastTone("success")
            }}
          >
            Solicitar asignación
          </button>
        </article>
      )}

      {visibleKdsAreas.length > 0 && (
        <section className="production-hub__section">
          <div className="production-hub__section-head">
            <h2>Estaciones KDS</h2>
            <p>Selecciona el tablero de comandas del área que vas a operar.</p>
          </div>
          <div className="production-hub__grid">
            {visibleKdsAreas.map((area) => (
              <button
                key={area.id}
                type="button"
                className={`production-hub__card production-hub__card--${area.cardTone}`}
                onClick={() => navigate(`/production/kds/${area.id}`)}
              >
                <span className="production-hub__card-tag">KDS</span>
                <strong>{area.kdsLabel || area.name}</strong>
                <p>{area.cardSubtitle || area.description || "Ver comandas en tiempo real."}</p>
                <span className="production-hub__card-action">Abrir tablero →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {canManage && (
        <section className="production-hub__section">
          <div className="production-hub__section-head">
            <h2>Administración</h2>
            <p>Configura áreas, productos y asignaciones del equipo.</p>
          </div>
          <div className="production-hub__grid production-hub__grid--admin">
            <button type="button" className="production-hub__card production-hub__card--admin" onClick={() => navigate("/production/areas")}>
              <strong>Gestión de áreas de producción</strong>
              <p>Crear, editar o desactivar estaciones de producción.</p>
              <span className="production-hub__card-action">Administrar →</span>
            </button>
            <button type="button" className="production-hub__card production-hub__card--admin" onClick={() => navigate("/production/products")}>
              <strong>Configuración de productos por área</strong>
              <p>Asignar platillos y bebidas a la estación correcta.</p>
              <span className="production-hub__card-action">Configurar →</span>
            </button>
            <button type="button" className="production-hub__card production-hub__card--admin" onClick={() => navigate("/production/assignments")}>
              <strong>Asignación de colaboradores</strong>
              <p>Define qué KDS puede ver cada miembro del equipo.</p>
              <span className="production-hub__card-action">Asignar →</span>
            </button>
          </div>
        </section>
      )}
    </section>
  )
}

export default ProductionHub
