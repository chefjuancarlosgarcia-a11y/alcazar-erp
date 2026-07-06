/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "../lib/supabase"
import { normalizeRole as normalizeProfileRoleKey } from "../utils/profilePermissions"
import { describeSupabaseError } from "../services/supabaseConnectivity"
import {
  logProfileLoadOutcome,
  logSupabaseQueryAttempt,
  logSupabaseQueryFailure
} from "../utils/authProfileDiagnostics"

const isSupabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

const MODULES = {
  dashboard: "/dashboard",
  inventory: "/inventory",
  pos: "/pos",
  cash: "/cash",
  production: "/production",
  hr: "/hr",
  tasks: "/tasks",
  reports: "/reports",
  catering: "/catering",
  finance: "/finance",
  settings: "/settings",
  operations_center: "/operations-center",
  bakery: "/bakery"
}

const ROLE_PERMISSIONS = {
  admin: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "finance", "settings", "operations_center", "bakery"],
  ceo: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "settings"],
  gerente_general: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "catering", "finance", "settings", "operations_center", "bakery"],
  gerente: ["dashboard", "inventory", "hr", "tasks", "bakery"],
  gerente_operaciones: ["pos", "production", "hr", "catering"],
  encargado_almacen: ["inventory"],
  rrhh: ["inventory", "hr", "tasks"],
  recursos_humanos: ["inventory", "hr", "tasks"],
  supervisor: ["dashboard", "pos", "cash", "production", "hr", "tasks", "inventory", "reports"],
  ventas: ["tasks"],
  cajero: ["pos", "cash", "hr"],
  caja: ["pos", "cash", "hr"],
  mesero: ["pos", "hr"],
  cocinero: ["inventory", "production", "hr"],
  cocina: ["inventory", "production", "hr"],
  encargado_area: ["inventory", "production", "hr", "tasks"],
  barista: ["production", "hr"],
  bartender: ["production", "hr"],
  pizzero: ["production", "hr"],
  pizzeria: ["production", "hr"],
  repostero: ["production", "hr"],
  panadero: ["production", "hr"],
  servicio: ["pos", "hr"],
  cafeteria: ["production", "hr"],
  limpieza: ["hr", "tasks"],
  operativo: ["hr"],
  mantenimiento: ["hr", "tasks"],
  repartidor: ["hr"],
  colaborador: ["hr"],
  contador: ["dashboard", "finance"],
  supervisor_panaderia: ["bakery", "hr"]
}

const LEGACY_ROLE_NAMES = {
  admin: "Administrador",
  ceo: "CEO",
  gerente_general: "Gerente General",
  gerente: "Gerente",
  gerente_operaciones: "Gerente de Operaciones",
  encargado_almacen: "Encargado de Almacén",
  rrhh: "Recursos Humanos",
  recursos_humanos: "Recursos Humanos",
  supervisor: "Supervisor",
  ventas: "Ventas",
  cajero: "Cajero",
  caja: "Caja",
  mesero: "FOH",
  cocinero: "Cocina",
  cocina: "Cocina",
  encargado_area: "Encargado de Área",
  barista: "Barista",
  bartender: "Bartender",
  pizzero: "Pizzero",
  pizzeria: "Pizzero",
  repostero: "Repostero",
  panadero: "Panadero",
  servicio: "Servicio",
  cafeteria: "Cafetería",
  limpieza: "Limpieza",
  operativo: "Operativo",
  mantenimiento: "Mantenimiento",
  repartidor: "Repartidor",
  colaborador: "Colaborador",
  contador: "Contador",
  supervisor_panaderia: "Supervisor Panadería"
}

const AuthContext = createContext(null)

const LEGACY_USER_STORAGE_KEYS = [
  "users",
  "usuarios",
  "users_backup",
  "usuarios_backup",
  "profiles_backup",
  "usersRecoveryAppliedLocalhost5173",
  "accessRecoveryRequests"
]

function cleanupLegacyUserStorage() {
  LEGACY_USER_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
}

function resolveAuthRole(role) {
  const normalized = normalizeProfileRoleKey(role)
  return ROLE_PERMISSIONS[normalized] ? normalized : "colaborador"
}

