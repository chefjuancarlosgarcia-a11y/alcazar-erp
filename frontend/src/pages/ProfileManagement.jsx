import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import { useAuth } from "../context/AuthContext"
import { createOperationalArea, getActiveAreas } from "../services/areasService"
import {
  getAttendanceTerminalProfiles,
  setAttendanceDevice,
  setAttendancePin,
  validateAttendancePinAvailable
} from "../services/attendanceService"
import {
  deleteEmployeeCustomSchedule,
  getEmployeeCustomSchedules,
  getShiftTypes,
  saveEmployeeCustomSchedule
} from "../services/schedulesService"
import {
  PROFILE_ROLES,
  PROFILE_STATUSES,
  canAssignUserRole,
  canCreateUserRole,
  canDeactivateUser,
  canEditUser,
  canEditUserRole,
  canManageAttendancePinForUser,
  canManageUsers,
  canManageRoleCatalog,
  canManageAreaCatalog,
  getAllowedAssignableRoles,
  loadDynamicRoles,
  getRoleDisplayName
} from "../utils/profilePermissions"
import * as userRolesService from "../services/userRolesService"
import "./ProfileManagement.css"

const ROLE_CATALOG_DENIED_MESSAGE = "Solo Administración puede crear roles personalizados."
const AREA_CATALOG_DENIED_MESSAGE = "Solo Administración puede crear áreas operativas."

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
  status: "active",
  supervisor_profile_id: ""
}

const CREATE_FORM = {
  ...EMPTY_FORM,
  password: "",
  send_invite: false
}

const ROLE_NAMES = {
  admin: "Admin",
  gerente_general: "Gerente General",
  gerente: "Gerente",
  encargado_almacen: "Encargado de Almacen",
  rrhh: "Recursos Humanos",
  supervisor: "Supervisor",
  cajero: "Cajero",
  caja: "Caja",
  mesero: "Mesero",
  cocinero: "Cocinero",
  cocina: "Cocina",
  servicio: "Servicio",
  pizzero: "Pizzero",
  pizzeria: "Pizzeria",
  barista: "Barista",
  bartender: "Bartender",
  repostero: "Repostero",
  panadero: "Panadero",
  cafeteria: "Cafeteria",
  limpieza: "Limpieza",
  repartidor: "Repartidor",
  mantenimiento: "Mantenimiento",
  operativo: "Operativo",
  colaborador: "Colaborador"
}

const STATUS_NAMES = {
  active: "Activo",
  inactive: "Inactivo",
  suspended: "Suspendido"
}

const PIN_ERROR = "El PIN ya esta asignado a otro usuario."
const SHIFT_MANAGER_ROLES = ["admin", "gerente_general", "rrhh", "recursos_humanos"]
const WEEKDAY_OPTIONS = [
  [0, "Domingo"],
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miercoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sabado"]
]

