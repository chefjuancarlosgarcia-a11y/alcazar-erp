import { useState, useCallback, useRef } from "react"

export function useToast() {
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  const showToast = useCallback((message, type = "info", duration = 2000) => {
    const id = toastIdRef.current++
    const toast = { id, message, type }

    setToasts((prev) => [...prev, toast])

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }

    return id
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, showToast, dismissToast }
}
