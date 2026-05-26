import { useEffect, useRef, useState } from "react"
import { supabase } from "../lib/supabase"

let channelSequence = 0

export default function useSupabaseRealtime({
  table,
  event = "*",
  filter,
  onChange,
  enabled = true
}) {
  const callbackRef = useRef(onChange)
  const [status, setStatus] = useState(enabled ? "connecting" : "disabled")
  const [error, setError] = useState("")

  useEffect(() => {
    callbackRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled || !table) {
      return undefined
    }

    channelSequence += 1
    const channel = supabase.channel(`realtime-${table}-${channelSequence}`)
    const config = { event, schema: "public", table }
    if (filter) config.filter = filter

    channel
      .on("postgres_changes", config, (payload) => callbackRef.current?.(payload))
      .subscribe((subscriptionStatus, subscriptionError) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("connected")
          setError("")
        } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") {
          setStatus("error")
          setError(subscriptionError?.message || "No se pudo activar Realtime.")
        } else if (subscriptionStatus === "CLOSED") {
          setStatus("closed")
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled, event, filter, table])

  const effectiveStatus = enabled && table ? status : "disabled"
  return {
    status: effectiveStatus,
    isLive: effectiveStatus === "connected",
    error: effectiveStatus === "disabled" ? "" : error
  }
}
