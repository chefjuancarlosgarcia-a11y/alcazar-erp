import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const DEFAULT_SETTINGS = {
  soundEnabled: true,
  volume: 0.55,
  soundType: "default"
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null")
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback
  } catch {
    return fallback
  }
}

function toneFor(type, scope) {
  if (type === "bar") return [740, 980]
  if (type === "cashier" || scope?.startsWith("cashier")) return [520, 760]
  return [660, 880]
}

export default function useOperationalAlerts({
  scope,
  items = [],
  repeatItems = [],
  repeatIntervalMs = 0,
  enabled = true,
  getId = (item) => item?.id,
  getAlert = (item) => ({ title: "Nueva alerta", message: item?.name || "" }),
  getRepeatAlert
}) {
  const settingsKey = `operational-alert-settings:${scope}`
  const seenKey = `operational-alert-seen:${scope}`
  const [settings, setSettingsState] = useState(() => readJson(settingsKey, DEFAULT_SETTINGS))
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [toasts, setToasts] = useState([])
  const [highlightedIds, setHighlightedIds] = useState(() => new Set())
  const initializedRef = useRef(false)
  const seenRef = useRef(new Set())
  const audioRef = useRef(null)
  const getAlertRef = useRef(getAlert)
  const getRepeatAlertRef = useRef(getRepeatAlert)

  useEffect(() => {
    getAlertRef.current = getAlert
  }, [getAlert])

  useEffect(() => {
    getRepeatAlertRef.current = getRepeatAlert
  }, [getRepeatAlert])

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(settings))
  }, [settings, settingsKey])

  const setSettings = useCallback((next) => {
    setSettingsState((current) => ({ ...current, ...(typeof next === "function" ? next(current) : next) }))
  }, [])

  const playSound = useCallback((overrideType = "") => {
    if (!settings.soundEnabled && overrideType !== "test") return false
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return false
      const context = audioRef.current || new AudioContextClass()
      audioRef.current = context
      if (context.state === "suspended") context.resume()
      const gain = context.createGain()
      gain.gain.value = Math.max(0, Math.min(1, Number(settings.volume ?? 0.55))) * 0.14
      gain.connect(context.destination)
      const tones = toneFor(overrideType || settings.soundType, scope)
      tones.forEach((frequency, index) => {
        const oscillator = context.createOscillator()
        oscillator.type = "sine"
        oscillator.frequency.value = frequency
        oscillator.connect(gain)
        oscillator.start(context.currentTime + index * 0.13)
        oscillator.stop(context.currentTime + index * 0.13 + 0.11)
      })
      return true
    } catch (error) {
      console.warn("[OperationalAlerts] No se pudo reproducir sonido.", error)
      return false
    }
  }, [scope, settings.soundEnabled, settings.soundType, settings.volume])

  const activateSound = useCallback(async () => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (AudioContextClass) {
        const context = audioRef.current || new AudioContextClass()
        audioRef.current = context
        await context.resume()
      }
      setAudioUnlocked(true)
      setSettings({ soundEnabled: true })
      window.setTimeout(() => playSound("test"), 50)
      return true
    } catch (error) {
      console.warn("[OperationalAlerts] El navegador bloqueó el sonido.", error)
      return false
    }
  }, [playSound, setSettings])

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const triggerAlert = useCallback((item) => {
    const id = String(getId(item) || "")
    if (!id) return
    const alert = getAlertRef.current(item)
    const toast = {
      id: `${id}-${Date.now()}`,
      itemId: id,
      title: alert.title,
      message: alert.message,
      icon: alert.icon || "!",
      actionLabel: alert.actionLabel || "Ver",
      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      onView: alert.onView
    }
    setToasts((current) => [toast, ...current].slice(0, 4))
    setHighlightedIds((current) => new Set([...current, id]))
    window.setTimeout(() => {
      setHighlightedIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }, 10000)
    window.setTimeout(() => dismissToast(toast.id), 7000)
    playSound(alert.soundType)
    if (document.hidden) document.title = `(${toasts.length + 1}) ${alert.title}`
  }, [dismissToast, getId, playSound, toasts.length])

  useEffect(() => {
    if (!enabled) return
    const ids = items.map((item) => String(getId(item) || "")).filter(Boolean)
    if (!initializedRef.current) {
      const stored = readJson(seenKey, { ids: [] })
      seenRef.current = new Set([...ids, ...(stored.ids || [])])
      initializedRef.current = true
      localStorage.setItem(seenKey, JSON.stringify({ ids: Array.from(seenRef.current).slice(0, 200) }))
      return
    }
    items.forEach((item) => {
      const id = String(getId(item) || "")
      if (!id || seenRef.current.has(id)) return
      seenRef.current.add(id)
      triggerAlert(item)
    })
    localStorage.setItem(seenKey, JSON.stringify({ ids: Array.from(seenRef.current).slice(-200) }))
  }, [enabled, getId, items, seenKey, triggerAlert])

  useEffect(() => {
    if (!enabled || !repeatIntervalMs || !repeatItems.length) return undefined
    function remind() {
      const activeItems = repeatItems.filter((item) => String(getId(item) || ""))
      if (!activeItems.length) return
      const first = activeItems[0]
      const id = String(getId(first))
      const alert = getRepeatAlertRef.current?.(activeItems) || getAlertRef.current(first)
      const toastId = `reminder-${id}`
      setToasts((current) => {
        const nextToast = {
          id: toastId,
          itemId: id,
          title: alert.title,
          message: alert.message,
          icon: alert.icon || "!",
          actionLabel: alert.actionLabel || "Ver",
          createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          onView: alert.onView
        }
        return [nextToast, ...current.filter((toast) => toast.id !== toastId)].slice(0, 4)
      })
      setHighlightedIds((current) => new Set([...current, ...activeItems.map((item) => String(getId(item)))]))
      playSound(alert.soundType)
    }
    const initialReminder = window.setTimeout(remind, Math.min(2500, repeatIntervalMs))
    const interval = window.setInterval(remind, repeatIntervalMs)
    return () => {
      window.clearTimeout(initialReminder)
      window.clearInterval(interval)
    }
  }, [enabled, getId, playSound, repeatIntervalMs, repeatItems])

  useEffect(() => {
    if (repeatItems.length) return
    setToasts((current) => current.filter((toast) => !String(toast.id).startsWith("reminder-")))
  }, [repeatItems.length])

  useEffect(() => () => {
    document.title = "Alcazar Inventario"
  }, [])

  const highlightedIdList = useMemo(() => Array.from(highlightedIds), [highlightedIds])

  return {
    settings,
    setSettings,
    audioUnlocked,
    activateSound,
    playSound,
    toasts,
    dismissToast,
    highlightedIds,
    highlightedIdList,
    pendingCount: toasts.length
  }
}
