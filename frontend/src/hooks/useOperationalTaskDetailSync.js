import { useCallback, useEffect, useRef, useState } from "react"
import { getOperationalTaskDetail } from "../services/operationalTasksService"
import { isServerTaskNewer } from "./useOperationalTasksSync"

function toDetailErrorMessage(error) {
  if (!error) return "No se pudo cargar la tarea."
  const message = String(error)
  if (/permiso|permission|denegad|acceso|no tienes/i.test(message)) {
    return "No tienes acceso a esta tarea."
  }
  if (/no encontrada|not found/i.test(message)) {
    return "La tarea no existe o ya no está disponible."
  }
  return message
}

function isActiveRequest(requestId, requestSeqRef, targetId, activeTaskIdRef, mountedRef) {
  return (
    requestId === requestSeqRef.current
    && targetId === activeTaskIdRef.current
    && mountedRef.current
  )
}

export function useOperationalTaskDetailSync({ taskId, onError }) {
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(Boolean(taskId))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(null)

  const requestSeqRef = useRef(0)
  const activeTaskIdRef = useRef(taskId)
  const onErrorRef = useRef(onError)
  const baselineUpdatedAtRef = useRef(null)
  const hasUnsavedEditsRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    activeTaskIdRef.current = taskId
  }, [taskId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const setHasUnsavedEdits = useCallback((value) => {
    hasUnsavedEditsRef.current = Boolean(value)
  }, [])

  const applyTask = useCallback((nextTask, options = {}) => {
    if (!nextTask) {
      setTask(null)
      baselineUpdatedAtRef.current = null
      if (!options.keepConflict) setConflict(null)
      return
    }
    setTask(nextTask)
    if (!options.keepConflict) setConflict(null)
    baselineUpdatedAtRef.current = nextTask.updated_at || null
  }, [])

  const resolveDetail = useCallback(async (targetId, options = {}) => {
    const requestId = ++requestSeqRef.current
    const background = Boolean(options.background)
    const keepTask = Boolean(options.keepTask)

    if (!background) {
      setLoading(true)
      setError(null)
      if (!keepTask) {
        setTask(null)
        baselineUpdatedAtRef.current = null
        setConflict(null)
      }
    } else {
      setRefreshing(true)
    }

    try {
      const result = await getOperationalTaskDetail(targetId)

      if (!isActiveRequest(requestId, requestSeqRef, targetId, activeTaskIdRef, mountedRef)) {
        return result
      }

      if (result.error) {
        const message = toDetailErrorMessage(result.error)
        if (!background) {
          setError(message)
          setTask(null)
          baselineUpdatedAtRef.current = null
          setConflict(null)
          onErrorRef.current?.(message)
        }
        return result
      }

      if (!result.data) {
        const message = "La tarea no existe o ya no está disponible."
        if (!background) {
          setError(message)
          setTask(null)
          baselineUpdatedAtRef.current = null
          setConflict(null)
          onErrorRef.current?.(message)
        }
        return { data: null, error: message }
      }

      const hasUnsaved = hasUnsavedEditsRef.current
      const serverIsNewer = isServerTaskNewer(
        result.data.updated_at,
        baselineUpdatedAtRef.current
      )

      if (hasUnsaved && serverIsNewer && !options.force) {
        setConflict({ serverTask: result.data })
      } else if (options.mutationResult) {
        applyTask({ ...result.data, ...options.mutationResult })
        setError(null)
      } else {
        applyTask(result.data)
        setError(null)
      }

      return result
    } catch (caught) {
      const message = toDetailErrorMessage(
        caught?.message || "Error de red al cargar la tarea."
      )

      if (!isActiveRequest(requestId, requestSeqRef, targetId, activeTaskIdRef, mountedRef)) {
        return { data: null, error: message }
      }

      if (!background) {
        setError(message)
        setTask(null)
        baselineUpdatedAtRef.current = null
        setConflict(null)
        onErrorRef.current?.(message)
      }
      return { data: null, error: message }
    } finally {
      if (!isActiveRequest(requestId, requestSeqRef, targetId, activeTaskIdRef, mountedRef)) {
        return
      }
      if (background) setRefreshing(false)
      else setLoading(false)
    }
  }, [applyTask])

  const loadDetail = useCallback((id, options = {}) => {
    const targetId = id ?? taskId
    if (!targetId) {
      requestSeqRef.current += 1
      applyTask(null)
      setLoading(false)
      setRefreshing(false)
      setError(null)
      return Promise.resolve({ data: null, error: null })
    }
    return resolveDetail(targetId, options)
  }, [applyTask, resolveDetail, taskId])

  const retryDetail = useCallback(() => {
    if (!taskId) return Promise.resolve({ data: null, error: null })
    return loadDetail(taskId, { force: true })
  }, [loadDetail, taskId])

  const resolveDetailRef = useRef(resolveDetail)
  resolveDetailRef.current = resolveDetail

  useEffect(() => {
    if (!taskId) {
      requestSeqRef.current += 1
      applyTask(null)
      setLoading(false)
      setRefreshing(false)
      setError(null)
      return undefined
    }

    resolveDetailRef.current(taskId)
    return undefined
  }, [taskId, applyTask])

  const checkServerConflict = useCallback(async () => {
    if (!taskId || !hasUnsavedEditsRef.current) return false
    const result = await getOperationalTaskDetail(taskId)
    if (activeTaskIdRef.current !== taskId) return false
    if (!result.data) return false
    if (isServerTaskNewer(result.data.updated_at, baselineUpdatedAtRef.current)) {
      setConflict({ serverTask: result.data })
      return true
    }
    return false
  }, [taskId])

  const reloadFromServer = useCallback(() => {
    if (conflict?.serverTask) {
      applyTask(conflict.serverTask)
      setError(null)
      return
    }
    loadDetail(taskId, { force: true, background: true, keepTask: true })
  }, [applyTask, conflict, loadDetail, taskId])

  const dismissConflict = useCallback(() => {
    setConflict(null)
  }, [])

  const noteSaved = useCallback((savedTask) => {
    if (savedTask?.updated_at) {
      baselineUpdatedAtRef.current = savedTask.updated_at
    } else if (task?.updated_at) {
      baselineUpdatedAtRef.current = task.updated_at
    }
    setConflict(null)
  }, [task])

  const ensureCanMutate = useCallback(async () => {
    if (!taskId) return true
    const result = await getOperationalTaskDetail(taskId)
    if (activeTaskIdRef.current !== taskId) return false
    if (!result.data) return true
    if (isServerTaskNewer(result.data.updated_at, baselineUpdatedAtRef.current)) {
      setConflict({ serverTask: result.data })
      return false
    }
    return true
  }, [taskId])

  return {
    task,
    setTask,
    loading,
    refreshing,
    error,
    conflict,
    loadDetail,
    retryDetail,
    checkServerConflict,
    reloadFromServer,
    dismissConflict,
    noteSaved,
    ensureCanMutate,
    setHasUnsavedEdits,
    hasUnsavedEditsRef
  }
}
