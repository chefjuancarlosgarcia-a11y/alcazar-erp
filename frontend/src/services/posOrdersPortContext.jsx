/* eslint-disable react-refresh/only-export-components -- port provider + hook share module */
import { createContext, useContext, useLayoutEffect, useMemo } from "react"
import { clearStationPosOrdersDelegate, setStationPosOrdersDelegate } from "./posOrdersFacade"

const PosOrdersPortContext = createContext(null)

export function PosOrdersPortProvider({ port, children }) {
  useLayoutEffect(() => {
    if (!port) {
      clearStationPosOrdersDelegate()
      return undefined
    }
    return setStationPosOrdersDelegate(port)
  }, [port])

  const value = useMemo(() => port, [port])
  return <PosOrdersPortContext.Provider value={value}>{children}</PosOrdersPortContext.Provider>
}

export function usePosOrdersPort() {
  return useContext(PosOrdersPortContext)
}
