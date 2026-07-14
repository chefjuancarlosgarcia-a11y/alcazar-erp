import { useCallback, useEffect, useRef, useState } from "react"

import {

  createOperationalTaskQuick,

  getMyOperationalTasks,

  getOperationalTaskDetail,

  getOperationalTasksBoard,

  moveOperationalTask,

  updateOperationalTask,

  updateOperationalTaskMembers,

  updateOperationalTaskAssignees,

  updateOperationalTaskStatus

} from "../services/operationalTasksService"

import { getTaskAssignableProfiles } from "../services/tasksService"



function useOperationalListQuery(fetcher, deps = []) {

  const [tasks, setTasks] = useState([])

  const [loading, setLoading] = useState(true)

  const [refreshing, setRefreshing] = useState(false)

  const [error, setError] = useState("")

  const [lastSyncedAt, setLastSyncedAt] = useState(null)

  const [requestCompleted, setRequestCompleted] = useState(false)

  const [hasCachedData, setHasCachedData] = useState(false)

  const hasCachedDataRef = useRef(false)



  const refresh = useCallback(async (options = {}) => {

    const background = Boolean(options.background)

    const hasCache = hasCachedDataRef.current



    if (background) {

      setRefreshing(true)

    } else if (!hasCache) {

      setLoading(true)

    }



    const result = await fetcher()



    if (result.error) {

      if (hasCache) {

        setError(result.error || "")

      } else {

        setTasks(result.data || [])

        setError(result.error || "")

      }

    } else {

      const nextTasks = result.data || []

      setTasks(nextTasks)

      setError("")

      setHasCachedData(true)

      hasCachedDataRef.current = true

      setLastSyncedAt(new Date())

    }



    setRequestCompleted(true)

    if (background) setRefreshing(false)

    else setLoading(false)

    return result

  }, deps)



  useEffect(() => {

    refresh()

  }, [refresh])



  return {

    tasks,

    loading,

    refreshing,

    error,

    refresh,

    setTasks,

    lastSyncedAt,

    requestCompleted,

    hasCachedData

  }

}



export function useOperationalTasksBoard(filters = {}) {

  return useOperationalListQuery(

    () => getOperationalTasksBoard({

      areaId: filters.areaId || null,

      search: filters.search || null,

      labelIds: filters.labelIds || null,

      includeCancelled: filters.includeCancelled,

      includeOldCompleted: filters.includeOldCompleted,

      completedDays: filters.completedDays

    }),

    [

      filters.areaId,

      filters.search,

      JSON.stringify(filters.labelIds || []),

      filters.includeCancelled,

      filters.includeOldCompleted,

      filters.completedDays

    ]

  )

}



export function useMyOperationalTasks(filters = {}) {

  return useOperationalListQuery(

    () => getMyOperationalTasks({

      status: filters.status || null,

      limit: filters.limit || 100

    }),

    [filters.status, filters.limit]

  )

}



export function useOperationalTaskDetail(taskId) {

  const [task, setTask] = useState(null)

  const [loading, setLoading] = useState(Boolean(taskId))

  const [error, setError] = useState("")



  const refresh = useCallback(async () => {

    if (!taskId) {

      setTask(null)

      setLoading(false)

      setError("")

      return { data: null, error: null }

    }

    setLoading(true)

    const result = await getOperationalTaskDetail(taskId)

    setTask(result.data)

    setError(result.error || "")

    setLoading(false)

    return result

  }, [taskId])



  useEffect(() => {

    refresh()

  }, [refresh])



  return { task, loading, error, refresh, setTask }

}



export async function quickCreateOperationalTask(title, options = {}) {

  return createOperationalTaskQuick({

    title,

    assigneeId: options.assigneeId,

    areaId: options.areaId,

    dueAt: options.dueAt

  })

}



export async function changeOperationalTaskStatus(taskId, payload) {

  return updateOperationalTaskStatus(taskId, payload)

}



export async function moveOperationalTaskCard(taskId, payload) {

  return moveOperationalTask(taskId, payload)

}



export async function patchOperationalTask(taskId, payload) {

  return updateOperationalTask(taskId, payload)

}



export async function assignOperationalTaskMembers(taskId, payload) {

  if (Array.isArray(payload)) {

    return updateOperationalTaskAssignees(taskId, payload)

  }

  return updateOperationalTaskMembers(taskId, payload)

}



export function useAssignableProfiles() {

  const [profiles, setProfiles] = useState([])

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")



  const refresh = useCallback(async () => {

    setLoading(true)

    const result = await getTaskAssignableProfiles()

    setProfiles(result.data || [])

    setError(result.error?.message || "")

    setLoading(false)

    return result

  }, [])



  useEffect(() => {

    refresh()

  }, [refresh])



  return { profiles, loading, error, refresh }

}

