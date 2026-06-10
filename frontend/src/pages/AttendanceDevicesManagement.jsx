import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import {
  authorizeAttendanceDevice,
  blockAttendanceDevice,
  getAttendanceDevices,
  getAttendanceSecuritySettings,
  updateAttendanceDevice,
  updateAttendanceSecuritySettings
} from "../services/attendanceService"
import {
  formatAttendanceDeviceLabel,
  shortenAttendanceDeviceId
} from "../utils/attendanceDevice"
import "../pages/ProfileManagement.css"
import "./AttendanceDevicesManagement.css"

const STATUS_LABELS = {
  pending: "Pendiente",
  authorized: "Autorizado",
  blocked: "Bloqueado"
}

const DEFAULT_SETTINGS = {
  require_authorized_device: true,
  require_authorized_network: false,
  allowed_ips: [],
  allow_hr_manual_override: false
}

function AttendanceDevicesManagement() {
  const { user } = useAuth()
  const canManage = ["admin", "gerente_general"].includes(user?.role)
  const [devices, setDevices] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [savingSettings, setSavingSettings] = useState(false)
  const [actionId, setActionId] = useState("")
  const [allowedIpsText, setAllowedIpsText] = useState("")
  const [renameDraft, setRenameDraft] = useState({})

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    setError("")
    const [devicesResult, settingsResult] = await Promise.all([
      getAttendanceDevices(),
      getAttendanceSecuritySettings()
    ])
    if (devicesResult.error) {
      setError(devicesResult.error.message || "No se pudieron cargar los dispositivos.")
      setDevices([])
    } else {
      setDevices(devicesResult.data || [])
      setRenameDraft(Object.fromEntries((devicesResult.data || []).map((device) => [device.device_id, device.device_name || ""])))
    }
    if (!settingsResult.error && settingsResult.data) {
      const nextSettings = { ...DEFAULT_SETTINGS, ...settingsResult.data }
      setSettings(nextSettings)
      setAllowedIpsText((nextSettings.allowed_ips || []).join("\n"))
    }
    setLoading(false)
  }

  const pendingCount = useMemo(
    () => devices.filter((device) => device.status === "pending").length,
    [devices]
  )

  async function handleAuthorize(device) {
    if (!canManage) return
    const deviceName = window.prompt("Nombre del dispositivo", renameDraft[device.device_id] || device.device_name || "Tablet recepción")
    if (deviceName === null) return
    const notesInput = window.prompt("Notas (opcional)", device.notes || "")
    const notes = notesInput === null ? (device.notes || "") : notesInput
    setActionId(device.device_id)
    setError("")
    const result = await authorizeAttendanceDevice(device.device_id, deviceName.trim(), notes.trim())
    setActionId("")
    if (result.error) return setError(result.error.message || "No se pudo autorizar el dispositivo.")
    setMessage(`Dispositivo ${deviceName.trim()} autorizado.`)
    refresh()
  }

  async function handleBlock(device) {
    if (!canManage) return
    const confirmed = window.confirm(`¿Bloquear el dispositivo ${device.device_name || shortenAttendanceDeviceId(device.device_id)}?`)
    if (!confirmed) return
    const notesInput = window.prompt("Motivo del bloqueo (opcional)", device.notes || "")
    const notes = notesInput === null ? (device.notes || "") : notesInput
    setActionId(device.device_id)
    setError("")
    const result = await blockAttendanceDevice(device.device_id, notes.trim())
    setActionId("")
    if (result.error) return setError(result.error.message || "No se pudo bloquear el dispositivo.")
    setMessage("Dispositivo bloqueado.")
    refresh()
  }

  async function handleRename(device) {
    if (!canManage) return
    const deviceName = renameDraft[device.device_id]
    if (!deviceName?.trim()) return setError("El nombre del dispositivo no puede estar vacío.")
    setActionId(device.device_id)
    setError("")
    const result = await updateAttendanceDevice(device.device_id, deviceName.trim(), device.notes || "")
    setActionId("")
    if (result.error) return setError(result.error.message || "No se pudo renombrar el dispositivo.")
    setMessage("Dispositivo actualizado.")
    refresh()
  }

  async function saveSettings(event) {
    event.preventDefault()
    if (!canManage) return
    setSavingSettings(true)
    setError("")
    const allowed_ips = allowedIpsText
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
    const payload = {
      ...settings,
      allowed_ips
    }
    const result = await updateAttendanceSecuritySettings(payload)
    setSavingSettings(false)
    if (result.error) return setError(result.error.message || "No se pudo guardar la configuración.")
    setSettings({ ...DEFAULT_SETTINGS, ...result.data })
    setMessage("Configuración de seguridad guardada.")
  }

  return (
    <div className="profiles-page attendance-devices-page">
      <header className="profiles-header">
        <div>
          <p className="profiles-eyebrow">Recursos Humanos</p>
          <h1>Dispositivos de marcaje</h1>
          <p className="profiles-muted">
            Autoriza tablets o terminales del restaurante. {pendingCount ? `${pendingCount} pendiente(s).` : "Sin pendientes."}
            {!canManage && " Modo lectura: solo Administración puede autorizar o bloquear."}
          </p>
        </div>
        <div className="profiles-header-actions">
          <button type="button" className="profiles-secondary" onClick={refresh} disabled={loading}>Actualizar</button>
        </div>
      </header>

      {message && <p className="profiles-success">{message}</p>}
      {error && <p className="profiles-error">{error}</p>}

      <section className="attendance-devices-settings profiles-panel">
        <div className="profiles-panel-head">
          <div>
            <h2>Configuración de seguridad</h2>
            <p className="profiles-muted">Activa red/IP autorizada solo si el restaurante tiene IP estable.</p>
          </div>
        </div>
        <form className="attendance-devices-settings-form" onSubmit={saveSettings}>
          <label className="attendance-devices-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings.require_authorized_device)}
              disabled={!canManage || savingSettings}
              onChange={(event) => setSettings((current) => ({ ...current, require_authorized_device: event.target.checked }))}
            />
            <span>Requerir dispositivo autorizado</span>
          </label>
          <label className="attendance-devices-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings.require_authorized_network)}
              disabled={!canManage || savingSettings}
              onChange={(event) => setSettings((current) => ({ ...current, require_authorized_network: event.target.checked }))}
            />
            <span>Requerir red/IP autorizada</span>
          </label>
          <label className="attendance-devices-field">
            <span>IPs permitidas (una por línea)</span>
            <textarea
              value={allowedIpsText}
              disabled={!canManage || savingSettings || !settings.require_authorized_network}
              onChange={(event) => setAllowedIpsText(event.target.value)}
              placeholder="203.0.113.10"
              rows={4}
            />
          </label>
          {canManage && (
            <button type="submit" className="profiles-primary" disabled={savingSettings}>
              {savingSettings ? "Guardando..." : "Guardar configuración"}
            </button>
          )}
        </form>
      </section>

      <section className="profiles-panel">
        <div className="profiles-panel-head">
          <div>
            <h2>Dispositivos registrados</h2>
            <p className="profiles-muted">{devices.length} dispositivo(s)</p>
          </div>
        </div>

        {loading ? (
          <p className="profiles-empty">Cargando dispositivos...</p>
        ) : (
          <div className="attendance-devices-table">
            <div className="attendance-devices-table-head">
              <span>Nombre</span>
              <span>ID</span>
              <span>Estado</span>
              <span>Última conexión</span>
              <span>Dispositivo</span>
              <span>Acciones</span>
            </div>
            {devices.map((device) => (
              <article className="attendance-devices-row" key={device.id}>
                <div className="attendance-devices-name">
                  <input
                    value={renameDraft[device.device_id] ?? device.device_name ?? ""}
                    disabled={!canManage || actionId === device.device_id}
                    onChange={(event) => setRenameDraft((current) => ({ ...current, [device.device_id]: event.target.value }))}
                  />
                  {device.notes && <small>{device.notes}</small>}
                </div>
                <code>{shortenAttendanceDeviceId(device.device_id)}</code>
                <span className={`attendance-device-status ${device.status}`}>{STATUS_LABELS[device.status] || device.status}</span>
                <span>{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString("es-GT") : "Sin registro"}</span>
                <span>{formatAttendanceDeviceLabel(device.user_agent || device.device_type || device.device_name)}</span>
                <div className="attendance-devices-actions">
                  {canManage && (
                    <>
                      {device.status !== "authorized" && (
                        <button type="button" className="profiles-primary" disabled={actionId === device.device_id} onClick={() => handleAuthorize(device)}>
                          Autorizar
                        </button>
                      )}
                      {device.status !== "blocked" && (
                        <button type="button" className="profiles-secondary danger" disabled={actionId === device.device_id} onClick={() => handleBlock(device)}>
                          Bloquear
                        </button>
                      )}
                      <button type="button" className="profiles-secondary" disabled={actionId === device.device_id} onClick={() => handleRename(device)}>
                        Guardar nombre
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {!devices.length && <p className="profiles-empty">Aún no hay dispositivos registrados. Abre /kiosk desde una tablet para que aparezca aquí.</p>}
          </div>
        )}
      </section>
    </div>
  )
}

export default AttendanceDevicesManagement