function ProfileManagement({ requestedProfileId = "", editRequested = false }) {
  const { user, refreshProfile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [areaOptions, setAreaOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [modalError, setModalError] = useState("")
  const [modalMessage, setModalMessage] = useState("")
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [areaFilter, setAreaFilter] = useState("")
  const [sortBy, setSortBy] = useState("name")
  const [editingProfile, setEditingProfile] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(CREATE_FORM)
  const [resettingId, setResettingId] = useState("")
  const [deletingId, setDeletingId] = useState("")
  const [pinConfigured, setPinConfigured] = useState({})
  const [showAttendancePin, setShowAttendancePin] = useState(false)
  const [pinActionMessage, setPinActionMessage] = useState("")
  const [pinGeneratedAutomatically, setPinGeneratedAutomatically] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [shiftTypes, setShiftTypes] = useState([])
  const [customSchedules, setCustomSchedules] = useState([])
  const [customScheduleForm, setCustomScheduleForm] = useState(null)
  
  // Dynamic roles state
  const [dynamicRoles, setDynamicRoles] = useState([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [showNewRoleModal, setShowNewRoleModal] = useState(false)
  const [newRoleForm, setNewRoleForm] = useState({
    role_name: "",
    category: "Personalizado",
    description: ""
  })
  const [newRoleError, setNewRoleError] = useState("")
  const [newRoleCreating, setNewRoleCreating] = useState(false)
  const [createdRoleKey, setCreatedRoleKey] = useState("")
  const [showNewAreaModal, setShowNewAreaModal] = useState(false)
  const [newAreaForm, setNewAreaForm] = useState({
    name: "",
    type: "operativa",
    description: ""
  })
  const [newAreaError, setNewAreaError] = useState("")
  const [newAreaCreating, setNewAreaCreating] = useState(false)

  const canManage = canManageUsers(user)
  const canManageSpecialSchedules = SHIFT_MANAGER_ROLES.includes(user?.role)
  const assignableRoles = useMemo(() => {
    const availableRoleKeys = dynamicRoles.map((r) => r.role_key)
    const allowed = getAllowedAssignableRoles(user)
    // Filter allowed roles by what's available in dynamicRoles
    return allowed.length > 0 ? allowed.filter((role) => availableRoleKeys.includes(role)) : availableRoleKeys
  }, [user, dynamicRoles])
  const canEditCurrent = editingProfile ? canEditUser(user, editingProfile) : false
  const canManageCurrentPin = editingProfile ? canManageAttendancePinForUser(user, editingProfile) : false
  const currentIsReadOnly = editingProfile && !canEditCurrent

  // Helper function to get role display name
  const getRoleName = (roleKey) => {
    const role = dynamicRoles.find((r) => r.role_key === roleKey)
    return role?.role_name || ROLE_NAMES[roleKey] || roleKey
  }

  const canManageSupervisorAssignment = ["admin", "gerente_general", "recursos_humanos", "rrhh"].includes(user?.role)

  const supervisorOptions = useMemo(() => {
    const managerRoles = new Set(["admin", "gerente_general", "gerente", "supervisor"])
    return profiles
      .filter((profile) => profile.status === "active" && managerRoles.has(profile.role))
      .filter((profile) => !editingProfile || profile.id !== editingProfile.id)
      .sort((left, right) => String(left.full_name || left.username).localeCompare(String(right.full_name || right.username), "es"))
  }, [profiles, editingProfile])

  const getSupervisorName = (supervisorId) => {
    if (!supervisorId) return "Sin supervisor"
    const supervisor = profiles.find((profile) => profile.id === supervisorId)
    return supervisor?.full_name || supervisor?.username || "Supervisor"
  }

  useEffect(() => {
    loadProfiles({ silent: true })
    loadAreas()
    loadRoles()
    loadShiftTypes()
  }, [])

  useEffect(() => {
    if (!profiles.length || !requestedProfileId || editingProfile) return
    const selected = profiles.find((profile) => String(profile.id) === String(requestedProfileId))
    if (selected && editRequested) openEdit(selected)
  }, [editRequested, editingProfile, profiles, requestedProfileId])

  async function loadProfiles(options = {}) {
    setLoading(true)
    setError("")
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true, nullsFirst: false })
    if (queryError) {
      setError("No se pudo cargar la lista de usuarios. Verifica las politicas RLS aplicadas.")
      setProfiles([])
    } else {
      setProfiles(data || [])
      if (!options.silent) setMessage("Lista de usuarios actualizada.")
    }
    const { data: terminalProfiles } = await getAttendanceTerminalProfiles()
    setPinConfigured(Object.fromEntries((terminalProfiles || []).map((profile) => [profile.id, profile.pin_configured])))
    setLoading(false)
  }

  async function loadAreas() {
    const { data, error: areasError } = await getActiveAreas()
    if (areasError) {
      setError("No se pudieron cargar las areas desde Supabase.")
      setAreaOptions([])
      return
    }
    setAreaOptions(data || [])
  }

  async function loadRoles() {
    try {
      setRolesLoading(true)
      const roles = await userRolesService.getUserRoles()
      setDynamicRoles(roles || [])
      // Also load the dynamic roles cache for profile permissions
      await loadDynamicRoles()
    } catch (err) {
      console.error("Error loading roles:", err)
      // Fall back to default roles
      setDynamicRoles(PROFILE_ROLES.map((key) => ({
        role_key: key,
        role_name: key,
        is_system: true,
        is_active: true
      })))
    } finally {
      setRolesLoading(false)
    }
  }

  async function loadShiftTypes() {
    const { data } = await getShiftTypes(false)
    setShiftTypes(data || [])
  }

  async function loadCustomSchedules(profileId) {
    if (!profileId) {
      setCustomSchedules([])
      return
    }
    const { data, error: schedulesError } = await getEmployeeCustomSchedules(profileId)
    if (schedulesError) {
      setModalError("No se pudieron cargar los turnos especiales.")
      setCustomSchedules([])
      return
    }
    setCustomSchedules(data || [])
  }

  async function createNewRole() {
    if (!canManageRoleCatalog(user)) {
      setNewRoleError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    try {
      setNewRoleError("")
      if (!newRoleForm.role_name.trim()) {
        setNewRoleError("El nombre del rol es obligatorio")
        return
      }

      setNewRoleCreating(true)
      const role = await userRolesService.createUserRole({
        role_name: newRoleForm.role_name.trim(),
        category: newRoleForm.category || "Personalizado",
        description: newRoleForm.description || ""
      })

      // Update dynamic roles
      const updatedRoles = await userRolesService.getUserRoles()
      setDynamicRoles(updatedRoles || [])

      // Clear form and close modal
      setCreatedRoleKey(role.role_key)
      setNewRoleForm({ role_name: "", category: "Personalizado", description: "" })
      
      setModalMessage(`Rol "${role.role_name}" creado exitosamente. Ahora está disponible para asignar.`)
      
      // Auto-close modal after 2 seconds
      setTimeout(() => {
        setShowNewRoleModal(false)
        setModalMessage("")
      }, 2000)
    } catch (err) {
      console.error("Error creating role:", err)
      setNewRoleError(err.message || "Error al crear el rol")
    } finally {
      setNewRoleCreating(false)
    }
  }

  function openNewRoleModal() {
    if (!canManageRoleCatalog(user)) {
      setNewRoleError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    setNewRoleForm({ role_name: "", category: "Personalizado", description: "" })
    setNewRoleError("")
    setShowNewRoleModal(true)
  }

  function closeNewRoleModal() {
    setShowNewRoleModal(false)
    setNewRoleForm({ role_name: "", category: "Personalizado", description: "" })
    setNewRoleError("")
  }

  function applyCreatedAreaToForms(area) {
    if (!area?.id) return
    if (showCreate) {
      setCreateForm((current) => ({ ...current, area_id: area.id, area_name: area.name }))
    } else if (editingProfile) {
      setForm((current) => ({ ...current, area_id: area.id, area_name: area.name }))
    }
  }

  async function createNewArea() {
    if (!canManageAreaCatalog(user)) {
      setNewAreaError(AREA_CATALOG_DENIED_MESSAGE)
      return
    }
    try {
      setNewAreaError("")
      if (!newAreaForm.name.trim()) {
        setNewAreaError("El nombre del área es obligatorio")
        return
      }

      setNewAreaCreating(true)
      const area = await createOperationalArea({
        name: newAreaForm.name.trim(),
        type: newAreaForm.type || "operativa",
        description: newAreaForm.description || ""
      })

      await loadAreas()
      applyCreatedAreaToForms(area)
      setNewAreaForm({ name: "", type: "operativa", description: "" })
      setModalMessage(`Área "${area.name}" creada exitosamente. Ya está disponible para asignar.`)

      setTimeout(() => {
        setShowNewAreaModal(false)
        setModalMessage("")
      }, 2000)
    } catch (err) {
      console.error("Error creating area:", err)
      setNewAreaError(err.message || "Error al crear el área")
    } finally {
      setNewAreaCreating(false)
    }
  }

  function openNewAreaModal() {
    if (!canManageAreaCatalog(user)) {
      setNewAreaError(AREA_CATALOG_DENIED_MESSAGE)
      return
    }
    setNewAreaForm({ name: "", type: "operativa", description: "" })
    setNewAreaError("")
    setShowNewAreaModal(true)
  }

  function closeNewAreaModal() {
    setShowNewAreaModal(false)
    setNewAreaForm({ name: "", type: "operativa", description: "" })
    setNewAreaError("")
  }

  function openEdit(profile) {
    const profileUsername = String(profile.username || "").trim()
    const copiedCurrentUsername = profileUsername &&
      String(profile.id) !== String(user?.id) &&
      profileUsername === user?.username &&
      profile.email &&
      user?.email &&
      profile.email !== user.email
    setEditingProfile(profile)
    setShowAttendancePin(false)
    setPinActionMessage("")
    setPinGeneratedAutomatically(false)
    setModalError("")
    setModalMessage("")
    setForm({
      ...EMPTY_FORM,
      ...profile,
      username: copiedCurrentUsername ? suggestUsername(profile) : profileUsername || suggestUsername(profile),
      email: profile.email || "",
      phone: profile.phone || "",
      area_id: profile.area_id || "",
      area_name: profile.area_name || "",
      employee_id: profile.employee_id || "",
      avatar_url: profile.avatar_url || "",
      hourly_rate: profile.hourly_rate ?? "",
      attendance_pin: "",
      authorized_attendance_device: profile.authorized_attendance_device || "",
      supervisor_profile_id: profile.supervisor_profile_id || ""
    })
    setError("")
    setMessage("")
    setCustomScheduleForm(null)
    loadCustomSchedules(profile.id)
  }

  function openCreate() {
    setCreateForm({ ...CREATE_FORM, role: assignableRoles[0] || "colaborador" })
    setModalError("")
    setModalMessage("")
    setShowCreate(true)
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setModalError("")
  }

  function updateCreateField(field, value) {
    setCreateForm((current) => ({ ...current, [field]: value }))
    setModalError("")
  }

  function updateArea(value, setter = setForm) {
    const area = areaOptions.find((item) => item.id === value)
    setter((current) => ({
      ...current,
      area_id: area?.id || "",
      area_name: area?.name || ""
    }))
  }

  async function generateAttendancePin() {
    if (!canManageCurrentPin) return
    setModalError("")
    if (editingProfile && pinConfigured[editingProfile.id]) {
      const confirmed = window.confirm("Este colaborador ya tiene un PIN configurado. Al guardar el nuevo PIN, el anterior dejara de funcionar. Deseas continuar?")
      if (!confirmed) return
    }
    const pin = await generateUniquePin(editingProfile?.id)
    if (!pin) {
      setModalError("No se pudo generar un PIN unico. Intenta nuevamente.")
      return
    }
    updateField("attendance_pin", pin)
    setPinGeneratedAutomatically(true)
    setShowAttendancePin(true)
    setPinActionMessage(pinConfigured[editingProfile?.id]
      ? "Nuevo PIN unico generado. Compartelo con el colaborador y guarda los cambios para invalidar el PIN anterior."
      : "PIN unico generado. Compartelo con el colaborador antes de guardar.")
  }

  async function generateUniquePin(employeeId) {
    const tried = new Set()
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const pin = String(Math.floor(1000 + Math.random() * 9000))
      if (tried.has(pin)) continue
      tried.add(pin)
      const availability = await checkPinAvailability(pin, employeeId)
      if (availability !== false) return pin
    }
    return ""
  }

  async function checkPinAvailability(pin, employeeId) {
    const { data, error: availabilityError } = await validateAttendancePinAvailable(pin, employeeId)
    if (availabilityError) return null
    return data === true
  }

  async function copyAttendancePin() {
    if (!form.attendance_pin) return
    try {
      await navigator.clipboard.writeText(form.attendance_pin)
      setPinActionMessage("PIN copiado. Entregalo unicamente al colaborador correspondiente.")
    } catch {
      setPinActionMessage("No se pudo copiar automaticamente. Puedes seleccionar y copiar el PIN visible.")
      setShowAttendancePin(true)
    }
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (saving) return
    if (!editingProfile) return
    if (!canEditCurrent) {
      setModalError("No tienes permisos para editar este usuario.")
      return
    }

    const validationError = validateProfileForm(form)
    if (validationError) {
      setModalError(validationError)
      return
    }
    const nextUsername = normalizeUsername(form.username)
    const currentUsername = normalizeUsername(editingProfile.username || "")
    const usernameError = await validateUsernameAvailable(nextUsername, editingProfile.id)
    if (usernameError) {
      setModalError(usernameError)
      return
    }
    if (form.role !== editingProfile.role && !canAssignUserRole(user, editingProfile, form.role)) {
      setModalError("No tienes permisos para asignar este rol.")
      return
    }
    if (form.status !== editingProfile.status && !canDeactivateUser(user, editingProfile)) {
      setModalError("No tienes permisos para editar este usuario.")
      return
    }
    if ((form.attendance_pin || form.authorized_attendance_device !== (editingProfile.authorized_attendance_device || "")) && !canManageCurrentPin) {
      setModalError("No tienes permisos para editar este usuario.")
      return
    }
    let pinToSave = form.attendance_pin
    if (pinToSave) {
      const pinAvailable = await checkPinAvailability(pinToSave, editingProfile.id)
      if (pinAvailable === false) {
        if (!pinGeneratedAutomatically) {
          setModalError(PIN_ERROR)
          return
        }
        const replacementPin = await generateUniquePin(editingProfile.id)
        if (!replacementPin) {
          setModalError(PIN_ERROR)
          return
        }
        pinToSave = replacementPin
        setForm((current) => ({ ...current, attendance_pin: replacementPin }))
        setShowAttendancePin(true)
      }
    }

    setSaving(true)
    setModalError("")
    setModalMessage("Guardando...")

    const changes = {
      full_name: form.full_name.trim(),
      username: nextUsername || currentUsername || suggestUsername({ ...editingProfile, ...form }),
      email: form.email.trim() || null,
      area_id: form.area_id.trim() || null,
      area_name: form.area_name.trim() || null,
      employee_id: form.employee_id.trim() || null,
      avatar_url: form.avatar_url.trim() || null,
      phone: form.phone.trim() || null
    }
    if (form.hourly_rate !== "" || editingProfile.hourly_rate != null) {
      changes.hourly_rate = form.hourly_rate === "" ? null : Number(form.hourly_rate)
    }
    if (canEditUserRole(user, editingProfile)) changes.role = form.role
    if (canDeactivateUser(user, editingProfile)) changes.status = form.status
    if (canManageSupervisorAssignment) {
      changes.supervisor_profile_id = form.supervisor_profile_id || null
    }

    const { data, error: updateError } = await updateProfileWithFallback(editingProfile.id, changes)
    if (updateError) {
      finishSaveWithError(databaseError(updateError))
      return
    }

    let savedPin = pinToSave
    if (canManageCurrentPin && pinToSave) {
      const pinResult = await saveAttendancePinWithRetry(data.id, pinToSave, form.authorized_attendance_device.trim())
      if (pinResult.error) {
        finishSaveWithError(pinResult.message)
        return
      }
      savedPin = pinResult.pin
      setPinConfigured((current) => ({ ...current, [data.id]: true }))
    } else if (canManageCurrentPin && (form.authorized_attendance_device || "") !== (editingProfile.authorized_attendance_device || "")) {
      const { error: deviceError } = await setAttendanceDevice(data.id, form.authorized_attendance_device.trim())
      if (deviceError) {
        finishSaveWithError("Error al guardar en la base de datos.")
        return
      }
    }

    if (data.id === user.id) await refreshProfile()
    if (savedPin && savedPin !== form.attendance_pin) {
      setForm((current) => ({ ...current, attendance_pin: savedPin }))
      setShowAttendancePin(true)
    }
    setModalMessage("Usuario guardado correctamente")
    setSaving(false)
    await loadProfiles({ silent: true })
    window.setTimeout(() => {
      setEditingProfile(null)
      setModalMessage("")
    }, 700)
  }

  async function saveSpecialSchedule(event) {
    event?.preventDefault?.()
    if (!editingProfile || !customScheduleForm || !canManageSpecialSchedules) return
    if (!customScheduleForm.shift_type_id) {
      setModalError("Selecciona un tipo de turno.")
      return
    }
    const payload = {
      ...customScheduleForm,
      profile_id: editingProfile.id
    }
    const { error: saveError } = await saveEmployeeCustomSchedule(payload)
    if (saveError) {
      setModalError(saveError.message || "No se pudo guardar el turno especial.")
      return
    }
    setCustomScheduleForm(null)
    setModalMessage("Turno especial guardado.")
    await loadCustomSchedules(editingProfile.id)
  }

  async function deleteSpecialSchedule(schedule) {
    if (!canManageSpecialSchedules || !window.confirm("Deseas eliminar este turno especial?")) return
    const { error: deleteError } = await deleteEmployeeCustomSchedule(schedule.id)
    if (deleteError) {
      setModalError(deleteError.message || "No se pudo eliminar el turno especial.")
      return
    }
    setModalMessage("Turno especial eliminado.")
    await loadCustomSchedules(editingProfile.id)
  }

  function startSpecialSchedule(schedule = null) {
    setCustomScheduleForm(schedule ? {
      id: schedule.id,
      profile_id: schedule.profile_id,
      shift_type_id: schedule.shift_type_id || "",
      weekday: schedule.weekday ?? "",
      specific_date: schedule.specific_date || "",
      start_date: schedule.start_date || "",
      end_date: schedule.end_date || "",
      start_time: trimTime(schedule.start_time),
      end_time: trimTime(schedule.end_time),
      notes: schedule.notes || "",
      status: schedule.status || "active"
    } : emptyCustomSchedule(editingProfile?.id))
    setModalError("")
  }

  function applySpecialShiftType(value) {
    const type = shiftTypes.find((item) => item.id === value)
    setCustomScheduleForm((current) => ({
      ...current,
      shift_type_id: value,
      start_time: type?.start_time ? trimTime(type.start_time) : current.start_time,
      end_time: type?.end_time ? trimTime(type.end_time) : current.end_time
    }))
  }

  function finishSaveWithError(nextError) {
    setSaving(false)
    setModalMessage("")
    setModalError(nextError)
  }

  async function updateProfileWithFallback(profileId, changes) {
    const result = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", profileId)
      .select("*")
      .single()
    if (!result.error) return result

    const message = String(result.error.message || "").toLowerCase()
    if (message.includes("hourly_rate") && Object.hasOwn(changes, "hourly_rate")) {
      const fallbackChanges = { ...changes }
      delete fallbackChanges.hourly_rate
      return supabase
        .from("profiles")
        .update(fallbackChanges)
        .eq("id", profileId)
        .select("*")
        .single()
    }
    return result
  }

  async function validateUsernameAvailable(username, profileId) {
    if (!username) return "Faltan campos obligatorios."
    let query = supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .limit(1)
    if (profileId) query = query.neq("id", profileId)
    const { data, error: usernameError } = await query
    if (usernameError) return databaseError(usernameError)
    return data?.length ? "Este nombre de usuario ya esta en uso. Por favor utiliza uno diferente." : ""
  }

  async function saveAttendancePinWithRetry(employeeId, initialPin, authorizedDevice) {
    let nextPin = initialPin
    const tried = new Set([initialPin])
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { error: pinError } = await setAttendancePin(employeeId, nextPin, authorizedDevice)
      if (!pinError) return { pin: nextPin, error: null, message: "" }

      const message = String(pinError.message || "").toLowerCase()
      const isConflict = message.includes("asignado") || message.includes("duplicate") || message.includes("pin")
      if (!pinGeneratedAutomatically || !isConflict) {
        return {
          pin: nextPin,
          error: pinError,
          message: isConflict ? PIN_ERROR : "Error al guardar en la base de datos."
        }
      }

      nextPin = await generateUniquePin(employeeId)
      if (!nextPin || tried.has(nextPin)) {
        return { pin: initialPin, error: pinError, message: PIN_ERROR }
      }
      tried.add(nextPin)
    }
    return { pin: initialPin, error: new Error(PIN_ERROR), message: PIN_ERROR }
  }

  async function createUser(event) {
    event.preventDefault()
    if (creating) return
    const validationError = validateProfileForm(createForm, true)
    if (validationError) {
      setModalError(validationError)
      return
    }
    const nextUsername = normalizeUsername(createForm.username || suggestUsername(createForm))
    const usernameError = await validateUsernameAvailable(nextUsername)
    if (usernameError) {
      setModalError(usernameError)
      return
    }
    if (!canCreateUserRole(user, createForm.role)) {
      setModalError("No tienes permisos para asignar ese rol.")
      return
    }

    setCreating(true)
    setModalError("")
    setModalMessage("Guardando...")
    const { error: createError } = await supabase.functions.invoke("create-user", {
      body: {
        email: createForm.email.trim(),
        password: createForm.password,
        profile: {
          full_name: createForm.full_name.trim(),
          username: nextUsername,
          role: createForm.role,
          area_id: createForm.area_id || null,
          area_name: createForm.area_name || null,
          employee_id: createForm.employee_id.trim() || null,
          phone: createForm.phone.trim() || null,
          status: createForm.status
        }
      }
    })
    if (createError) {
      setCreating(false)
      setModalMessage("")
      setModalError(createError.message || "Error al guardar en la base de datos.")
      return
    }
    setModalMessage("Usuario guardado correctamente")
    setCreating(false)
    await loadProfiles({ silent: true })
    window.setTimeout(() => {
      setShowCreate(false)
      setModalMessage("")
    }, 700)
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
      setError(databaseError(updateError))
      return
    }
    setProfiles((current) => current.map((item) => item.id === data.id ? data : item))
    setMessage(nextStatus === "active" ? "Usuario activado." : "Usuario desactivado.")
  }

  async function deleteUser(profile) {
    if (deletingId || !canDeactivateUser(user, profile)) return
    const confirmed = window.confirm(`Eliminar definitivamente a ${profile.full_name || profile.username || "este usuario"}?`)
    if (!confirmed) return
    setDeletingId(profile.id)
    const { error: deleteError } = await supabase.functions.invoke("delete-user", {
      body: { user_id: profile.id }
    })
    setDeletingId("")
    if (deleteError) {
      setError(deleteError.message || "Error al guardar en la base de datos.")
      return
    }
    setProfiles((current) => current.filter((item) => item.id !== profile.id))
    setMessage("Usuario eliminado correctamente.")
  }

  async function sendPasswordRecovery(profile) {
    if (!profile.email) {
      setError("Este usuario no tiene correo registrado para recuperacion.")
      return
    }
    setResettingId(profile.id)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/update-password`
    })
    setResettingId("")
    if (resetError) {
      setError("No se pudo solicitar la recuperacion de contrasena.")
      return
    }
    setError("")
    setMessage("Se envio un correo de recuperacion si el usuario existe.")
  }

  const filterAreas = useMemo(() => {
    const knownAreas = areaOptions.map((area) => area.name)
    return [...new Set([...knownAreas, ...profiles.map((profile) => profile.area_name).filter(Boolean)])].sort()
  }, [areaOptions, profiles])

  const visibleProfiles = useMemo(() => {
    const filtered = profiles.filter((profile) => {
      const text = `${profile.full_name || ""} ${profile.username || ""} ${profile.email || ""}`.toLowerCase()
      return (!query || text.includes(query.toLowerCase())) &&
        (!roleFilter || profile.role === roleFilter) &&
        (!statusFilter || profile.status === statusFilter) &&
        (!areaFilter || profile.area_name === areaFilter)
    })
    return [...filtered].sort((a, b) => {
      if (sortBy === "role") {
        return `${ROLE_NAMES[a.role] || a.role}${a.full_name || ""}`.localeCompare(`${ROLE_NAMES[b.role] || b.role}${b.full_name || ""}`)
      }
      return (a.full_name || a.username || "").localeCompare(b.full_name || b.username || "")
    })
  }, [areaFilter, profiles, query, roleFilter, sortBy, statusFilter])

  if (!canManage) {
    return <section className="profiles-page"><article className="profiles-empty"><h1>Gestion de usuarios</h1><p>No tienes permiso para administrar usuarios.</p></article></section>
  }

  return (
    <section className="profiles-page">
      <header className="profiles-header">
        <div>
          <p className="profiles-eyebrow">Recursos Humanos</p>
          <h1>Gestion de usuarios</h1>
          <p className="profiles-muted">Administra colaboradores, roles, estado de cuenta y PIN de marcaje.</p>
        </div>
        <div className="profiles-header-actions">
          {canManageRoleCatalog(user) && (
            <Link to="/hr?section=catalogos" className="profiles-secondary profiles-header-link">
              Roles y áreas
            </Link>
          )}
          <button type="button" className="profiles-secondary" onClick={openCreate}>Crear usuario</button>
          <button type="button" className="profiles-primary" onClick={() => loadProfiles()}>Actualizar lista</button>
        </div>
      </header>

      {message && <div className="profiles-success" role="status">{message}</div>}
      {error && <div className="profiles-error" role="alert">{error}</div>}

      <div className="profiles-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, usuario o correo..." />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="">Todos los roles</option>
          {dynamicRoles.map((role) => <option key={role.role_key} value={role.role_key}>{role.role_name || role.role_key}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Todos los estados</option>
          {PROFILE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_NAMES[status]}</option>)}
        </select>
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
          <option value="">Todas las areas</option>
          {filterAreas.map((area) => <option key={area} value={area}>{area}</option>)}
        </select>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="name">Ordenar por nombre</option>
          <option value="role">Ordenar por rol</option>
        </select>
      </div>

      {loading ? <article className="profiles-empty">Cargando usuarios...</article> : (
        <div className="profiles-table">
          <div className="profiles-table-heading">
            <span>Usuario</span><span>Rol / Area</span><span>Contacto</span><span>Estado</span><span>PIN</span><span>Acciones</span>
          </div>
          {visibleProfiles.map((profile) => {
            const rowReadOnly = !canEditUser(user, profile)
            return (
              <article className={`profiles-row ${rowReadOnly ? "is-readonly" : ""}`} key={profile.id}>
                <div className="profiles-identity">
                  {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{initials(profile.full_name)}</span>}
                  <div><strong>{profile.full_name || "Sin nombre"}</strong><small>@{profile.username || "sin-usuario"}</small></div>
                </div>
                <div>
                  <Badge type="role" value={profile.role} />
                  <small>{profile.area_name || "Sin area"}</small>
                  <small>{getSupervisorName(profile.supervisor_profile_id)}</small>
                </div>
                <div><span>{profile.email || "Sin correo"}</span><small>{profile.phone || "Sin telefono"}</small></div>
                <div><Badge type="status" value={profile.status} /></div>
                <div><span className={`profiles-pin-status ${pinConfigured[profile.id] ? "configured" : ""}`}>{pinConfigured[profile.id] ? "PIN asignado" : "Sin PIN"}</span></div>
                <div className="profiles-actions">
                  <button type="button" onClick={() => openEdit(profile)}>{rowReadOnly ? "Ver" : "Editar"}</button>
                  <button type="button" onClick={() => sendPasswordRecovery(profile)} disabled={resettingId === profile.id || rowReadOnly}>
                    {resettingId === profile.id ? "Enviando..." : "Recuperacion"}
                  </button>
                  {canDeactivateUser(user, profile) && (
                    <button type="button" className="danger" onClick={() => toggleStatus(profile)}>
                      {profile.status === "active" ? "Desactivar" : "Activar"}
                    </button>
                  )}
                  {canDeactivateUser(user, profile) && (
                    <button type="button" className="danger" onClick={() => deleteUser(profile)} disabled={deletingId === profile.id}>
                      {deletingId === profile.id ? "Eliminando..." : "Eliminar"}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
          {!visibleProfiles.length && <article className="profiles-empty">No existen usuarios para estos filtros.</article>}
        </div>
      )}

      {editingProfile && (
        <div className="profiles-modal-overlay">
          <form className="profiles-modal" onSubmit={saveProfile}>
            <header className="profiles-modal-header">
              <div>
                <p className="profiles-eyebrow">{currentIsReadOnly ? "Solo lectura" : "Editar usuario"}</p>
                <h2>{editingProfile.full_name || "Usuario"}</h2>
              </div>
              <button type="button" onClick={() => setEditingProfile(null)} disabled={saving}>Cerrar</button>
            </header>

            <div className="profiles-modal-body">
              {currentIsReadOnly && <p className="profiles-warning">Este usuario esta protegido. Las acciones de edicion estan deshabilitadas.</p>}
              <FormSection title="Datos personales">
                <div className="profiles-form-grid">
                  <Field label="Nombre completo"><input value={form.full_name} onChange={(event) => updateField("full_name", event.target.value)} disabled={currentIsReadOnly || saving} required /></Field>
                  <Field label="Username"><input value={form.username} onChange={(event) => updateField("username", event.target.value)} disabled={currentIsReadOnly || saving} required /></Field>
                  <Field label="Correo"><input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} disabled={currentIsReadOnly || saving} /></Field>
                  <Field label="Telefono"><input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} disabled={currentIsReadOnly || saving} /></Field>
                </div>
              </FormSection>

              <FormSection title="Rol y acceso">
                <div className="profiles-form-grid">
                  <Field label="Rol">
                    <div className="profiles-role-select-container">
                      <select value={form.role} onChange={(event) => updateField("role", event.target.value)} disabled={saving || !canEditUserRole(user, editingProfile)}>
                        {dynamicRoles.map((role) => (
                          <option key={role.role_key} value={role.role_key} disabled={!canAssignUserRole(user, editingProfile, role.role_key)}>
                            {role.role_name || role.role_key}
                          </option>
                        ))}
                      </select>
                      {canManageRoleCatalog(user) && (
                        <button 
                          type="button" 
                          className="profiles-add-role-btn"
                          onClick={openNewRoleModal}
                          title="Crear un nuevo rol"
                        >
                          + Crear rol
                        </button>
                      )}
                    </div>
                  </Field>
                  <Field label="Estado">
                    <select value={form.status} onChange={(event) => updateField("status", event.target.value)} disabled={saving || !canDeactivateUser(user, editingProfile)}>
                      {PROFILE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_NAMES[status]}</option>)}
                    </select>
                  </Field>
                </div>
              </FormSection>

              <FormSection title="Horarios / informacion laboral">
                <div className="profiles-form-grid">
                  <Field label="Area">
                    <div className="profiles-role-select-container">
                      <select value={form.area_id} onChange={(event) => updateArea(event.target.value)} disabled={currentIsReadOnly || saving}>
                        <option value="">Sin area asignada</option>
                        {areaOptions.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                      </select>
                      {canManageAreaCatalog(user) && (
                        <button
                          type="button"
                          className="profiles-add-role-btn"
                          onClick={openNewAreaModal}
                          disabled={currentIsReadOnly || saving}
                          title="Crear un área operativa nueva"
                        >
                          + Crear área
                        </button>
                      )}
                    </div>
                  </Field>
                  <Field label="Employee ID"><input value={form.employee_id} onChange={(event) => updateField("employee_id", event.target.value)} disabled={currentIsReadOnly || saving} /></Field>
                  <Field label="Salario por hora (Q)"><input type="number" min="0" step="0.01" value={form.hourly_rate} onChange={(event) => updateField("hourly_rate", event.target.value)} placeholder="Opcional" disabled={currentIsReadOnly || saving} /></Field>
                  <Field label="Supervisor a cargo" hint="Define quien puede asignar tareas y checklists a este colaborador.">
                    <select value={form.supervisor_profile_id} onChange={(event) => updateField("supervisor_profile_id", event.target.value)} disabled={currentIsReadOnly || saving || !canManageSupervisorAssignment}>
                      <option value="">Sin supervisor asignado</option>
                      {supervisorOptions.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.full_name || profile.username} · {getRoleName(profile.role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Dispositivo autorizado">
                    <input value={form.authorized_attendance_device} onChange={(event) => updateField("authorized_attendance_device", event.target.value)} placeholder="Ej. terminal-recepcion-01" disabled={!canManageCurrentPin || saving} />
                  </Field>
                </div>
              </FormSection>

              <FormSection title="Horario extraordinario / Turnos especiales">
                <div className="profiles-special-schedules">
                  {customSchedules.map((schedule) => (
                    <article className="profiles-special-row" key={schedule.id}>
                      <span className="profiles-special-dot" style={{ background: schedule.shift_types?.color || "#14b8a6" }} />
                      <div>
                        <strong>{schedule.shift_types?.name || "Turno especial"}</strong>
                        <small>{specialScheduleLabel(schedule)} · {schedule.status === "active" ? "Activo" : "Inactivo"}</small>
                        {schedule.notes && <em>{schedule.notes}</em>}
                      </div>
                      {canManageSpecialSchedules && <button type="button" className="profiles-secondary" onClick={() => startSpecialSchedule(schedule)} disabled={saving}>Editar</button>}
                      {canManageSpecialSchedules && <button type="button" className="profiles-secondary danger" onClick={() => deleteSpecialSchedule(schedule)} disabled={saving}>Eliminar</button>}
                    </article>
                  ))}
                  {!customSchedules.length && <p className="profiles-empty inline">Sin turnos especiales configurados.</p>}
                </div>

                {canManageSpecialSchedules && !customScheduleForm && (
                  <button type="button" className="profiles-secondary" onClick={() => startSpecialSchedule()} disabled={saving}>Agregar turno especial</button>
                )}

                {canManageSpecialSchedules && customScheduleForm && (
                  <div className="profiles-special-form">
                    <div className="profiles-form-grid">
                      <Field label="Tipo de turno">
                        <select value={customScheduleForm.shift_type_id} onChange={(event) => applySpecialShiftType(event.target.value)} required disabled={saving}>
                          <option value="">Selecciona tipo</option>
                          {shiftTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Dia de la semana">
                        <select value={customScheduleForm.weekday} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, weekday: event.target.value })} disabled={saving}>
                          <option value="">Sin dia fijo</option>
                          {WEEKDAY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </Field>
                      <Field label="Fecha especifica"><input type="date" value={customScheduleForm.specific_date} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, specific_date: event.target.value })} disabled={saving} /></Field>
                      <Field label="Fecha de inicio"><input type="date" value={customScheduleForm.start_date} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, start_date: event.target.value })} disabled={saving} /></Field>
                      <Field label="Fecha final"><input type="date" value={customScheduleForm.end_date} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, end_date: event.target.value })} disabled={saving} /></Field>
                      <Field label="Estado">
                        <select value={customScheduleForm.status} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, status: event.target.value })} disabled={saving}>
                          <option value="active">Activo</option>
                          <option value="inactive">Inactivo</option>
                        </select>
                      </Field>
                      <Field label="Hora entrada"><input type="time" value={customScheduleForm.start_time} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, start_time: event.target.value })} disabled={saving} /></Field>
                      <Field label="Hora salida"><input type="time" value={customScheduleForm.end_time} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, end_time: event.target.value })} disabled={saving} /></Field>
                    </div>
                    <Field label="Motivo / nota"><textarea value={customScheduleForm.notes} onChange={(event) => setCustomScheduleForm({ ...customScheduleForm, notes: event.target.value })} disabled={saving} /></Field>
                    <div className="profiles-special-actions">
                      <button type="button" className="profiles-secondary" onClick={() => setCustomScheduleForm(null)} disabled={saving}>Cancelar turno especial</button>
                      <button type="button" className="profiles-primary" onClick={saveSpecialSchedule} disabled={saving}>Guardar turno especial</button>
                    </div>
                  </div>
                )}
              </FormSection>

              <FormSection title="Documentos / imagenes">
                <div className="profiles-form-grid">
                  <Field label="Avatar URL"><input value={form.avatar_url} onChange={(event) => updateField("avatar_url", event.target.value)} disabled={currentIsReadOnly || saving} /></Field>
                </div>
              </FormSection>

              <FormSection title="PIN de marcaje">
                <div className="profiles-attendance-fields">
                  <Field label="Nuevo PIN de 4 digitos">
                    <div className="profiles-pin-field">
                      <input
                        type={showAttendancePin ? "text" : "password"}
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        value={form.attendance_pin}
                        onChange={(event) => {
                          updateField("attendance_pin", event.target.value.replace(/\D/g, "").slice(0, 4))
                          setPinGeneratedAutomatically(false)
                          setPinActionMessage("")
                        }}
                        placeholder={pinConfigured[editingProfile.id] ? "PIN asignado" : "0000"}
                        disabled={!canManageCurrentPin || saving}
                      />
                      <button type="button" className="profiles-secondary" onClick={generateAttendancePin} disabled={!canManageCurrentPin || saving}>
                        Generar PIN unico
                      </button>
                    </div>
                    <div className="profiles-pin-actions">
                      <button type="button" className="profiles-text-action" onClick={() => setShowAttendancePin((visible) => !visible)} disabled={!form.attendance_pin}>
                        {showAttendancePin ? "Ocultar PIN" : "Mostrar PIN"}
                      </button>
                      <button type="button" className="profiles-text-action" onClick={copyAttendancePin} disabled={!form.attendance_pin}>Copiar PIN</button>
                      <button type="button" className="profiles-text-action" onClick={() => {
                        updateField("attendance_pin", "")
                        setPinGeneratedAutomatically(false)
                        setPinActionMessage("No se asignara ni cambiara PIN al guardar.")
                      }} disabled={!form.attendance_pin || saving}>Limpiar PIN</button>
                    </div>
                  </Field>
                  <div className={`profiles-pin-status ${pinConfigured[editingProfile.id] ? "configured" : ""}`}>{pinConfigured[editingProfile.id] ? "Este usuario tiene PIN asignado" : "Este usuario no tiene PIN asignado"}</div>
                </div>
                <p className="profiles-note">Puedes guardar la informacion del usuario sin generar PIN. El PIN solo se asigna o cambia si este campo tiene 4 digitos al presionar Guardar.</p>
                {pinActionMessage && <p className="profiles-pin-feedback" role="status">{pinActionMessage}</p>}
              </FormSection>
            </div>

            <footer className="profiles-modal-actions">
              <div className="profiles-modal-feedback">
                {modalMessage && <span className="profiles-success compact">{modalMessage}</span>}
                {modalError && <span className="profiles-error compact" role="alert">{modalError}</span>}
              </div>
              <button type="button" className="profiles-secondary" onClick={() => setEditingProfile(null)} disabled={saving}>Cancelar</button>
              <button type="submit" className="profiles-primary" disabled={saving || currentIsReadOnly}>{saving ? "Guardando..." : "Guardar"}</button>
            </footer>
          </form>
        </div>
      )}

      {showNewRoleModal && (
        <div className="profiles-modal-overlay">
          <div className="profiles-modal new-role-modal">
            <header className="profiles-modal-header">
              <div>
                <p className="profiles-eyebrow">Nuevo rol</p>
                <h2>Crear rol personalizado</h2>
              </div>
              <button type="button" onClick={closeNewRoleModal} disabled={newRoleCreating}>Cerrar</button>
            </header>

            <div className="profiles-modal-body">
              <FormSection title="Información del rol">
                <div className="profiles-form-grid">
                  <Field label="Nombre del rol *">
                    <input 
                      type="text"
                      value={newRoleForm.role_name}
                      onChange={(e) => setNewRoleForm({ ...newRoleForm, role_name: e.target.value })}
                      placeholder="Ej: Closing Concierge"
                      disabled={newRoleCreating}
                      required
                    />
                  </Field>
                  <Field label="Categoría">
                    <input 
                      type="text"
                      value={newRoleForm.category}
                      onChange={(e) => setNewRoleForm({ ...newRoleForm, category: e.target.value })}
                      placeholder="Ej: Servicio"
                      disabled={newRoleCreating}
                    />
                  </Field>
                  <Field label="Descripción">
                    <textarea 
                      value={newRoleForm.description}
                      onChange={(e) => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
                      placeholder="Descripción opcional del rol"
                      disabled={newRoleCreating}
                      rows="3"
                    />
                  </Field>
                </div>
              </FormSection>

              <div className="profiles-modal-feedback">
                {newRoleError && <span className="profiles-error" role="alert">{newRoleError}</span>}
              </div>
            </div>

            <footer className="profiles-modal-actions">
              <button type="button" className="profiles-secondary" onClick={closeNewRoleModal} disabled={newRoleCreating}>
                Cancelar
              </button>
              <button 
                type="button" 
                className="profiles-primary" 
                onClick={createNewRole} 
                disabled={newRoleCreating || !newRoleForm.role_name.trim()}
              >
                {newRoleCreating ? "Creando..." : "Crear rol"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showNewAreaModal && (
        <div className="profiles-modal-overlay">
          <div className="profiles-modal new-role-modal">
            <header className="profiles-modal-header">
              <div>
                <p className="profiles-eyebrow">Nueva área</p>
                <h2>Crear área operativa</h2>
              </div>
              <button type="button" onClick={closeNewAreaModal} disabled={newAreaCreating}>Cerrar</button>
            </header>

            <div className="profiles-modal-body">
              <FormSection title="Información del área">
                <div className="profiles-form-grid">
                  <Field label="Nombre del área *">
                    <input
                      type="text"
                      value={newAreaForm.name}
                      onChange={(event) => setNewAreaForm({ ...newAreaForm, name: event.target.value })}
                      placeholder="Ej: Terraza, Eventos"
                      disabled={newAreaCreating}
                      required
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      value={newAreaForm.type}
                      onChange={(event) => setNewAreaForm({ ...newAreaForm, type: event.target.value })}
                      disabled={newAreaCreating}
                    >
                      <option value="operativa">Operativa</option>
                      <option value="produccion">Producción</option>
                      <option value="servicio">Servicio</option>
                      <option value="administrativa">Administrativa</option>
                      <option value="limpieza">Limpieza</option>
                    </select>
                  </Field>
                  <Field label="Descripción">
                    <textarea
                      value={newAreaForm.description}
                      onChange={(event) => setNewAreaForm({ ...newAreaForm, description: event.target.value })}
                      placeholder="Descripción opcional del área"
                      disabled={newAreaCreating}
                      rows="3"
                    />
                  </Field>
                </div>
              </FormSection>

              <div className="profiles-modal-feedback">
                {newAreaError && <span className="profiles-error" role="alert">{newAreaError}</span>}
              </div>
            </div>

            <footer className="profiles-modal-actions">
              <button type="button" className="profiles-secondary" onClick={closeNewAreaModal} disabled={newAreaCreating}>
                Cancelar
              </button>
              <button
                type="button"
                className="profiles-primary"
                onClick={createNewArea}
                disabled={newAreaCreating || !newAreaForm.name.trim()}
              >
                {newAreaCreating ? "Creando..." : "Crear área"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="profiles-modal-overlay">
          <form className="profiles-modal create" onSubmit={createUser}>
            <header className="profiles-modal-header"><div><p className="profiles-eyebrow">Nuevo colaborador</p><h2>Crear usuario</h2></div><button type="button" onClick={() => setShowCreate(false)} disabled={creating}>Cerrar</button></header>
            <div className="profiles-modal-body">
              <FormSection title="Datos personales">
                <div className="profiles-form-grid">
                  <Field label="Nombre completo"><input value={createForm.full_name} onChange={(event) => updateCreateField("full_name", event.target.value)} required disabled={creating} /></Field>
                  <Field label="Username"><input value={createForm.username} onChange={(event) => updateCreateField("username", event.target.value)} required disabled={creating} /></Field>
                  <Field label="Correo"><input type="email" value={createForm.email} onChange={(event) => updateCreateField("email", event.target.value)} required disabled={creating} /></Field>
                  <Field label="Contrasena temporal"><input type="password" value={createForm.password} onChange={(event) => updateCreateField("password", event.target.value)} minLength={6} required disabled={creating} /></Field>
                </div>
              </FormSection>
              <FormSection title="Rol y acceso">
                <div className="profiles-form-grid">
                  <Field label="Rol">
                    <div className="profiles-role-select-container">
                      <select value={createForm.role} onChange={(event) => updateCreateField("role", event.target.value)} disabled={creating}>
                        {dynamicRoles
                          .filter((role) => assignableRoles.includes(role.role_key))
                          .map((role) => (
                            <option key={role.role_key} value={role.role_key}>
                              {role.role_name || role.role_key}
                            </option>
                          ))}
                      </select>
                      {canManageRoleCatalog(user) && (
                        <button 
                          type="button" 
                          className="profiles-add-role-btn"
                          onClick={openNewRoleModal}
                          title="Crear un nuevo rol"
                        >
                          + Crear rol
                        </button>
                      )}
                    </div>
                  </Field>
                  <Field label="Estado">
                    <select value={createForm.status} onChange={(event) => updateCreateField("status", event.target.value)} disabled={creating}>
                      {PROFILE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_NAMES[status]}</option>)}
                    </select>
                  </Field>
                </div>
              </FormSection>
              <FormSection title="Horarios / informacion laboral">
                <div className="profiles-form-grid">
                  <Field label="Area">
                    <div className="profiles-role-select-container">
                      <select value={createForm.area_id} onChange={(event) => updateArea(event.target.value, setCreateForm)} disabled={creating}>
                        <option value="">Sin area asignada</option>
                        {areaOptions.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                      </select>
                      {canManageAreaCatalog(user) && (
                        <button
                          type="button"
                          className="profiles-add-role-btn"
                          onClick={openNewAreaModal}
                          disabled={creating}
                          title="Crear un área operativa nueva"
                        >
                          + Crear área
                        </button>
                      )}
                    </div>
                  </Field>
                  <Field label="Employee ID"><input value={createForm.employee_id} onChange={(event) => updateCreateField("employee_id", event.target.value)} disabled={creating} /></Field>
                  <Field label="Telefono"><input value={createForm.phone} onChange={(event) => updateCreateField("phone", event.target.value)} disabled={creating} /></Field>
                </div>
              </FormSection>
            </div>
            <footer className="profiles-modal-actions">
              <div className="profiles-modal-feedback">
                {modalMessage && <span className="profiles-success compact">{modalMessage}</span>}
                {modalError && <span className="profiles-error compact" role="alert">{modalError}</span>}
              </div>
              <button type="button" className="profiles-secondary" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</button>
              <button type="submit" className="profiles-primary" disabled={creating}>{creating ? "Guardando..." : "Guardar"}</button>
            </footer>
          </form>
        </div>
      )}
    </section>
  )
}

function validateProfileForm(values, creating = false) {
  if (!values.full_name.trim() || !values.username.trim() || (creating && !values.email.trim()) || (creating && !values.password)) {
    return "Faltan campos obligatorios."
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return "Faltan campos obligatorios."
  if (creating && values.password.length < 6) return "Faltan campos obligatorios."
  if (values.attendance_pin && !/^\d{4}$/.test(values.attendance_pin)) return "El PIN debe ser de 4 digitos numericos."
  if (values.hourly_rate !== "" && Number(values.hourly_rate) < 0) return "Faltan campos obligatorios."
  return ""
}

function suggestUsername(profile) {
  const emailBase = String(profile.email || "").split("@")[0]
  const nameBase = String(profile.full_name || profile.username || "usuario")
  return normalizeUsername(emailBase || nameBase) || `usuario${String(profile.id || Date.now()).slice(0, 6)}`
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "")
}

function trimTime(value) {
  return String(value || "").slice(0, 5)
}

function emptyCustomSchedule(profileId) {
  return {
    profile_id: profileId || "",
    shift_type_id: "",
    weekday: "",
    specific_date: "",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    notes: "",
    status: "active"
  }
}

function specialScheduleLabel(schedule) {
  const parts = []
  if (schedule.specific_date) parts.push(schedule.specific_date)
  if (schedule.weekday !== null && schedule.weekday !== undefined) {
    parts.push(WEEKDAY_OPTIONS.find(([value]) => Number(value) === Number(schedule.weekday))?.[1] || `Dia ${schedule.weekday}`)
  }
  if (schedule.start_date || schedule.end_date) parts.push(`${schedule.start_date || "Sin inicio"} a ${schedule.end_date || "indefinido"}`)
  if (schedule.start_time || schedule.end_time) parts.push(`${trimTime(schedule.start_time) || "--:--"} - ${trimTime(schedule.end_time) || "--:--"}`)
  return parts.length ? parts.join(" · ") : "Sin vigencia definida"
}

function databaseError(error) {
  const text = String(error?.message || "")
  const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ")
  if (text.includes("profiles_username_key") || text.toLowerCase().includes("duplicate key")) {
    return "Este nombre de usuario ya esta en uso. Por favor utiliza uno diferente."
  }
  if (text.toLowerCase().includes("asignar este rol")) return "No tienes permisos para asignar este rol."
  if (text.toLowerCase().includes("permission") || text.toLowerCase().includes("permiso")) return "No tienes permisos para editar este usuario."
  return details ? `Error al guardar en la base de datos: ${details}` : "Error al guardar en la base de datos."
}

function FormSection({ title, children }) {
  return <section className="profiles-form-section"><h3>{title}</h3>{children}</section>
}

function Field({ label, children }) {
  return <label className="profiles-field"><span>{label}</span>{children}</label>
}

function Badge({ type, value }) {
  const label = type === "status" ? STATUS_NAMES[value] : ROLE_NAMES[value]
  return <span className={`profiles-badge ${type}-${value}`}>{label || value}</span>
}

function initials(name) {
  return String(name || "U").split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
}

export default ProfileManagement
