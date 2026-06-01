import { useEffect, useMemo, useRef, useState } from "react"
import { BRANDING } from "../branding"
import {
  getAttendanceMarks,
  getAttendanceTerminalProfiles,
  registerAttendanceMark,
  uploadAttendanceEvidence
} from "../services/attendanceService"
import "./AttendanceTerminal.css"

const MARK_LABELS = {
  entrada: "Entrada",
  salida_comida: "Salida a comida",
  regreso_comida: "Regreso de comida",
  salida_final: "Salida final"
}

function AttendanceTerminal({ kiosk = false }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [profiles, setProfiles] = useState([])
  const [marks, setMarks] = useState([])
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [observation, setObservation] = useState("")
  const [deviceId] = useState(() => getOrCreateDeviceId())

  useEffect(() => {
    refresh()
    return () => stopCamera()
  }, [])

  useEffect(() => {
    if (selected) startCamera()
    else stopCamera()
    return () => stopCamera()
  }, [selected])

  const selectedMarks = useMemo(() => (
    marks.filter((mark) => String(mark.employee_id) === String(selected?.id))
  ), [marks, selected])

  const lastShiftMark = selectedMarks.find((mark) => ["entrada", "salida", "salida_final"].includes(mark.mark_type))
  const isCheckedIn = lastShiftMark?.mark_type === "entrada"
  const activeMeal = selectedMarks.find((mark) => ["salida_comida", "bano_inicio"].includes(mark.mark_type) && !selectedMarks.some((candidate) => candidate.related_mark_id === mark.id && ["regreso_comida", "bano_regreso"].includes(candidate.mark_type)))

  async function refresh() {
    setLoading(true)
    const [profilesResult, marksResult] = await Promise.all([
      getAttendanceTerminalProfiles(),
      getAttendanceMarks(false)
    ])
    if (profilesResult.error || marksResult.error) {
      setError(profilesResult.error?.message || marksResult.error?.message || "No se pudo cargar la terminal.")
    } else {
      setProfiles((profilesResult.data || []).map(normalizeProfile))
      setMarks(marksResult.data || [])
      setError("")
    }
    setLoading(false)
  }

  async function startCamera() {
    setCameraError("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraReady(true)
    } catch {
      setCameraReady(false)
      setCameraError("No se pudo activar la cámara. Revisa permisos del navegador.")
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)
  }

  async function mark(markType) {
    if (!selected) return
    if (!/^\d{4}$/.test(pin)) {
      setError("Ingresa tu PIN de 4 dígitos.")
      return
    }
    if (!cameraReady) {
      setError("La cámara debe estar activa para registrar el marcaje.")
      return
    }
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const blob = await capturePhotoBlob(videoRef.current, canvasRef.current)
      const upload = await uploadAttendanceEvidence(blob, selected.id)
      if (upload.error) throw upload.error
      const result = await registerAttendanceMark({
        employeeId: selected.id,
        pin,
        markType,
        photoPath: upload.data.path,
        deviceId,
        deviceName: navigator.userAgent.slice(0, 120),
        observation
      })
      if (result.error) throw result.error
      setMessage(`${MARK_LABELS[markType]} registrada correctamente para ${selected.fullName}.`)
      setPin("")
      setObservation("")
      await refresh()
      window.setTimeout(() => {
        setSelected(null)
        setMessage("")
      }, 1800)
    } catch (caught) {
      setError(caught?.message || "No se pudo registrar el marcaje.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={`attendance-terminal ${kiosk ? "kiosk" : ""}`}>
      <section className="attendance-shell">
        <header className="attendance-brand">
          <div className="attendance-logo">{BRANDING.logo}</div>
          <div>
            <h1>{BRANDING.appName}</h1>
            <p>Terminal de marcaje</p>
          </div>
        </header>

        {message && <div className="attendance-success">{message}</div>}
        {error && <div className="attendance-error">{error}</div>}

        {!selected ? (
          <section className="attendance-panel">
            <div className="attendance-panel-head">
              <h2>Selecciona tu perfil</h2>
              <span>Dispositivo {deviceId}</span>
            </div>
            {loading ? <p className="attendance-empty">Cargando colaboradores...</p> : (
              <div className="attendance-employee-grid">
                {profiles.map((profile) => (
                  <button type="button" key={profile.id} className="attendance-employee" onClick={() => { setSelected(profile); setError(""); setMessage("") }}>
                    {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{initials(profile.fullName)}</span>}
                    <strong>{profile.fullName}</strong>
                    <small>{profile.areaName || "Sin área"}</small>
                    {!profile.pinConfigured && <em>Sin PIN</em>}
                  </button>
                ))}
                {!profiles.length && <p className="attendance-empty">No hay colaboradores activos disponibles.</p>}
              </div>
            )}
          </section>
        ) : (
          <section className="attendance-mark-panel">
            <div className="attendance-profile">
              <button type="button" onClick={() => setSelected(null)}>Cambiar colaborador</button>
              {selected.avatarUrl ? <img src={selected.avatarUrl} alt="" /> : <span>{initials(selected.fullName)}</span>}
              <div>
                <h2>{selected.fullName}</h2>
                <p>{selected.areaName || "Sin area"} · {isCheckedIn ? activeMeal ? "En comida" : "Entrada activa" : "Fuera de turno"}</p>
              </div>
            </div>

            <div className="attendance-camera">
              <video ref={videoRef} autoPlay playsInline muted />
              <canvas ref={canvasRef} />
              {cameraError && <div className="attendance-camera-alert">{cameraError}</div>}
              {saving && <div className="attendance-saving">Guardando marcaje...</div>}
            </div>

            <label className="attendance-pin">
              PIN
              <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} type="password" inputMode="numeric" maxLength={4} placeholder="••••" autoFocus />
            </label>
            <label className="attendance-pin">
              Observacion opcional
              <input value={observation} onChange={(event) => setObservation(event.target.value)} type="text" maxLength={160} placeholder="Ej. olvide marcar comida" />
            </label>

            <div className="attendance-actions">
              <button type="button" className="entry" disabled={saving || isCheckedIn} onClick={() => mark("entrada")}>Entrada</button>
              <button type="button" className="meal" disabled={saving || !isCheckedIn || Boolean(activeMeal)} onClick={() => mark("salida_comida")}>Salida a comida</button>
              <button type="button" className="meal" disabled={saving || !isCheckedIn || !activeMeal} onClick={() => mark("regreso_comida")}>Regreso de comida</button>
              <button type="button" className="exit" disabled={saving || !isCheckedIn || Boolean(activeMeal)} onClick={() => mark("salida_final")}>Salida final</button>
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

function normalizeProfile(profile) {
  return {
    id: profile.id,
    employeeCode: profile.employee_code || "",
    fullName: profile.full_name || "Colaborador",
    avatarUrl: profile.avatar_url || "",
    areaName: profile.area_name || "",
    pinConfigured: profile.pin_configured === true
  }
}

function getOrCreateDeviceId() {
  const key = "attendanceKioskDeviceId"
  const stored = localStorage.getItem(key)
  if (stored) return stored
  const created = `kiosk-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
  localStorage.setItem(key, created)
  return created
}

function capturePhotoBlob(video, canvas) {
  return new Promise((resolve, reject) => {
    if (!video || !canvas) {
      reject(new Error("Cámara no disponible."))
      return
    }
    const width = video.videoWidth || 960
    const height = video.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    context.drawImage(video, 0, 0, width, height)
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("No se pudo capturar la foto."))
    }, "image/jpeg", 0.9)
  })
}

function initials(name) {
  return String(name || "C").split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
}

export default AttendanceTerminal
