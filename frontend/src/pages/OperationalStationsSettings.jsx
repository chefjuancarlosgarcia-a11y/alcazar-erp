import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import { getCashRegisters } from "../services/cashService"
import {
  applyStationTypeToProvisionForm,
  authorizeStationDevice,
  buildEnrollmentUrl,
  createStationEnrollmentToken,
  listOperationalStationDevices,
  listOperationalStations,
  provisionOperationalStation,
  rejectAndBlockStationDevice,
  replaceStationDevice,
  revokeStationDevice,
  updateOperationalStation,
  validateProvisionOperationalStationForm
} from "../services/operationalStationsService"
import "./OperationalStationsSettings.css"

const STATION_TYPES = [
  { id: "pos", label: "POS" },
  { id: "kds", label: "KDS" },
  { id: "cash", label: "Caja" },
  { id: "production", label: "Producción" }
]

const EMPTY_FORM = {
  stationCode: "",
  name: "",
  stationType: "kds",
  areaId: "",
  cashRegisterId: "",
  posFloorZone: ""
}

function OperationalStationsSettings() {
  const { user } = useAuth()
  const canManage = ["admin", "gerente_general"].includes(user?.role)
  const [stations, setStations] = useState([])
  const [devices, setDevices] = useState([])
  const [areas, setAreas] = useState([])
  const [cashRegisters, setCashRegisters] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [filterStatus, setFilterStatus] = useState("pending")
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [enrollmentPreview, setEnrollmentPreview] = useState(null)

  const fetchOperationalData = useCallback(async () => {
    return Promise.all([
      listOperationalStations(),
      listOperationalStationDevices(null, filterStatus === "all" ? null : filterStatus)
    ])
  }, [filterStatus])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    const [stRes, devRes] = await fetchOperationalData()
    if (stRes.error) setError(stRes.error.message)
    else setStations(stRes.data || [])
    if (devRes.error) setError(devRes.error.message)
    else setDevices(devRes.data || [])
    setLoading(false)
  }, [fetchOperationalData])

  useEffect(() => {
    if (!canManage) return undefined
    let cancelled = false
    ;(async () => {
      const [stRes, devRes] = await fetchOperationalData()
      if (cancelled) return
      setError("")
      if (stRes.error) setError(stRes.error.message)
      else setStations(stRes.data || [])
      if (devRes.error) setError(devRes.error.message)
      else setDevices(devRes.data || [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [canManage, fetchOperationalData])

  useEffect(() => {
    if (!canManage) return undefined
    let cancelled = false
    ;(async () => {
      const [areasRes, registersRes] = await Promise.all([getActiveAreas(), getCashRegisters()])
      if (cancelled) return
      if (areasRes.error) setError(areasRes.error.message)
      else setAreas(areasRes.data || [])
      if (registersRes.error) setError(registersRes.error.message)
      else setCashRegisters(registersRes.data || [])
    })()
    return () => {
      cancelled = true
    }
  }, [canManage])

  const pendingDevices = useMemo(
    () => devices.filter((d) => d.status === "pending"),
    [devices]
  )

  const showAreaSelector =
    form.stationType === "kds" || form.stationType === "production"
  const showCashRegisterSelector = form.stationType === "cash"

  async function handleCreateStation(event) {
    event.preventDefault()
    if (!canManage) return
    setError("")
    const validationError = validateProvisionOperationalStationForm(form)
    if (validationError) return setError(validationError)
    const { data, error: rpcError } = await provisionOperationalStation(form)
    if (rpcError) return setError(rpcError.message)
    setMessage(`Estación ${data?.name || form.name} creada (borrador).`)
    setForm(EMPTY_FORM)
    refresh()
  }

  async function handleActivate(station) {
    const { error: rpcError } = await updateOperationalStation(station.id, { status: "active" })
    if (rpcError) return setError(rpcError.message)
    setMessage("Estación activada.")
    refresh()
  }

  async function handleEnrollment(station) {
    const key = `enroll-${station.id}-${Date.now()}`
    const { data, error: rpcError } = await createStationEnrollmentToken(station.id, key)
    if (rpcError) return setError(rpcError.message)
    const url = buildEnrollmentUrl(data.enrollment_token)
    setEnrollmentPreview({
      stationName: station.name,
      url,
      confirmationCode: data.confirmation_code,
      expiresAt: data.expires_at
    })
    setMessage("Enrollment generado. El token se muestra una sola vez.")
  }

  async function handleAuthorize(device) {
    const label = window.prompt("Nombre del dispositivo", device.device_label || "Terminal")
    if (label === null) return
    const code = window.prompt("Código de confirmación (6 dígitos)", device.confirmation_code || "")
    if (code === null) return
    const { error: fnError } = await authorizeStationDevice({
      deviceId: device.id,
      confirmationCode: code.trim(),
      deviceLabel: label.trim(),
      idempotencyKey: `authorize-${device.id}-${crypto.randomUUID()}`
    })
    if (fnError) return setError(fnError.message || "No se pudo autorizar.")
    setMessage("Dispositivo autorizado. El terminal puede completar enrollment.")
    setEnrollmentPreview(null)
    refresh()
  }

  async function handleReject(device) {
    if (!window.confirm("¿Rechazar y bloquear este dispositivo?")) return
    const reason = window.prompt("Motivo (opcional)", "") || ""
    const { error: rpcError } = await rejectAndBlockStationDevice(device.id, reason)
    if (rpcError) return setError(rpcError.message)
    setMessage("Dispositivo bloqueado.")
    refresh()
  }

  async function handleRevoke(device) {
    if (!window.confirm("¿Revocar dispositivo activo?")) return
    const { error: rpcError } = await revokeStationDevice(device.id, "revoked_from_admin")
    if (rpcError) return setError(rpcError.message)
    setMessage("Dispositivo revocado.")
    refresh()
  }

  async function handleReplace(device) {
    if (!window.confirm("¿Marcar dispositivo para reemplazo?")) return
    const { error: rpcError } = await replaceStationDevice(device.id, "replace_from_admin")
    if (rpcError) return setError(rpcError.message)
    setMessage("Dispositivo marcado replaced. Genere nuevo enrollment.")
    refresh()
  }

  if (!canManage) {
    return (
      <section className="erp-page-shell operational-stations-page">
        <p>No tienes permiso para administrar estaciones operativas.</p>
      </section>
    )
  }

  return (
    <section className="erp-page-shell operational-stations-page">
      <header className="operational-stations-header erp-section-stack">
        <div>
          <p className="operational-stations-eyebrow">Configuración</p>
          <h1>Estaciones operativas (OS1)</h1>
          <p className="operational-stations-muted">
            Foundation: estaciones, dispositivos y enrollment. Flag global desactivado — sin impacto POS/KDS/Caja.
          </p>
        </div>
        <Link className="operational-stations-secondary" to="/settings">Volver a ajustes</Link>
      </header>

      {message && <p className="operational-stations-success">{message}</p>}
      {error && <p className="operational-stations-error">{error}</p>}

      <form className="erp-card erp-card--form operational-stations-form" onSubmit={handleCreateStation}>
        <h2>Crear estación</h2>
        <div className="erp-form-grid">
          <label>Código<input required value={form.stationCode} onChange={(e) => setForm({ ...form, stationCode: e.target.value })} /></label>
          <label>Nombre<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Tipo
            <select
              value={form.stationType}
              onChange={(e) => setForm((prev) => applyStationTypeToProvisionForm(prev, e.target.value))}
            >
              {STATION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          {showCashRegisterSelector && (
            <label>Caja asociada
              <select
                required
                value={form.cashRegisterId}
                onChange={(e) => setForm({ ...form, cashRegisterId: e.target.value })}
              >
                <option value="">Selecciona una caja activa</option>
                {cashRegisters.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name}{register.location ? ` · ${register.location}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showAreaSelector && (
            <label>Área operativa
              <select
                required
                value={form.areaId}
                onChange={(e) => setForm({ ...form, areaId: e.target.value })}
              >
                <option value="">Selecciona un área</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>{area.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button type="submit" className="operational-stations-primary">Crear borrador</button>
      </form>

      {enrollmentPreview && (
        <article className="erp-card operational-stations-enroll-preview">
          <h2>Enrollment — {enrollmentPreview.stationName}</h2>
          <p>URL (una sola entrega):</p>
          <code className="operational-stations-code">{enrollmentPreview.url}</code>
          <p>Código confirmación admin: <strong>{enrollmentPreview.confirmationCode}</strong></p>
          <p className="operational-stations-muted">Expira: {enrollmentPreview.expiresAt}</p>
        </article>
      )}

      <section className="erp-section-stack">
        <div className="operational-stations-toolbar">
          <h2>Estaciones</h2>
          <button type="button" className="operational-stations-secondary" onClick={refresh} disabled={loading}>Actualizar</button>
        </div>
        <div className="erp-card-grid">
          {stations.map((station) => (
            <article key={station.id} className="erp-card">
              <h3>{station.name}</h3>
              <p className="operational-stations-muted">{station.station_code} · {station.station_type} · {station.status}</p>
              <div className="operational-stations-actions">
                {station.status === "draft" && (
                  <button type="button" className="operational-stations-secondary" onClick={() => handleActivate(station)}>Activar</button>
                )}
                <button type="button" className="operational-stations-primary" onClick={() => handleEnrollment(station)}>Vincular dispositivo</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="erp-section-stack">
        <div className="operational-stations-toolbar">
          <h2>Dispositivos</h2>
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value)
              setLoading(true)
            }}
          >
            <option value="pending">Pendientes</option>
            <option value="active">Activos</option>
            <option value="blocked">Bloqueados</option>
            <option value="revoked">Revocados</option>
            <option value="replaced">Reemplazados</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <div className="erp-card-grid">
          {devices.map((device) => (
            <article key={device.id} className="erp-card">
              <h3>{device.device_label || device.id.slice(0, 8)}</h3>
              <p className="operational-stations-muted">Estado: {device.status}</p>
              {device.confirmation_code && <p>Código: {device.confirmation_code}</p>}
              {device.blocked_reason && <p>Motivo: {device.blocked_reason}</p>}
              <div className="operational-stations-actions">
                {device.status === "pending" && (
                  <>
                    <button type="button" className="operational-stations-primary" onClick={() => handleAuthorize(device)}>Autorizar</button>
                    <button type="button" className="operational-stations-danger" onClick={() => handleReject(device)}>Rechazar y bloquear</button>
                  </>
                )}
                {device.status === "active" && (
                  <>
                    <button type="button" className="operational-stations-secondary" onClick={() => handleRevoke(device)}>Revocar</button>
                    <button type="button" className="operational-stations-secondary" onClick={() => handleReplace(device)}>Reemplazar</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
        {!loading && pendingDevices.length === 0 && filterStatus === "pending" && (
          <p className="operational-stations-muted">Sin dispositivos pendientes.</p>
        )}
      </section>
    </section>
  )
}

export default OperationalStationsSettings
