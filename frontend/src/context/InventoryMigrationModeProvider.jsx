import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAuth } from "./AuthContext"
import { getInventoryMigrationMode } from "../services/inventoryMigrationModeService"

const InventoryMigrationModeContext = createContext(null)

export function InventoryMigrationModeProvider({ children }) {
  const { user } = useAuth()
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setState(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    const result = await getInventoryMigrationMode()
    setLoading(false)
    if (!result.error) setState(result.data)
    return result
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo(() => ({
    state,
    loading,
    enabled: Boolean(state?.enabled),
    refresh,
    applyState(nextState) {
      setState(nextState)
    }
  }), [state, loading, refresh])

  return (
    <InventoryMigrationModeContext.Provider value={value}>
      {children}
    </InventoryMigrationModeContext.Provider>
  )
}

export function useInventoryMigrationMode() {
  return useContext(InventoryMigrationModeContext) || {
    state: null,
    loading: false,
    enabled: false,
    refresh: async () => null,
    applyState() {}
  }
}
