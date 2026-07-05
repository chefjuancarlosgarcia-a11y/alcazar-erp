import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAuth } from "./AuthContext"
import { getInventoryMigrationMode } from "../services/inventoryMigrationModeService"
import { getInventoryDeductionModeSetting } from "../services/inventoryDeductionModeService"
import { INVENTORY_DEDUCTION_MODES } from "../utils/posImplementationMode"

const InventoryMigrationModeContext = createContext(null)

export function InventoryMigrationModeProvider({ children }) {
  const { user } = useAuth()
  const [state, setState] = useState(null)
  const [deductionState, setDeductionState] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setState(null)
      setDeductionState(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    const [migrationResult, deductionResult] = await Promise.all([
      getInventoryMigrationMode(),
      getInventoryDeductionModeSetting()
    ])
    setLoading(false)
    if (!migrationResult.error) setState(migrationResult.data)
    if (!deductionResult.error) setDeductionState(deductionResult.data)
    return { migrationResult, deductionResult }
  }, [user])

  const refreshDeductionMode = useCallback(async () => {
    const result = await getInventoryDeductionModeSetting()
    if (!result.error) setDeductionState(result.data)
    return result
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const deductionMode = deductionState?.mode || INVENTORY_DEDUCTION_MODES.ACTIVE_RECIPES_ONLY

  const value = useMemo(() => ({
    state,
    loading,
    enabled: Boolean(state?.enabled),
    refresh,
    applyState(nextState) {
      setState(nextState)
    },
    deductionState,
    deductionMode,
    refreshDeductionMode,
    applyDeductionState(nextState) {
      setDeductionState(nextState)
    }
  }), [state, loading, refresh, deductionState, deductionMode, refreshDeductionMode])

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
    applyState() {},
    deductionState: null,
    deductionMode: INVENTORY_DEDUCTION_MODES.ACTIVE_RECIPES_ONLY,
    refreshDeductionMode: async () => null,
    applyDeductionState() {}
  }
}

export function useInventoryDeductionMode() {
  return useInventoryMigrationMode()
}
