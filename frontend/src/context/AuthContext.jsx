/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"

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
  settings: "/settings"
}

const ROLE_PERMISSIONS = {
  admin: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "settings"],
  ceo: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "settings"],
  gerente_general: ["dashboard", "inventory", "pos", "cash", "production", "hr", "tasks", "reports", "settings"],
  gerente: ["dashboard", "inventory", "hr", "tasks"],
  encargado_almacen: ["inventory"],
  rrhh: ["inventory", "hr", "tasks"],
  recursos_humanos: ["inventory", "hr", "tasks"],
  supervisor: ["dashboard", "pos", "cash", "production", "hr", "tasks", "inventory", "reports"],
  cajero: ["pos", "cash", "hr"],
  caja: ["pos", "cash", "hr"],
  mesero: ["pos", "hr"],
  cocinero: ["inventory", "production", "hr"],
  cocina: ["inventory", "production", "hr"],
  encargado_area: ["inventory", "production", "hr"],
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
  colaborador: ["hr"]
}

const LEGACY_ROLE_NAMES = {
  admin: "Administrador",
  ceo: "CEO",
  gerente_general: "Gerente General",
  gerente: "Gerente",
  encargado_almacen: "Encargado de Almacén",
  rrhh: "Recursos Humanos",
  recursos_humanos: "Recursos Humanos",
  supervisor: "Supervisor",
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
  colaborador: "Colaborador"
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

function normalizeRole(role) {
  const normalized = String(role || "colaborador")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
  const aliases = {
    "rr.hh.": "recursos_humanos",
    "rr._hh.": "recursos_humanos",
    rrhh: "recursos_humanos",
    recursos_humanos: "recursos_humanos",
    "gerente_general": "gerente_general",
    encargado_almacen: "encargado_almacen",
    encargado_de_almacen: "encargado_almacen",
    cajero: "caja",
    caja: "caja",
    cocinero: "cocina",
    cocina: "cocina",
    pizzero: "pizzeria",
    pizzeria: "pizzeria"
  }
  const roleKey = aliases[normalized] || normalized
  return ROLE_PERMISSIONS[roleKey] ? roleKey : "colaborador"
}

export function normalizeProfileToCurrentUser(profile, sessionUser) {
  if (!profile || !sessionUser) return null
  const role = normalizeRole(profile.role)
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
  if (message.includes("failed to fetch") || message.includes("network")) return "No fue posible conectar con el servicio de autenticación."
  return "No se pudo iniciar sesión. Intenta nuevamente."
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [profileError, setProfileError] = useState(isSupabaseConfigured ? "" : "Supabase no está configurado. Revisa las variables de entorno.")

  const loadProfileForSession = useCallback(async (activeSession) => {
    setSession(activeSession || null)
    if (!activeSession?.user) {
      setProfile(null)
      setUser(null)
      setProfileError("")
      syncLegacyUser(null)
      return { ok: true, user: null, profile: null }
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", activeSession.user.id)
      .maybeSingle()

    if (error) {
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
    setProfile(data)
    setUser(currentUser)
    setProfileError("")
    syncLegacyUser(currentUser)
    return { ok: true, user: currentUser, profile: data }
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setTimeout(async () => {
        if (!mounted) return
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
      login,
      logout,
      refreshProfile,
      changePassword,
      changeOwnPassword,
      updateOwnProfile,
      canAccess,
      getDefaultPath,
      modules: MODULES
    }
  }, [changeOwnPassword, changePassword, loading, login, logout, profile, profileError, refreshProfile, session, updateOwnProfile, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return context
}
