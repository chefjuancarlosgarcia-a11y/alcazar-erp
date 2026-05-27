import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import { getAttendanceTerminalProfiles, setAttendanceDevice, setAttendancePin } from "../services/attendanceService"
import {
  PROFILE_ROLES,
  PROFILE_STATUSES,
  canAssignUserRole,
  canDeactivateUser,
  canEditUserRole,
  canManageAttendancePin,
  canManageUsers
} from "../utils/profilePermissions"
import "./ProfileManagement.css"

const EMPTY_FORM = {
  full_name: "",
  username: "",
  email: "",
  role: "colaborador",
  area_id: "",
  area_name: "",
  employee_id: "",
  avatar_url: "",
  hourly_rate: "",
  attendance_pin: "",
  authorized_attendance_device: "",
  phone: "",
  status: "active"
}

const ROLE_NAMES = {
  admin: "Admin",
  gerente_general: "Gerente General",
  gerente: "Gerente",
  encargado_almacen: "Encargado de Almacén",
  rrhh: "RRHH",
  supervisor: "Supervisor",
  cajero: "Cajero",
  mesero: "Mesero",
  cocinero: "Cocinero",
  pizzero: "Pizzero",
  barista: "Barista",
  bartender: "Bartender",
  repostero: "Repostero",
  panadero: "Panadero",
  colaborador: "Colaborador"
}