export function normalizeProfileToCurrentUser(profile, sessionUser) {
  if (!profile || !sessionUser) return null
  const role = resolveAuthRole(profile.role)
  return {
    id: profile.id,
    username: profile.username || sessionUser.email?.split("@")[0] || "",
    name: profile.full_name || sessionUser.user_metadata?.full_name || sessionUser.email || "Usuario",
    email: profile.email || sessionUser.email || "",
    avatar: profile.avatar_url || "",
    phone: profile.phone || "",
    role,
    legacyRole: LEGACY_ROLE_NAMES[role] || "Colaborador",
    areaId: profile.area_id || "",
    areaName: profile.area_name || "",
    area_name: profile.area_name || "",
    employeeId: profile.employee_id || "",
    status: profile.status || "active",
    permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.colaborador,
    auth: {
      isOnline: true,
      lastLogin: sessionUser.last_sign_in_at || null
    }
  }
}

function syncLegacyUser(user) {
  cleanupLegacyUserStorage()
  localStorage.removeItem("authUser")
  if (!user) {
    localStorage.removeItem("usuarioActual")
    return
  }
  // Temporary bridge while Inventario/RRHH remain on their local data model.
  localStorage.setItem("usuarioActual", JSON.stringify({
    id: user.id,
    username: user.username,
    nombre: user.name,
    rol: user.legacyRole,
    departamento: user.areaName || user.areaId || ""
  }))
}

function friendlyAuthError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!isSupabaseConfigured) return "Supabase no está configurado. Revisa las variables de entorno."
  if (message.includes("invalid api key")) return "La clave pública de Supabase no es válida para este proyecto. Revisa VITE_SUPABASE_ANON_KEY."
  if (error?.status === 401) return "Credenciales incorrectas o contraseña inválida."
  if (message.includes("email not confirmed")) return "Confirma tu correo electrónico antes de ingresar."
  const described = describeSupabaseError(error, "Autenticación de Supabase", { fromAuth: true })
  if (described.isApiKeyMismatch) return described.userMessage
  if (described.isNetwork) return described.userMessage
  if (message.includes("failed to fetch") || message.includes("network")) return "No fue posible conectar con el servicio de autenticación."
  return "No se pudo iniciar sesión. Intenta nuevamente."
}

const CHECKLIST_MODULE_ROLES = new Set(["supervisor", "encargado_area"])

