/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from "react"
import useDeviceInfo from "../hooks/useDeviceInfo"

const DeviceContext = createContext(null)

export function DeviceProvider({ children }) {
  const deviceInfo = useDeviceInfo()

  return (
    <DeviceContext.Provider value={deviceInfo}>
      {children}
    </DeviceContext.Provider>
  )
}

export function useDevice() {
  const context = useContext(DeviceContext)
  if (!context) throw new Error("useDevice debe usarse dentro de DeviceProvider")
  return context
}
