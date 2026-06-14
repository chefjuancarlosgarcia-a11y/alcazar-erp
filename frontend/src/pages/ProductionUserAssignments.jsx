import { useEffect, useMemo, useState } from "react"
import ProductionBackButton from "../components/production/ProductionBackButton"
import ProductionToast from "../components/production/ProductionToast"
import { useAuth } from "../context/AuthContext"
import { canManageProductionAreas } from "../utils/kds"
import { getChecklistProfiles } from "../services/checklistsService"
import {
  assignUserProductionArea,
  deactivateUserProductionArea,
  getAllUserProductionAreaAssignments,
  getProductionAreasEnriched
} from "../services/productionAreasService"
import "./Production.css"

export default function ProductionUserAssignments() {
  const { user } = useAuth()
  const [areas, setAreas] = useState([])
  const [profiles, setProfiles] = useState([])
  const [assignments, setAssignments] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState("")
  const [selectedAreaId, setSelectedAreaId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [toastTone, setToastTone] = useState("info")

  async function refresh() {
    setLoading(true)
    const [areaResult, profileResult, assignmentResult] = await Promise.all([
      getProductionAreasEnriched(),
      getChecklistProfiles(),
      getAllUserProductionAreaAssignments()
    ])
    setAreas(areaResult.data || [])
    setProfiles(profileResult.data || [])
    setAssignments(assignmentResult.data || [])
    if (areaResult.error || profileResult.error || assignmentResult.error) {
      setMessage("No se pudieron cargar colaboradores o asignaciones.")
      setToastTone("error")
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const assignableProfiles = useMemo(
    () => profiles.filter((profile) => !["inactive", "suspended"].includes(String(profile.status || "").toLowerCase())),
    [profiles]
  )

  if (!canManageProductionAreas(user)) {
    return (
      <section className="production-admin">
        <ProductionBackButton />
        <article className="production-empty-card"><p>No tienes permiso para asignar colaboradores a áreas.</p></article>
      </section>
    )
  }

  async function handleAssign(event) {
    event.preventDefault()
    if (!selectedProfileId || !selectedAreaId) {
      setMessage("Selecciona un colaborador y un área de producción.")
      setToastTone("error")
      return
    }
    setSaving(true)
    const { error } = await assignUserProductionArea(selectedProfileId, selectedAreaId)
    setSaving(false)
    if (error) {
      setMessage(error.message || "No se pudo guardar la asignación.")
      setToastTone("error")
      return
    }
    setMessage("Colaborador asignado correctamente.")
    setToastTone("success")
    setSelectedProfileId("")
    setSelectedAreaId("")
    refresh()
  }

  async function handleRemove(assignment) {
    const name = assignment.profile?.full_name || assignment.profile?.username || "Colaborador"
    const areaName = assignment.area?.name || assignment.production_area_id
    const confirmed = window.confirm(`¿Quitar a ${name} del área ${areaName}?`)
    if (!confirmed) return
    const { error } = await deactivateUserProductionArea(assignment.id)
    if (error) {
      setMessage(error.message || "No se pudo quitar la asignación.")
      setToastTone("error")
      return
    }
    setMessage("Asignación removida.")
    setToastTone("success")
    refresh()
  }

  return (
    <section className="production-admin">
      <ProductionBackButton />
      <header className="production-admin__header">
        <div>
          <p className="kds-eyebrow">Administración</p>
          <h1>Asignación de colaboradores</h1>
          <p className="production-hub__subtitle">Controla qué KDS puede ver cada miembro del equipo de producción.</p>
        </div>
      </header>

      <ProductionToast message={message} tone={toastTone} />

      <form className="production-admin__panel production-admin__assign-form" onSubmit={handleAssign}>
        <h2>Nueva asignación</h2>
        <div className="production-admin__assign-grid">
          <label>
            Colaborador
            <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
              <option value="">Seleccionar...</option>
              {assignableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name || profile.username} · {profile.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            Área de producción
            <select value={selectedAreaId} onChange={(event) => setSelectedAreaId(event.target.value)}>
              <option value="">Seleccionar...</option>
              {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" className="production-hub__quick-btn" disabled={saving}>
          {saving ? "Guardando..." : "Asignar colaborador"}
        </button>
      </form>

      <div className="production-admin__panel">
        <h2>Asignaciones activas</h2>
        {loading ? <p>Cargando...</p> : !assignments.length ? (
          <p className="production-empty-inline">No hay colaboradores asignados a áreas de producción.</p>
        ) : (
          <div className="production-admin__list">
            {assignments.map((assignment) => (
              <article key={assignment.id} className="production-admin__list-item">
                <div>
                  <strong>{assignment.profile?.full_name || assignment.profile?.username || assignment.profile_id}</strong>
                  <p>{assignment.area?.name || assignment.production_area_id}</p>
                  <small>Rol: {assignment.profile?.role || "—"}</small>
                </div>
                <button type="button" className="production-hub__danger-btn" onClick={() => handleRemove(assignment)}>
                  Quitar
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
