import { useEffect, useState } from "react"
import {
  adminAssignOperationalStation,
  adminGetOperationalAccessSummary,
  adminSetOperationalPin
} from "../services/operationalStationAccessService"
import { listOperationalStations } from "../services/operationalStationsService"

function randomOperationalPin() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export default function OperationalAccessSection({ profileId, canManage }) {
  const [summary, setSummary] = useState(null)
  const [stations, setStations] = useState([])
  const [stationId, setStationId] = useState("")
  const [generatedPin, setGeneratedPin] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profileId || !canManage) return
    ;(async () => {
      const [sumRes, stRes] = await Promise.all([
        adminGetOperationalAccessSummary(profileId),
        listOperationalStations()
      ])
      if (sumRes.error) setError(sumRes.error.message)
      else setSummary(sumRes.data)
      if (!stRes.error) {
        const cashStations = (stRes.data || []).filter((s) => s.station_type === "cash")
        setStations(cashStations)
        if (cashStations[0]?.id) setStationId(cashStations[0].id)
      }
    })()
  }, [profileId, canManage])

  if (!canManage || !profileId) return null

  async function handleGeneratePin() {
    setBusy(true)
    setError("")
    setMessage("")
    setGeneratedPin("")
    try {
      const pin = randomOperationalPin()
      const { data, error: rpcError } = await adminSetOperationalPin(profileId, pin)
      if (rpcError) {
        setError(rpcError.message || "No se pudo guardar el PIN operativo.")
        return
      }
      if (data?.ok !== true) {
        setError("No se pudo guardar el PIN operativo.")
        return
      }
      setGeneratedPin(pin)
      setMessage("PIN operativo generado. Entregar una sola vez al colaborador.")
      const sumRes = await adminGetOperationalAccessSummary(profileId)
      if (sumRes.error) setError(sumRes.error.message)
      else if (sumRes.data) setSummary(sumRes.data)
    } catch (err) {
      setError(err?.message || "Error inesperado al generar PIN operativo.")
    } finally {
      setBusy(false)
    }
  }

  async function handleAssign() {
    if (!stationId) {
      setError("Seleccione una estación Caja.")
      return
    }
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const { error: rpcError } = await adminAssignOperationalStation(profileId, stationId, true)
      if (rpcError) {
        setError(rpcError.message || "No se pudo guardar la asignación.")
        return
      }
      setMessage("Asignación a estación guardada.")
      const sumRes = await adminGetOperationalAccessSummary(profileId)
      if (sumRes.error) setError(sumRes.error.message)
      else if (sumRes.data) setSummary(sumRes.data)
    } catch (err) {
      setError(err?.message || "Error inesperado al asignar estación.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="erp-card erp-card--form" style={{ marginTop: "var(--erp-space-16)" }}>
      <h3>Acceso operativo (OS2)</h3>
      <p className="profiles-muted">
        PIN de 4 dígitos independiente del PIN de asistencia. No se muestra un PIN existente.
      </p>
      <p>
        Estado PIN:{" "}
        <strong>{summary?.has_pin ? "configurado" : "sin configurar"}</strong>
        {summary?.pin_status && summary.pin_status !== "none" ? ` (${summary.pin_status})` : ""}
      </p>
      {message && <p className="profiles-success">{message}</p>}
      {error && <p className="profiles-error">{error}</p>}
      {generatedPin && (
        <p>
          PIN nuevo (una entrega): <strong>{generatedPin}</strong>
        </p>
      )}
      <div className="erp-form-grid">
        <label>
          Estación Caja
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Seleccionar</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.station_code})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: "var(--erp-space-16)", flexWrap: "wrap", marginTop: "var(--erp-space-16)" }}>
        <button type="button" disabled={busy} onClick={handleGeneratePin}>
          Generar / resetear PIN operativo
        </button>
        <button type="button" disabled={busy || !stationId} onClick={handleAssign}>
          Asignar a estación Caja
        </button>
      </div>
    </section>
  )
}