async function probeChecklistModuleAccess(currentUser) {
  if (!currentUser?.id) return false
  if (currentUser.permissions?.includes("tasks")) return true
  const role = normalizeProfileRoleKey(currentUser.role)
  if (CHECKLIST_MODULE_ROLES.has(role)) return true
  const { data, error } = await supabase
    .from("checklist_runs")
    .select("id")
    .neq("status", "cancelled")
    .or(`assigned_profile_id.eq.${currentUser.id},supervisor_profile_id.eq.${currentUser.id}`)
    .limit(1)
  if (error) {
    console.warn("[Auth] No se pudo evaluar acceso a checklists.", error)
    return false
  }
  return Boolean(data?.length)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [user, setUser] = useState(null)
  const [checklistModuleAccess, setChecklistModuleAccess] = useState(false)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [profileError, setProfileError] = useState(isSupabaseConfigured ? "" : "Supabase no está configurado. Revisa las variables de entorno.")
  const userRef = useRef(null)
  const profileRef = useRef(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  const loadProfileForSession = useCallback(async (activeSession) => {
    const sessionUserId = activeSession?.user?.id || null
    const sessionEmail = activeSession?.user?.email || null
    setSession(activeSession || null)
    if (!sessionUserId) {
      setProfile(null)
      setUser(null)
      setChecklistModuleAccess(false)
      setProfileError("")
      syncLegacyUser(null)
      return { ok: true, user: null, profile: null }
    }

    const profileQuery = 'from("profiles").select("*").eq("id", sessionUserId).maybeSingle()'
    logSupabaseQueryAttempt({
      sourceFunction: "AuthContext.loadProfileForSession",
      table: "profiles",
      queryDescription: profileQuery,
      authUserId: sessionUserId,
      authEmail: sessionEmail
    })

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", sessionUserId)
      .maybeSingle()

    if (error) {
      logSupabaseQueryFailure({
        sourceFunction: "AuthContext.loadProfileForSession",
        table: "profiles",
        queryDescription: profileQuery,
        authUserId: sessionUserId,
        authEmail: sessionEmail,
        sessionPresent: Boolean(activeSession?.access_token),
        error
      })
      if (userRef.current?.id === sessionUserId && profileRef.current) {
        console.warn("Profile reload failed; keeping current session.", error)
        setSession(activeSession)
        setProfileError("")
        return { ok: true, user: userRef.current, profile: profileRef.current }
      }
      logProfileLoadOutcome({
        sourceFunction: "AuthContext.loadProfileForSession",
        authUserId: sessionUserId,
        authEmail: sessionEmail,
        outcome: "error_shown_to_user",
        error
      })
      setProfile(null)
      setUser(null)
      setProfileError("No se pudo cargar tu perfil. Contacta administración.")
      syncLegacyUser(null)
      window.dispatchEvent(new CustomEvent("auth:session-interrupted", {
        detail: { reason: "profile_load_failed", message: error.message || "profile_query_error" }
      }))
      return { ok: false, message: "No se pudo cargar tu perfil. Contacta administración." }
    }
    if (!data) {
      logProfileLoadOutcome({
        sourceFunction: "AuthContext.loadProfileForSession",
        authUserId: sessionUserId,
        authEmail: sessionEmail,
        outcome: "missing_row"
      })
      setProfile(null)
      setUser(null)
      setProfileError("Tu usuario no tiene perfil configurado. Contacta administración.")
      syncLegacyUser(null)
      window.dispatchEvent(new CustomEvent("auth:session-interrupted", {
        detail: { reason: "profile_missing", message: "profile_not_found" }
      }))
      return { ok: false, message: "Tu usuario no tiene perfil configurado. Contacta administración." }
    }
    if (["inactive", "suspended"].includes(String(data.status || "").toLowerCase())) {
      setProfile(data)
      setUser(null)
      setProfileError("Tu usuario está inactivo o suspendido. Contacta administración.")
      window.dispatchEvent(new CustomEvent("auth:session-interrupted", {
        detail: { reason: "profile_inactive", message: data.status || "inactive" }
      }))
      await supabase.auth.signOut({ scope: "local" })
      syncLegacyUser(null)
      return { ok: false, message: "Tu usuario está inactivo o suspendido. Contacta administración." }
    }

    const currentUser = normalizeProfileToCurrentUser(data, activeSession.user)
    const hasChecklistAccess = await probeChecklistModuleAccess(currentUser)
    logProfileLoadOutcome({
      sourceFunction: "AuthContext.loadProfileForSession",
      authUserId: sessionUserId,
      authEmail: sessionEmail,
      outcome: "success",
      profileId: data.id,
      profileStatus: data.status
    })
    setProfile(data)
    setUser(currentUser)
    setChecklistModuleAccess(hasChecklistAccess)
    setProfileError("")
    syncLegacyUser(currentUser)
    return { ok: true, user: currentUser, profile: data }
  }, [])

  const refreshChecklistModuleAccess = useCallback(async (currentUser = userRef.current) => {
    const hasChecklistAccess = await probeChecklistModuleAccess(currentUser)
    setChecklistModuleAccess(hasChecklistAccess)
    return hasChecklistAccess
  }, [])

  useEffect(() => {
    let mounted = true
    if (!isSupabaseConfigured || !supabase) {
      syncLegacyUser(null)
      return undefined
    }

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return
      if (error) {
        setProfileError("No fue posible recuperar la sesión.")
        window.dispatchEvent(new CustomEvent("auth:session-interrupted", {
          detail: { reason: "session_recovery_failed", message: error.message || "getSession_error" }
        }))
        setLoading(false)
        return
      }
      await loadProfileForSession(data.session)
      if (mounted) setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setTimeout(async () => {
        if (!mounted) return
        if (["TOKEN_REFRESHED", "USER_UPDATED"].includes(event) && nextSession?.user?.id && nextSession.user.id === userRef.current?.id) {
          setSession(nextSession)
          return
        }
        await loadProfileForSession(nextSession)
        if (mounted) setLoading(false)
      }, 0)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [loadProfileForSession])

  const refreshProfile = useCallback(async () => {
    if (!session) return { ok: false, message: "No existe una sesión activa." }
    return loadProfileForSession(session)
  }, [loadProfileForSession, session])

  const login = useCallback(async (email, password) => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, message: "Supabase no está configurado. Revisa las variables de entorno." }
    }
    // TODO: Resolver ingreso por username mediante una funcion segura en backend.
    const credentials = {
      email: email.trim().toLowerCase(),
      password: password
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword(credentials)
      if (error) {
        console.error("Supabase login error:", {
          message: error?.message,
          status: error?.status,
          name: error?.name,
          fullError: error
        })
        return { ok: false, message: friendlyAuthError(error), error }
      }
      const result = await loadProfileForSession(data.session)
      return result
    } catch (error) {
      const described = describeSupabaseError(error, "Autenticación de Supabase", { fromAuth: true })
      console.error("Supabase login exception:", described.technical || error)
      return { ok: false, message: described.userMessage, error }
    }
  }, [loadProfileForSession])

  const logout = useCallback(async (reason = "manual_logout") => {
    window.dispatchEvent(new CustomEvent("auth:session-interrupted", {
      detail: { reason }
    }))
    if (supabase) await supabase.auth.signOut({ scope: "local" })
    setSession(null)
    setProfile(null)
    setUser(null)
    setProfileError("")
    syncLegacyUser(null)
  }, [])

  const changePassword = useCallback(async (newPassword) => {
    if (!supabase || !session) return { ok: false, message: "No existe una sesión activa." }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, message: "No se pudo actualizar la contraseña." }
    return { ok: true, user }
  }, [session, user])

  const changeOwnPassword = useCallback(async (currentPassword, newPassword) => {
    if (!supabase || !session?.user?.email) return { ok: false, message: "No existe una sesión activa." }
    const { error: verificationError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword
    })
    if (verificationError) return { ok: false, message: "La contraseña actual no es correcta." }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, message: "No se pudo actualizar la contraseña." }
    // TODO: Registrar security_events en backend cuando se migre el historial de RRHH.
    return { ok: true, user }
  }, [session, user])

  const updateOwnProfile = useCallback(async (changes) => {
    if (!supabase || !session?.user) return { ok: false, message: "No existe una sesión activa." }
    const personalUpdate = {
      email: String(changes.correo || "").trim() || null,
      phone: String(changes.telefono || "").trim() || null,
      avatar_url: changes.fotoColaborador || null,
      updated_at: new Date().toISOString()
    }
    const { data, error } = await supabase
      .from("profiles")
      .update(personalUpdate)
      .eq("id", session.user.id)
      .select("*")
      .single()
    if (error) return { ok: false, message: "No se pudo actualizar tu información personal." }
    const currentUser = normalizeProfileToCurrentUser(data, session.user)
    setProfile(data)
    setUser(currentUser)
    syncLegacyUser(currentUser)
    return { ok: true, user: currentUser }
  }, [session])

  const value = useMemo(() => {
    function canAccess(module) {
      if (module === "tasks" && checklistModuleAccess) return true
      return Boolean(user?.permissions?.includes(module))
    }
    function getDefaultPath(currentUser = user) {
      const firstPermission = currentUser?.permissions?.[0]
      return firstPermission ? MODULES[firstPermission] : "/account"
    }
    return {
      user,
      currentUser: user,
      session,
      profile,
      loading,
      profileError,
      isAuthenticated: Boolean(session && user),
      checklistModuleAccess,
      login,
      logout,
      refreshProfile,
      refreshChecklistModuleAccess,
      changePassword,
      changeOwnPassword,
      updateOwnProfile,
      canAccess,
      getDefaultPath,
      modules: MODULES
    }
  }, [changeOwnPassword, changePassword, checklistModuleAccess, loading, login, logout, profile, profileError, refreshChecklistModuleAccess, refreshProfile, session, updateOwnProfile, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return context
}
