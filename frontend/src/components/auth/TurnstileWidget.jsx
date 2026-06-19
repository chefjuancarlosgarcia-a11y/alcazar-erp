import { useEffect, useRef } from "react"

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script"
const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

function loadTurnstileScript() {
  if (typeof document === "undefined") return Promise.reject(new Error("Documento no disponible."))
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID)
  if (existing && window.turnstile) return Promise.resolve(window.turnstile)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(window.turnstile))
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar Turnstile.")))
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.id = TURNSTILE_SCRIPT_ID
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error("No se pudo cargar Turnstile."))
    document.head.appendChild(script)
  })
}

export default function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onError,
  resetKey = 0
}) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined

    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return
        if (widgetIdRef.current != null) {
          turnstile.remove(widgetIdRef.current)
          widgetIdRef.current = null
        }
        containerRef.current.innerHTML = ""
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (token) => onVerify?.(token),
          "expired-callback": () => onExpire?.(),
          "error-callback": () => onError?.("No se pudo completar la verificacion.")
        })
      })
      .catch((error) => onError?.(error.message))

    return () => {
      cancelled = true
      if (widgetIdRef.current != null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey, resetKey, onVerify, onExpire, onError])

  if (!siteKey) {
    return (
      <p className="login-captcha-hint">
        CAPTCHA no configurado. Define VITE_TURNSTILE_SITE_KEY para habilitar verificacion progresiva.
      </p>
    )
  }

  return <div ref={containerRef} className="login-turnstile" aria-label="Verificacion de seguridad" />
}