function ProfileManagement({ requestedProfileId = "", editRequested = false }) {
  const { user, refreshProfile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [areaOptions, setAreaOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [areaFilter, setAreaFilter] = useState("")
  const [editingProfile, setEditingProfile] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showCreateHelp, setShowCreateHelp] = useState(false)
  const [resettingId, setResettingId] = useState("")
  const [pinConfigured, setPinConfigured] = useState({})
  const [showAttendancePin, setShowAttendancePin] = useState(false)
  const [pinActionMessage, setPinActionMessage] = useState("")

  const canManage = canManageUsers(user)
  const canEditBasic = canManage
  const canManagePin = canManageAttendancePin(user)
  const ownRrhhProfile = user?.role === "rrhh" && String(editingProfile?.id) === String(user?.id)

  useEffect(() => {
    loadProfiles()
    loadAreas()
  }, [])

  useEffect(() => {
    if (!profiles.length || !requestedProfileId || editingProfile) return
    const selected = profiles.find((profile) => String(profile.id) === String(requestedProfileId))
    if (selected && editRequested && canEditBasic) openEdit(selected)
  }, [canEditBasic, editRequested, editingProfile, profiles, requestedProfileId])

  async function loadProfiles() {
    setLoading(true)
    setError("")
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
    if (queryError) {
      setError("No se pudo cargar la lista de profiles. Verifica las políticas RLS aplicadas.")
      setProfiles([])
    } else {
      setProfiles(data || [])
      setMessage("Lista de usuarios actualizada.")
    }
    const { data: terminalProfiles } = await getAttendanceTerminalProfiles()
    setPinConfigured(Object.fromEntries((terminalProfiles || []).map((profile) => [profile.id, profile.pin_configured])))
    setLoading(false)
  }

  async function loadAreas() {
    const { data, error: areasError } = await getActiveAreas()
    if (areasError) {
      setError("No se pudieron cargar las áreas desde Supabase.")
      setAreaOptions([])
      return
    }
    setAreaOptions(data || [])
  }

  function openEdit(profile) {
    setEditingProfile(profile)
    setShowAttendancePin(false)
    setPinActionMessage("")
    setForm({
      ...EMPTY_FORM,
      ...profile,
      email: profile.email || "",
      phone: profile.phone || "",
      area_id: profile.area_id || "",
      area_name: profile.area_name || "",
      employee_id: profile.employee_id || "",
      avatar_url: profile.avatar_url || "",
      hourly_rate: profile.hourly_rate ?? "",
      attendance_pin: "",
      authorized_attendance_device: profile.authorized_attendance_device || ""
    })
    setError("")
    setMessage("")
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateArea(value) {
    const area = areaOptions.find((item) => item.id === value)
    setForm((current) => ({
      ...current,
      area_id: area?.id || "",
      area_name: area?.name || ""
    }))
  }

  function generateAttendancePin() {
    if (editingProfile && pinConfigured[editingProfile.id]) {
      const confirmed = window.confirm("Este colaborador ya tiene un PIN configurado. Al guardar el nuevo PIN, el anterior dejará de funcionar. ¿Deseas continuar?")
      if (!confirmed) return
    }
    updateField("attendance_pin", String(Math.floor(1000 + Math.random() * 9000)))
    setShowAttendancePin(true)
    setPinActionMessage(pinConfigured[editingProfile?.id]
      ? "Nuevo PIN generado. Compártelo con el colaborador y guarda los cambios para invalidar el PIN anterior."
      : "PIN generado. Compártelo con el colaborador antes de guardar.")
  }

  async function copyAttendancePin() {
    if (!form.attendance_pin) return
    try {
      await navigator.clipboard.writeText(form.attendance_pin)
      setPinActionMessage("PIN copiado. Entrégalo únicamente al colaborador correspondiente.")
    } catch {
      setPinActionMessage("No se pudo copiar automáticamente. Puedes seleccionar y copiar el PIN visible.")
      setShowAttendancePin(true)
    }
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (!editingProfile || !canEditBasic) return
    if (!form.full_name.trim() || !form.username.trim()) {
      setError("Nombre y username son obligatorios.")
      return
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError("Ingresa un correo válido.")
      return
    }
    if (form.role !== editingProfile.role && !canAssignUserRole(user, editingProfile, form.role)) {
      setError("No tienes permiso para asignar ese rol.")
      return
    }
    if (form.status !== editingProfile.status && !canDeactivateUser(user, editingProfile)) {
      setError("No puedes cambiar tu propio estado ni administrar el estado de este usuario.")
      return
    }
    if (form.attendance_pin && !/^\d{4,6}$/.test(form.attendance_pin)) {
      setError("El PIN de marcaje debe tener entre 4 y 6 dígitos.")
      return
    }
    if (form.hourly_rate !== "" && Number(form.hourly_rate) < 0) {
      setError("El salario por hora no puede ser negativo.")
      return
    }
    if ((form.attendance_pin || form.authorized_attendance_device !== (editingProfile.authorized_attendance_device || "")) && !canManagePin) {
      setError("No tienes permiso para configurar el PIN o dispositivo de marcaje.")
      return
    }

    const changes = {
      full_name: form.full_name.trim(),
      username: form.username.trim(),
      email: form.email.trim() || null,
      area_id: form.area_id.trim() || null,
      area_name: form.area_name.trim() || null,
      employee_id: form.employee_id.trim() || null,
      avatar_url: form.avatar_url.trim() || null,
      hourly_rate: form.hourly_rate === "" ? null : Number(form.hourly_rate),
      phone: form.phone.trim() || null
    }
    if (canEditUserRole(user, editingProfile)) changes.role = form.role
    if (canDeactivateUser(user, editingProfile)) changes.status = form.status

    const { data, error: updateError } = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", editingProfile.id)
      .select("*")
      .single()
    if (updateError) {
      setError(updateError.message || "No se pudo guardar el profile.")
      return
    }
    if (canManagePin && form.attendance_pin) {
      const { error: pinError } = await setAttendancePin(data.id, form.attendance_pin, form.authorized_attendance_device.trim())
      if (pinError) {
        setError(pinError.message || "No se pudo guardar el PIN de marcaje.")
        return
      }
      setPinConfigured((current) => ({ ...current, [data.id]: true }))
    } else if (canManagePin && (form.authorized_attendance_device || "") !== (editingProfile.authorized_attendance_device || "")) {
      const { error: deviceError } = await setAttendanceDevice(data.id, form.authorized_attendance_device.trim())
      if (deviceError) {
        setError(deviceError.message || "No se pudo actualizar el dispositivo autorizado.")
        return
      }
    }
    const savedProfile = { ...data, authorized_attendance_device: form.authorized_attendance_device.trim() || null }
    setProfiles((current) => current.map((profile) => profile.id === data.id ? savedProfile : profile))
    if (data.id === user.id) await refreshProfile()
    setEditingProfile(null)
    setMessage(form.attendance_pin
      ? "PIN de marcaje guardado correctamente. Cualquier PIN anterior dejó de funcionar."
      : "Profile actualizado correctamente.")
    setError("")
  }

  async function toggleStatus(profile) {
    if (!canDeactivateUser(user, profile)) return
    const nextStatus = profile.status === "active" ? "inactive" : "active"
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({ status: nextStatus })
      .eq("id", profile.id)
      .select("*")
      .single()
    if (updateError) {
      setError(updateError.message || "No se pudo actualizar el estado.")
      return
    }
    setProfiles((current) => current.map((item) => item.id === data.id ? data : item))
    setMessage(nextStatus === "active" ? "Usuario activado." : "Usuario desactivado.")
  }

  async function sendPasswordRecovery(profile) {
    if (!profile.email) {
      setError("Este profile no tiene correo registrado para recuperación.")
      return
    }
    setResettingId(profile.id)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/update-password`
    })
    setResettingId("")
    if (resetError) {
      setError("No se pudo solicitar la recuperación de contraseña.")
      return
    }
    setError("")
    setMessage("Se envió un correo de recuperación si el usuario existe.")
  }

  const filterAreas = useMemo(() => {
    const knownAreas = areaOptions.map((area) => area.name)
    return [...new Set([...knownAreas, ...profiles.map((profile) => profile.area_name).filter(Boolean)])].sort()
  }, [areaOptions, profiles])
  const visibleProfiles = profiles.filter((profile) => {
    const text = `${profile.full_name || ""} ${profile.username || ""} ${profile.email || ""}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase())) &&
      (!roleFilter || profile.role === roleFilter) &&
      (!statusFilter || profile.status === statusFilter) &&
      (!areaFilter || profile.area_name === areaFilter)
  })

  if (!canManage) {
    return <section className="profiles-page"><article className="profiles-empty"><h1>Gestión de usuarios</h1><p>No tienes permiso para administrar profiles.</p></article></section>
  }

  return (
    <section className="profiles-page">
      <header className="profiles-header">
        <div>
          <p className="profiles-eyebrow">Supabase Profiles</p>
          <h1>Gestión de usuarios</h1>
          <p className="profiles-muted">Administra roles, áreas y estado de las cuentas autenticadas.</p>
        </div>
        <div className="profiles-header-actions">
          <button type="button" className="profiles-secondary" onClick={() => setShowCreateHelp(true)}>Crear usuario</button>
          <button type="button" className="profiles-primary" onClick={loadProfiles}>Actualizar lista de usuarios</button>
        </div>
      </header>

      {message && <div className="profiles-success" role="status">{message}</div>}
      {error && <div className="profiles-error" role="alert">{error}</div>}

      <div className="profiles-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, usuario o correo..." />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="">Todos los roles</option>
          {PROFILE_ROLES.map((role) => <option key={role} value={role}>{ROLE_NAMES[role]}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Todos los estados</option>
          {PROFILE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
          <option value="">Todas las áreas</option>
          {filterAreas.map((area) => <option key={area} value={area}>{area}</option>)}
        </select>
      </div>

      {loading ? <article className="profiles-empty">Cargando profiles...</article> : (
        <div className="profiles-table">
          <div className="profiles-table-heading">
            <span>Usuario</span><span>Rol / Área</span><span>Contacto</span><span>Estado</span><span>Actualización</span><span>Acciones</span>
          </div>
          {visibleProfiles.map((profile) => (
            <article className="profiles-row" key={profile.id}>
              <div className="profiles-identity">
                {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{initials(profile.full_name)}</span>}
                <div><strong>{profile.full_name || "Sin nombre"}</strong><small>@{profile.username || "sin-usuario"}</small></div>
              </div>
              <div>
                <Badge type="role" value={profile.role} />
                <small>{profile.area_name || "Sin área"}</small>
                {canManagePin && <span className={`profiles-pin-status ${pinConfigured[profile.id] ? "configured" : ""}`}>{pinConfigured[profile.id] ? "PIN configurado" : "Sin PIN de marcaje"}</span>}
              </div>
              <div><span>{profile.email || "Sin correo"}</span><small>{profile.phone || "Sin teléfono"}</small></div>
              <div><Badge type="status" value={profile.status} /></div>
              <div><small>Alta: {formatDate(profile.created_at)}</small><small>Editado: {formatDate(profile.updated_at)}</small></div>
              <div className="profiles-actions">
                <button type="button" onClick={() => openEdit(profile)}>Editar</button>
                <button type="button" onClick={() => sendPasswordRecovery(profile)} disabled={resettingId === profile.id}>
                  {resettingId === profile.id ? "Enviando..." : "Enviar recuperación"}
                </button>
                {canDeactivateUser(user, profile) && (
                  <button type="button" className="danger" onClick={() => toggleStatus(profile)}>
                    {profile.status === "active" ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
            </article>
          ))}
          {!visibleProfiles.length && <article className="profiles-empty">No existen profiles para estos filtros.</article>}
        </div>
      )}

      {editingProfile && (
        <div className="profiles-modal-overlay">
          <form className="profiles-modal" onSubmit={saveProfile}>
            <header><div><p className="profiles-eyebrow">Editar Profile</p><h2>{editingProfile.full_name || "Usuario"}</h2></div><button type="button" onClick={() => setEditingProfile(null)}>Cerrar</button></header>
            {canManagePin && (
              <section className="profiles-attendance-panel">
                <div>
                  <p className="profiles-eyebrow">Asistencia</p>
                  <h3>PIN de marcaje</h3>
                  <p className="profiles-attendance-help">Genera o escribe un PIN y entrégaselo al colaborador para usar la terminal. Después de guardarlo no podrá consultarse; solo podrá reemplazarse.</p>
                </div>
                <div className="profiles-attendance-fields">
                  <Field label="Nuevo PIN de marcaje">
                    <div className="profiles-pin-field">
                      <input
                        type={showAttendancePin ? "text" : "password"}
                        inputMode="numeric"
                        maxLength={6}
                        value={form.attendance_pin}
                        onChange={(event) => {
                          updateField("attendance_pin", event.target.value.replace(/\D/g, "").slice(0, 6))
                          setPinActionMessage("")
                        }}
                        placeholder={pinConfigured[editingProfile.id] ? "PIN configurado" : "4 a 6 dígitos"}
                      />
                      <button type="button" className="profiles-secondary" onClick={generateAttendancePin}>
                        {pinConfigured[editingProfile.id] ? "Generar PIN nuevo" : "Generar PIN"}
                      </button>
                    </div>
                    <div className="profiles-pin-actions">
                      <button type="button" className="profiles-text-action" onClick={() => setShowAttendancePin((visible) => !visible)} disabled={!form.attendance_pin}>
                        {showAttendancePin ? "Ocultar PIN" : "Mostrar PIN"}
                      </button>
                      <button type="button" className="profiles-text-action" onClick={copyAttendancePin} disabled={!form.attendance_pin}>Copiar PIN</button>
                    </div>
                  </Field>
                  <Field label="Dispositivo autorizado (opcional)">
                    <input
                      value={form.authorized_attendance_device}
                      onChange={(event) => updateField("authorized_attendance_device", event.target.value)}
                      placeholder="Ej. terminal-recepcion-01"
                    />
                  </Field>
                </div>
                {pinActionMessage && <p className="profiles-pin-feedback" role="status">{pinActionMessage}</p>}
                {form.attendance_pin && (
                  <div className="profiles-pin-save-row">
                    <span>Este PIN aún no está activo. Debes guardar para que funcione en la terminal.</span>
                    <button type="submit" className="profiles-primary">Guardar y activar PIN</button>
                  </div>
                )}
                {pinConfigured[editingProfile.id] && !form.attendance_pin && <p className="profiles-note">Este colaborador ya tiene PIN. Si lo perdió, presiona <strong>Generar PIN nuevo</strong>; al guardar, el PIN anterior dejará de funcionar.</p>}
              </section>
            )}
            <div className="profiles-form-grid">
              <Field label="Nombre completo"><input value={form.full_name} onChange={(event) => updateField("full_name", event.target.value)} disabled={ownRrhhProfile} required /></Field>
              <Field label="Username"><input value={form.username} onChange={(event) => updateField("username", event.target.value)} disabled={ownRrhhProfile} required /></Field>
              <Field label="Correo"><input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} /></Field>
              <Field label="Teléfono"><input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} /></Field>
              <Field label="Área">
                <select value={form.area_id} onChange={(event) => updateArea(event.target.value)} disabled={ownRrhhProfile}>
                  <option value="">Sin área asignada</option>
                  {areaOptions.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                </select>
              </Field>
              <Field label="Employee ID"><input value={form.employee_id} onChange={(event) => updateField("employee_id", event.target.value)} disabled={ownRrhhProfile} /></Field>
              <Field label="Avatar URL"><input value={form.avatar_url} onChange={(event) => updateField("avatar_url", event.target.value)} /></Field>
              <Field label="Salario por hora (Q)"><input type="number" min="0" step="0.01" value={form.hourly_rate} onChange={(event) => updateField("hourly_rate", event.target.value)} placeholder="Opcional" disabled={ownRrhhProfile} /></Field>
              <Field label="Rol">
                <select value={form.role} onChange={(event) => updateField("role", event.target.value)} disabled={!canEditUserRole(user, editingProfile)}>
                  {PROFILE_ROLES.map((role) => <option key={role} value={role} disabled={!canAssignUserRole(user, editingProfile, role)}>{ROLE_NAMES[role]}</option>)}
                </select>
              </Field>
              <Field label="Estado">
                <select value={form.status} onChange={(event) => updateField("status", event.target.value)} disabled={!canDeactivateUser(user, editingProfile)}>
                  {PROFILE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </Field>
            </div>
            {user.role === "rrhh" && <p className="profiles-note">RRHH puede editar datos básicos. Los roles y estados son administrados por Admin o Gerente General.</p>}
            <div className="profiles-modal-actions">
              <button type="button" className="profiles-secondary" onClick={() => setEditingProfile(null)}>Cancelar</button>
              <button type="submit" className="profiles-primary">Guardar cambios</button>
            </div>
          </form>
        </div>
      )}

      {showCreateHelp && (
        <div className="profiles-modal-overlay">
          <article className="profiles-modal create">
            <header><h2>Crear usuario</h2><button type="button" onClick={() => setShowCreateHelp(false)}>Cerrar</button></header>
            <p>Por seguridad, la creación real de usuario Auth se hará desde Supabase hasta implementar una Edge Function segura.</p>
            <ol>
              <li>Crea el usuario en Supabase Authentication con correo y contraseña.</li>
              <li>Regresa aquí y presiona <strong>Actualizar lista de usuarios</strong>.</li>
              <li>Edita el profile creado automáticamente para asignar rol, área y estado.</li>
            </ol>
          </article>
        </div>
      )}
    </section>
  )
}

function Field({ label, children }) {
  return <label className="profiles-field"><span>{label}</span>{children}</label>
}

function Badge({ type, value }) {
  return <span className={`profiles-badge ${type}-${value}`}>{ROLE_NAMES[value] || value}</span>
}

function initials(name) {
  return String(name || "U").split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
}

function formatDate(value) {
  if (!value) return "Sin información"
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium" }).format(new Date(value))
}

export default ProfileManagement
