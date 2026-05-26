import { useEffect, useRef, useState } from "react"
import Cropper from "react-easy-crop"
import "react-easy-crop/react-easy-crop.css"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import "./MyProfilePanel.css"

function loadManagedProfile(user) {
  try {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    const legacyProfile = Array.isArray(users) ? users.find((item) => item.id === user?.id) || null : null
    if (!legacyProfile) return null
    return {
      ...legacyProfile,
      nombre: user?.name || legacyProfile.nombre,
      correo: user?.email || legacyProfile.correo,
      telefono: user?.phone || legacyProfile.telefono,
      fotoColaborador: user?.avatar || legacyProfile.fotoColaborador,
      rol: user?.legacyRole || legacyProfile.rol,
      departamento: user?.areaName || user?.areaId || legacyProfile.departamento
    }
  } catch {
    return null
  }
}

function getInitials(name) {
  return String(name || "Usuario").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")
}

function createImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener("load", () => resolve(image))
    image.addEventListener("error", reject)
    image.src = source
  })
}

async function cropImage(source, area) {
  const image = await createImage(source)
  if (!area) return source
  const canvas = document.createElement("canvas")
  canvas.width = area.width
  canvas.height = area.height
  canvas.getContext("2d").drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height)
  return canvas.toDataURL("image/jpeg", 0.92)
}

function getEmergency(profile) {
  if (profile?.contactoEmergenciaDetalle) {
    return {
      nombre: profile.contactoEmergenciaDetalle.nombre || "",
      telefono: profile.contactoEmergenciaDetalle.telefono || "",
      relacion: profile.contactoEmergenciaDetalle.relacion || ""
    }
  }
  const legacy = String(profile?.contactoEmergencia || "").split("·").map((value) => value.trim())
  return { nombre: legacy[0] || "", telefono: legacy[1] || "", relacion: "" }
}

function getSeniority(value, openedAt) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return "Sin información"
  const months = Math.max(0, Math.floor((openedAt - date.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)))
  const years = Math.floor(months / 12)
  const remainder = months % 12
  if (!years) return `${remainder} meses`
  return `${years} año${years === 1 ? "" : "s"}${remainder ? `, ${remainder} meses` : ""}`
}

function formatSchedule(schedule, index) {
  const day = schedule.day || schedule.dia || `Turno ${index + 1}`
  const start = schedule.startTime || [schedule.startHour, schedule.startMinute].filter(Boolean).join(":")
  const end = schedule.endTime || [schedule.endHour, schedule.endMinute].filter(Boolean).join(":")
  const from = [start, schedule.startPeriod].filter(Boolean).join(" ")
  const to = [end, schedule.endPeriod].filter(Boolean).join(" ")
  return `${day}: ${from || "Sin hora"} - ${to || "Sin hora"}`
}

