import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "../lib/supabase"
import {
  claimStationEnrollment,
  clearDeviceClaimSecret,
  completeStationEnrollment,
  loadDeviceClaimSecret,
  pollStationEnrollmentStatus,
  saveDeviceClaimSecret
} from "../services/operationalStationsService"
import "./OperationalStationsSettings.css"

const FINGERPRINT_KEY = "operationalStationClientFingerprint"

function getFingerprint() {
  if (typeof localStorage === "undefined") return `fp-${crypto.randomUUID()}`
  const existing = localStorage.getItem(FINGERPRINT_KEY)
  if (existing) return existing
  const created = `fp-${crypto.randomUUID()}`
  localStorage.setItem(FINGERPRINT_KEY, created)
  return created
}

function readAndClearTokenFromFragment() {
  if (typeof window === "undefined") return ""
  const hash = window.location.hash.replace(/^#/, "")
  const params = new URLSearchParams(hash)
  const token = params.get("token") || ""
  if (token) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
  }
  return token
}

function clearClaimSession(enrollmentId, deviceId) {
  if (enrollmentId && deviceId) clearDeviceClaimSecret(enrollmentId, deviceId)
}

export default function StationEnroll() {
  const [phase, setPhase] = useState("idle")
  const [confirmationCode, setConfirmationCode] = useState("")
  const [enrollmentId, setEnrollmentId] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [stationLabel, setStationLabel] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [manualToken, setManualToken] = useState("")
  const [autoTokenReady, setAutoTokenReady] = useState(false)
  const fingerprint = useMemo(() => getFingerprint(), [])
  const completeKeyRef = useRef(`complete-${crypto.randomUUID()}`)
  const pendingTokenRef = useRef("")

  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "referrer"
    meta.content = "no-referrer"
    document.head.appendChild(meta)
    return () => {
      document.head.removeChild(meta)
    }
  }, [])

  useEffect(() => {
    pendingTokenRef.current = readAndClearTokenFromFragment()
    if (pendingTokenRef.current) {
      setAutoTokenReady(true)
      setPhase("ready")
    }
  }, [])

  async function handleClaim(event) {
    event.preventDefault()
    setError("")
    const token = (pendingTokenRef.current || manualToken).trim()
    pendingTokenRef.current = ""
    setManualToken("")
    setAutoTokenReady(false)
    if (!token) return setError("Solicitud invalida.")
    setPhase("claiming")
    const { data: body, error: fnError } = await claimStationEnrollment({
      token,
      fingerprint,
      userAgent: navigator.userAgent
    })
    if (fnError || body?.error) {
      setPhase("idle")
      return setError("Solicitud invalida.")
    }
    const nextEnrollmentId = body.enrollment_id
    const nextDeviceId = body.device_id
    if (body.device_claim_secret) {
      saveDeviceClaimSecret(nextEnrollmentId, nextDeviceId, body.device_claim_secret)
    }
    setEnrollmentId(nextEnrollmentId)
    setDeviceId(nextDeviceId)
    setConfirmationCode(body.confirmation_code || "")
    setPhase("waiting")
    setMessage("Esperando autorización del administrador. Código visible para confirmación:")
  }

  useEffect(() => {
    if (phase !== "waiting" || !enrollmentId || !deviceId) return undefined
    let completeStarted = false
    const timer = window.setInterval(async () => {
      const deviceClaimSecret = loadDeviceClaimSecret(enrollmentId, deviceId)
      if (!deviceClaimSecret) {
        setError("Solicitud invalida.")
        setPhase("idle")
        window.clearInterval(timer)
        return
      }
      const { data: statusBody, error: statusError } = await pollStationEnrollmentStatus({
        deviceId,
        enrollmentId,
        deviceClaimSecret
      })
      if (statusError || statusBody?.error) return
      if (
        statusBody.status === "blocked" ||
        statusBody.status === "failed" ||
        statusBody.status === "expired"
      ) {
        clearClaimSession(enrollmentId, deviceId)
        setError("Solicitud invalida.")
        setPhase("idle")
        window.clearInterval(timer)
        return
      }
      if (statusBody.status !== "authorized" || completeStarted) return
      completeStarted = true
      const { data: body, error: fnError } = await completeStationEnrollment({
        enrollmentId,
        deviceId,
        deviceClaimSecret,
        idempotencyKey: completeKeyRef.current
      })
      if (fnError || body?.error || !body?.access_token) {
        completeStarted = false
        return
      }
      clearClaimSession(enrollmentId, deviceId)
      await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token
      })
      setPhase("done")
      setStationLabel("Dispositivo autorizado")
      setMessage("Sesión técnica establecida. No abra POS/KDS/Caja hasta fases posteriores.")
      window.clearInterval(timer)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [phase, enrollmentId, deviceId])

  return (
    <main className="operational-stations-enroll-page erp-page-shell">
      <h1>Enrollment de estación</h1>
      {(phase === "idle" || phase === "ready") && (
        <form onSubmit={handleClaim}>
          {phase === "ready" && autoTokenReady && !manualToken ? (
            <p className="operational-stations-muted">Token detectado. Pulse reclamar para continuar.</p>
          ) : (
            <label>
              Token de enrollment
              <input
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                required={!autoTokenReady}
              />
            </label>
          )}
          <button type="submit" className="operational-stations-primary">Reclamar</button>
        </form>
      )}
      {phase === "waiting" && (
        <div>
          <p>{message}</p>
          <p className="operational-stations-code">{confirmationCode}</p>
          <p className="operational-stations-muted">No cierre esta pestaña hasta ver autorización.</p>
        </div>
      )}
      {phase === "done" && (
        <div>
          <h2>{stationLabel}</h2>
          <p>{message}</p>
        </div>
      )}
      {error && <p className="operational-stations-error">{error}</p>}
    </main>
  )
}
