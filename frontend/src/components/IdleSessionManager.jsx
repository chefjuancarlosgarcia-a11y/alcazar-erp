import { useCallback, useEffect, useRef, useState } from "react"
import { IDLE_ACTIVITY_EVENTS, IDLE_WARNING_SECONDS, getSessionTimeoutMinutes } from "../config/sessionTimeouts"
import { useAuth } from "../context/AuthContext"
import "./IdleSessionManager.css"

const AUTO_LOGOUT_MESSAGE = "Sesión cerrada automáticamente por seguridad."

function IdleSessionManager() {
  const { user, session, logout } = useAuth()
  const [warningOpen, setWarningOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(IDLE_WARNING_SECONDS)
  const warningTimerRef = useRef(null)
  const logoutTimerRef = useRef(null)
  const countdownRef = useRef(null)
  const warningOpenRef = useRef(false)

  const clearTimers = useCallback(() => {
    window.clearTimeout(warningTimerRef.current)
    window.clearTimeout(logoutTimerRef.current)
    window.clearInterval(countdownRef.current)
  }, [])

  const performLogout = useCallback(async () => {
    clearTimers()
    setWarningOpen(false)
    sessionStorage.setItem("auth:autoLogoutMessage", AUTO_LOGOUT_MESSAGE)
    await logout()
  }, [clearTimers, logout])

  const startTimers = useCallback(() => {
    clearTimers()
    if (!session || !user) return

    const timeoutMs = getSessionTimeoutMinutes(user.role) * 60 * 1000
    const warningMs = Math.max(0, timeoutMs - IDLE_WARNING_SECONDS * 1000)

    warningOpenRef.current = false
    setWarningOpen(false)
    setSecondsLeft(IDLE_WARNING_SECONDS)

    warningTimerRef.current = window.setTimeout(() => {
      warningOpenRef.current = true
      setWarningOpen(true)
      setSecondsLeft(IDLE_WARNING_SECONDS)
      countdownRef.current = window.setInterval(() => {
        setSecondsLeft((current) => Math.max(0, current - 1))
      }, 1000)
    }, warningMs)

    logoutTimerRef.current = window.setTimeout(() => {
      performLogout()
    }, timeoutMs)
  }, [clearTimers, performLogout, session, user])

  useEffect(() => {
    if (!session || !user) {
      clearTimers()
      setWarningOpen(false)
      return undefined
    }

    const handleActivity = () => {
      if (warningOpenRef.current) return
      startTimers()
    }

    IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true })
    })
    startTimers()

    return () => {
      IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity)
      })
      clearTimers()
    }
  }, [clearTimers, session, startTimers, user])

  function continueSession() {
    warningOpenRef.current = false
    startTimers()
  }

  if (!warningOpen) return null

  return (
    <div className="idle-session-overlay" role="alertdialog" aria-modal="true" aria-labelledby="idle-session-title">
      <div className="idle-session-modal">
        <h2 id="idle-session-title">Sesión inactiva</h2>
        <p>Tu sesión se cerrará en {secondsLeft} segundos por inactividad. ¿Deseas continuar?</p>
        <div className="idle-session-actions">
          <button type="button" className="idle-session-primary" onClick={continueSession}>Seguir conectado</button>
          <button type="button" className="idle-session-secondary" onClick={performLogout}>Cerrar sesión</button>
        </div>
      </div>
    </div>
  )
}

export default IdleSessionManager