function MyProfilePanel({ currentUser, initialView = "profile", onClose }) {
  const { updateOwnProfile, changeOwnPassword } = useAuth()
  const navigate = useNavigate()
  const panelRef = useRef(null)
  const [profile, setProfile] = useState(() => loadManagedProfile(currentUser))
  const [openedAt] = useState(() => Date.now())
  const source = profile || {
    nombre: currentUser?.name,
    correo: currentUser?.email,
    telefono: currentUser?.phone,
    fotoColaborador: currentUser?.avatar,
    rol: currentUser?.legacyRole,
    departamento: currentUser?.areaName || currentUser?.areaId,
    estado: currentUser?.status === "active" ? "Activo" : currentUser?.status
  }
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => createForm(loadManagedProfile(currentUser), currentUser))
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [showPassword, setShowPassword] = useState(initialView === "password")
  const [password, setPassword] = useState({ current: "", next: "", confirmation: "" })
  const [cropSource, setCropSource] = useState("")
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState(null)
  const [requestField, setRequestField] = useState("")
  const [requestValue, setRequestValue] = useState("")
  const [requestReason, setRequestReason] = useState("")
  const [requests, setRequests] = useState(readRequests)
  const isManager = ["admin", "gerente", "gerente_general"].includes(currentUser?.role)
  const canManageCollaborators = isManager || currentUser?.role === "rrhh"
  const schedules = source.schedules || source.turnos || []

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape") return
      if (cropSource) setCropSource("")
      else if (showPassword) setShowPassword(false)
      else if (requestField) setRequestField("")
      else onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [cropSource, onClose, requestField, showPassword])

  function beginEditing() {
    setForm(createForm(profile, currentUser))
    setEditing(true)
    setNotice("")
    setError("")
  }

  function cancelEditing() {
    setForm(createForm(profile, currentUser))
    setEditing(false)
    setError("")
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateEmergency(field, value) {
    setForm((current) => ({
      ...current,
      contactoEmergenciaDetalle: { ...current.contactoEmergenciaDetalle, [field]: value }
    }))
  }

  async function savePersonalInfo(event) {
    event.preventDefault()
    setError("")
    if (form.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) {
      setError("Ingresa un correo válido o déjalo vacío.")
      return
    }
    const emergencyText = [
      form.contactoEmergenciaDetalle.nombre,
      form.contactoEmergenciaDetalle.telefono,
      form.contactoEmergenciaDetalle.relacion
    ].filter(Boolean).join(" · ")
    const result = await updateOwnProfile({ ...form, contactoEmergencia: emergencyText })
    if (!result.ok) {
      setError(result.message)
      return
    }
    const updatedProfile = {
      ...source,
      correo: form.correo,
      telefono: form.telefono,
      fotoColaborador: form.fotoColaborador,
      contactoEmergencia: emergencyText,
      contactoEmergenciaDetalle: form.contactoEmergenciaDetalle,
      personalPreferences: form.personalPreferences
    }
    setProfile(updatedProfile)
    setEditing(false)
    setNotice("Información personal actualizada correctamente.")
  }

  function selectPhoto(event) {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (loadEvent) => setCropSource(loadEvent.target.result)
    reader.readAsDataURL(file)
    event.target.value = ""
  }

  async function saveCroppedPhoto() {
    const avatar = await cropImage(cropSource, croppedArea)
    updateField("fotoColaborador", avatar)
    setCropSource("")
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  async function submitPassword(event) {
    event.preventDefault()
    setError("")
    if (password.next.length < 8 || !/[A-ZÁÉÍÓÚÑ]/.test(password.next) || !/\d/.test(password.next)) {
      setError("La nueva contraseña debe tener 8 caracteres, una mayúscula y un número.")
      return
    }
    if (password.next !== password.confirmation) {
      setError("Las contraseñas nuevas no coinciden.")
      return
    }
    const result = await changeOwnPassword(password.current, password.next)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setPassword({ current: "", next: "", confirmation: "" })
    setShowPassword(false)
    setNotice("Contraseña actualizada correctamente")
  }

  function submitChangeRequest(event) {
    event.preventDefault()
    const nextRequests = readRequests()
    nextRequests.unshift({
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      userId: currentUser?.id || currentUser?.username,
      field: requestField,
      requestedValue: requestValue.trim(),
      reason: requestReason.trim(),
      status: "pending",
      createdAt: new Date().toISOString()
    })
    localStorage.setItem("profileChangeRequests", JSON.stringify(nextRequests))
    setRequests(nextRequests)
    setRequestField("")
    setRequestValue("")
    setRequestReason("")
    setNotice("Solicitud enviada a Administración y Recursos Humanos.")
  }

  function openCompleteProfile() {
    onClose()
    if (isManager && currentUser?.id) {
      navigate(`/hr?section=usuarios&profileId=${encodeURIComponent(currentUser.id)}&mode=edit`)
      return
    }
    navigate("/hr?section=usuarios")
  }

  return (
    <div className="my-profile-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="my-profile-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Mi perfil">
        <header className="my-profile-header">
          <button type="button" className="my-profile-close" onClick={onClose} aria-label="Cerrar">×</button>
          <div className="my-profile-avatar-block">
            {form.fotoColaborador ? <img src={form.fotoColaborador} alt={`Foto de ${currentUser.name}`} /> : <span>{getInitials(currentUser.name)}</span>}
            {editing && (
              <label className="my-profile-photo-action">
                Cambiar foto
                <input type="file" accept="image/*" onChange={selectPhoto} hidden />
              </label>
            )}
          </div>
          <div className="my-profile-heading">
            <h2>{source.nombre || currentUser.name}</h2>
            <p>{source.puesto || "Sin puesto"} · {source.departamento || "Sin área"}</p>
            <div className="my-profile-badges">
              <span className="active">{source.estado || (source.activo === false ? "Inactivo" : "Activo")}</span>
              {(currentUser.auth?.isOnline ?? source.auth?.isOnline) === true && <span className="online">En línea</span>}
            </div>
          </div>
        </header>

        {notice && <p className="my-profile-success">{notice}</p>}
        {error && <p className="my-profile-error">{error}</p>}

        <div className="my-profile-toolbar">
          {!editing ? (
            <button type="button" className="my-profile-primary" onClick={beginEditing}>Editar información personal</button>
          ) : (
            <>
              <button type="submit" form="personal-profile-form" className="my-profile-primary">Guardar cambios</button>
              <button type="button" className="my-profile-secondary" onClick={cancelEditing}>Cancelar</button>
            </>
          )}
          <button type="button" className="my-profile-secondary" onClick={() => { setShowPassword(true); setNotice(""); setError("") }}>Cambiar contraseña</button>
          {canManageCollaborators && (
            <button type="button" className="my-profile-secondary" onClick={openCompleteProfile}>
              {isManager ? "Editar perfil completo" : "Gestión de colaboradores"}
            </button>
          )}
        </div>

        <form id="personal-profile-form" className="my-profile-sections" onSubmit={savePersonalInfo}>
          <ProfileSection title="Información personal">
            <EditableField editing={editing} label="Correo personal" value={form.correo} onChange={(value) => updateField("correo", value)} type="email" />
            <EditableField editing={editing} label="Teléfono personal" value={form.telefono} onChange={(value) => updateField("telefono", value)} />
            <EditableField editing={editing} label="Contacto de emergencia" value={form.contactoEmergenciaDetalle.nombre} onChange={(value) => updateEmergency("nombre", value)} placeholder="Nombre" />
            <EditableField editing={editing} label="Teléfono de emergencia" value={form.contactoEmergenciaDetalle.telefono} onChange={(value) => updateEmergency("telefono", value)} />
            <EditableField editing={editing} label="Relación" value={form.contactoEmergenciaDetalle.relacion} onChange={(value) => updateEmergency("relacion", value)} />
          </ProfileSection>

          <ProfileSection title="Información laboral">
            <LockedField label="Nombre completo" value={source.nombre || currentUser.name} onRequest={setRequestField} />
            <LockedField label="Usuario" value={source.auth?.username || source.username || currentUser.username} onRequest={setRequestField} />
            <LockedField label="Rol" value={source.rol || currentUser.legacyRole} onRequest={setRequestField} />
            <LockedField label="Puesto" value={source.puesto} onRequest={setRequestField} />
            <LockedField label="Área" value={source.departamento} onRequest={setRequestField} />
            <LockedField label="Estado laboral" value={source.estado || (source.activo === false ? "Inactivo" : "Activo")} onRequest={setRequestField} />
            <LockedField label="Fecha de ingreso" value={source.fechaInicioLabores} onRequest={setRequestField} />
            <LockedField label="Antigüedad" value={getSeniority(source.fechaInicioLabores, openedAt)} onRequest={setRequestField} />
            <p className="my-profile-managed-note">Esta información solo puede ser modificada por Administración o Recursos Humanos.</p>
          </ProfileSection>

          <ProfileSection title="Horarios">
            {schedules.length ? schedules.map((schedule, index) => <div className="my-profile-schedule" key={`${index}-${schedule.day || ""}`}>{formatSchedule(schedule, index)}</div>) : <p className="my-profile-empty">Sin información</p>}
            <LockedField label="Horario laboral" value="Administrado por RRHH" onRequest={setRequestField} />
          </ProfileSection>

          <ProfileSection title="Seguridad">
            <p className="my-profile-copy">Tu contraseña nunca se muestra. Puedes actualizarla usando tu contraseña actual.</p>
            <button type="button" className="my-profile-secondary" onClick={() => setShowPassword(true)}>Cambiar contraseña</button>
          </ProfileSection>

          <ProfileSection title="Preferencias">
            <EditableSelect editing={editing} label="Tema visual" value={form.personalPreferences.theme} onChange={(value) => setForm((current) => ({ ...current, personalPreferences: { ...current.personalPreferences, theme: value } }))} />
            <label className={`my-profile-editable ${editing ? "editing" : ""}`}>
              <span>✎ Notificaciones</span>
              <input type="checkbox" checked={form.personalPreferences.notifications} disabled={!editing} onChange={(event) => setForm((current) => ({ ...current, personalPreferences: { ...current.personalPreferences, notifications: event.target.checked } }))} />
              <strong>{form.personalPreferences.notifications ? "Activadas" : "Desactivadas"}</strong>
            </label>
          </ProfileSection>

          {canManageCollaborators && (
            <ProfileSection title="Solicitudes de cambio pendientes">
              {requests.filter((request) => request.status === "pending").length ? requests.filter((request) => request.status === "pending").map((request) => (
                <div className="my-profile-request" key={request.id}>
                  <strong>{request.field}</strong>
                  <span>Usuario: {request.userId}</span>
                  <span>Nuevo valor: {request.requestedValue}</span>
                  <small>{request.reason}</small>
                </div>
              )) : <p className="my-profile-empty">No hay solicitudes pendientes.</p>}
            </ProfileSection>
          )}
        </form>
      </aside>

      {cropSource && (
        <div className="my-profile-modal-overlay">
          <div className="my-profile-modal crop">
            <h3>Recortar foto de perfil</h3>
            <div className="my-profile-crop-area">
              <Cropper image={cropSource} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedArea(pixels)} />
            </div>
            <label className="my-profile-zoom">Zoom<input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            <div className="my-profile-modal-actions">
              <button type="button" className="my-profile-primary" onClick={saveCroppedPhoto}>Guardar recorte</button>
              <button type="button" className="my-profile-secondary" onClick={() => setCropSource("")}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showPassword && (
        <div className="my-profile-modal-overlay">
          <form className="my-profile-modal" onSubmit={submitPassword}>
            <h3>Cambiar contraseña</h3>
            <label>Contraseña actual<input type="password" value={password.current} onChange={(event) => setPassword((current) => ({ ...current, current: event.target.value }))} autoComplete="current-password" required /></label>
            <label>Nueva contraseña<input type="password" value={password.next} onChange={(event) => setPassword((current) => ({ ...current, next: event.target.value }))} autoComplete="new-password" required /></label>
            <label>Confirmar nueva contraseña<input type="password" value={password.confirmation} onChange={(event) => setPassword((current) => ({ ...current, confirmation: event.target.value }))} autoComplete="new-password" required /></label>
            <p className="my-profile-copy">Mínimo 8 caracteres, una mayúscula y un número.</p>
            {error && <p className="my-profile-error">{error}</p>}
            <div className="my-profile-modal-actions">
              <button type="submit" className="my-profile-primary">Actualizar contraseña</button>
              <button type="button" className="my-profile-secondary" onClick={() => setShowPassword(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {requestField && (
        <div className="my-profile-modal-overlay">
          <form className="my-profile-modal" onSubmit={submitChangeRequest}>
            <h3>Solicitar cambio</h3>
            <label>Campo<input value={requestField} readOnly /></label>
            <label>Nuevo valor solicitado<input value={requestValue} onChange={(event) => setRequestValue(event.target.value)} required /></label>
            <label>Motivo<textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} required /></label>
            <div className="my-profile-modal-actions">
              <button type="submit" className="my-profile-primary">Enviar solicitud</button>
              <button type="button" className="my-profile-secondary" onClick={() => setRequestField("")}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function createForm(profile, currentUser) {
  return {
    correo: profile?.correo || currentUser?.personalProfile?.correo || currentUser?.email || "",
    telefono: profile?.telefono || currentUser?.personalProfile?.telefono || "",
    fotoColaborador: profile?.fotoColaborador || currentUser?.personalProfile?.fotoColaborador || currentUser?.avatar || "",
    contactoEmergenciaDetalle: getEmergency(profile || currentUser?.personalProfile),
    personalPreferences: {
      theme: profile?.personalPreferences?.theme || currentUser?.personalPreferences?.theme || "dark",
      notifications: profile?.personalPreferences?.notifications ?? currentUser?.personalPreferences?.notifications ?? true
    }
  }
}

function readRequests() {
  try {
    const stored = JSON.parse(localStorage.getItem("profileChangeRequests") || "[]")
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

function ProfileSection({ title, children }) {
  return <section className="my-profile-section"><h3>{title}</h3><div className="my-profile-fields">{children}</div></section>
}

function EditableField({ editing, label, value, onChange, type = "text", placeholder }) {
  return (
    <label className={`my-profile-editable ${editing ? "editing" : ""}`}>
      <span>✎ {label}</span>
      {editing ? <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <strong>{value || "Sin información"}</strong>}
    </label>
  )
}

function EditableSelect({ editing, label, value, onChange }) {
  return (
    <label className={`my-profile-editable ${editing ? "editing" : ""}`}>
      <span>✎ {label}</span>
      {editing ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}><option value="dark">Oscuro</option><option value="light">Claro</option></select>
      ) : <strong>{value === "light" ? "Claro" : "Oscuro"}</strong>}
    </label>
  )
}

function LockedField({ label, value, onRequest }) {
  return (
    <div className="my-profile-locked" title="Solicita el cambio a Recursos Humanos.">
      <div><span>🔒 {label}</span><small>Administrado por RRHH</small><strong>{value || "Sin información"}</strong></div>
      <button type="button" onClick={() => onRequest(label)}>Solicitar cambio</button>
    </div>
  )
}

export default MyProfilePanel
