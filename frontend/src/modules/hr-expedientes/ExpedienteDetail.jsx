import { useEffect, useMemo, useState } from "react"
import CompletenessBar from "./CompletenessBar"
import DocumentCard from "./DocumentCard"
import { getExpedienteDetail, saveExpedienteProfile } from "./expedientesService"
import {
  EXPEDIENTE_STATUS,
  FILE_TYPES_BY_TAB,
  TAB_ITEMS,
  formatDate,
  statusClass
} from "./expedientesUtils"

const EMPTY_EXTRA = {
  dpi_number: "",
  nit_number: "",
  birth_date: "",
  address: "",
  personal_email: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  job_title: "",
  hire_date: "",
  labor_status: "active",
  notes: ""
}

export default function ExpedienteDetail({ profileId, canWrite, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useState("general")
  const [extra, setExtra] = useState(EMPTY_EXTRA)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadDetail()
  }, [profileId])

  async function loadDetail() {
    if (!profileId) return
    setLoading(true)
    setError("")
    const result = await getExpedienteDetail(profileId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setDetail(null)
      return
    }
    setDetail(result.data)
    const extraData = result.data?.extra || {}
    setExtra({
      ...EMPTY_EXTRA,
      ...extraData,
      birth_date: extraData.birth_date ? String(extraData.birth_date).slice(0, 10) : "",
      hire_date: extraData.hire_date ? String(extraData.hire_date).slice(0, 10) : ""
    })
  }

  const typesByCode = useMemo(
    () => Object.fromEntries((detail?.types || []).map((item) => [item.code, item])),
    [detail?.types]
  )

  const filesByCode = useMemo(
    () => Object.fromEntries((detail?.files || []).map((item) => [item.file?.file_type_code, item])),
    [detail?.files]
  )

  const writeEnabled = canWrite && detail?.can_write !== false

  async function handleSaveGeneral(event) {
    event.preventDefault()
    if (!writeEnabled) return
    setSaving(true)
    setMessage("")
    setError("")
    const result = await saveExpedienteProfile(profileId, extra)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setMessage("Informacion general guardada.")
    loadDetail()
    onUpdated?.()
  }

  function renderDocumentCards(codes) {
    return (
      <div className="expediente-doc-grid">
        {codes.map((code) => {
          const type = typesByCode[code]
          if (!type) return null
          if (code === "food_handling" && !detail?.requires_food_handling) {
            return (
              <article key={code} className="expediente-doc-card expediente-doc-card--muted">
                <h4>{type.label}</h4>
                <p>No aplica para el area actual del colaborador.</p>
              </article>
            )
          }
          return (
            <DocumentCard
              key={code}
              profileId={profileId}
              type={type}
              entry={filesByCode[code] || null}
              canWrite={writeEnabled}
              canDelete={writeEnabled}
              requiresFoodHandling={Boolean(detail?.requires_food_handling)}
              onUploaded={loadDetail}
            />
          )
        })}
      </div>
    )
  }

  if (loading) {
    return <aside className="expediente-panel"><p className="expediente-empty">Cargando expediente...</p></aside>
  }

  if (!detail?.profile) {
    return (
      <aside className="expediente-panel">
        <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        <p className="expediente-message error">{error || "Expediente no encontrado."}</p>
      </aside>
    )
  }

  const profile = detail.profile
  const statusMeta = EXPEDIENTE_STATUS[detail.status] || EXPEDIENTE_STATUS.incomplete

  return (
    <aside className="expediente-panel expediente-detail">
      <div className="expediente-detail__top">
        <button type="button" className="ghost" onClick={onClose}>Cerrar expediente</button>
        <span className={statusClass(detail.status)}>{statusMeta.label}</span>
      </div>

      <header className="expediente-detail__hero">
        <div className="expediente-detail__identity">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="expediente-avatar expediente-avatar--lg" />
          ) : (
            <span className="expediente-avatar expediente-avatar--lg">{profile.full_name?.slice(0, 1) || "?"}</span>
          )}
          <div>
            <h2>{profile.full_name}</h2>
            <p>{extra.job_title || profile.role} · {profile.area_name || "Sin area"}</p>
          </div>
        </div>
        <CompletenessBar completeness={detail.completeness} />
      </header>

      <section className="expediente-summary-cards">
        <article><span>Vigentes</span><strong>{detail.summary?.valid_count ?? 0}</strong></article>
        <article><span>Vencidos</span><strong>{detail.summary?.expired_count ?? 0}</strong></article>
        <article><span>Faltantes</span><strong>{detail.summary?.missing_count ?? 0}</strong></article>
      </section>

      <nav className="expediente-tabs" aria-label="Secciones del expediente">
        {TAB_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "general" ? (
        <form className="expediente-section" onSubmit={handleSaveGeneral}>
          <div className="expediente-form-grid">
            <label>Nombre completo<input value={profile.full_name || ""} disabled /></label>
            <label>DPI<input value={extra.dpi_number || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, dpi_number: e.target.value }))} /></label>
            <label>NIT<input value={extra.nit_number || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, nit_number: e.target.value }))} /></label>
            <label>Fecha nacimiento<input type="date" value={extra.birth_date?.slice?.(0, 10) || extra.birth_date || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, birth_date: e.target.value }))} /></label>
            <label>Telefono<input value={profile.phone || ""} disabled /></label>
            <label>Correo<input value={extra.personal_email || profile.email || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, personal_email: e.target.value }))} /></label>
            <label className="expediente-span-2">Direccion<input value={extra.address || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, address: e.target.value }))} /></label>
            <label>Contacto emergencia<input value={extra.emergency_contact_name || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, emergency_contact_name: e.target.value }))} /></label>
            <label>Telefono emergencia<input value={extra.emergency_contact_phone || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, emergency_contact_phone: e.target.value }))} /></label>
            <label>Area<input value={profile.area_name || ""} disabled /></label>
            <label>Puesto<input value={extra.job_title || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, job_title: e.target.value }))} /></label>
            <label>Fecha contratacion<input type="date" value={extra.hire_date?.slice?.(0, 10) || extra.hire_date || ""} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, hire_date: e.target.value }))} /></label>
            <label>
              Estado laboral
              <select value={extra.labor_status || "active"} disabled={!writeEnabled} onChange={(e) => setExtra((c) => ({ ...c, labor_status: e.target.value }))}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="suspended">Suspendido</option>
                <option value="terminated">Baja</option>
              </select>
            </label>
          </div>
          {writeEnabled ? (
            <div className="expediente-actions">
              <button type="submit" className="primary" disabled={saving}>{saving ? "Guardando..." : "Guardar informacion"}</button>
            </div>
          ) : (
            <p className="expediente-empty">Modo solo lectura. No puedes editar este expediente.</p>
          )}
        </form>
      ) : null}

      {tab === "legal" ? renderDocumentCards(FILE_TYPES_BY_TAB.legal) : null}
      {tab === "recruitment" ? renderDocumentCards(FILE_TYPES_BY_TAB.recruitment) : null}
      {tab === "background" ? renderDocumentCards(FILE_TYPES_BY_TAB.background) : null}
      {tab === "health" ? renderDocumentCards(FILE_TYPES_BY_TAB.health) : null}

      {tab === "history" ? (
        <section className="expediente-section">
          <p className="expediente-empty">Historial laboral preparado para ascensos, cambios salariales, puestos y observaciones RRHH.</p>
          {(detail.labor_history || []).length ? (
            <div className="expediente-history-list">
              {detail.labor_history.map((item) => (
                <article key={item.id} className="expediente-history-card">
                  <strong>{item.title}</strong>
                  <span>{formatDate(item.effective_date)}</span>
                  <p>{item.description || "—"}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {message ? <p className="expediente-message success">{message}</p> : null}
      {error ? <p className="expediente-message error">{error}</p> : null}

      {detail?.alerts?.length ? (
        <section className="expediente-section">
          <h3>Alertas activas</h3>
          <ul className="expediente-alert-list">
            {detail.alerts.map((alert) => (
              <li key={alert.id}>{alert.message}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  )
}
