import { createContext, useContext, useEffect, useState } from "react"
import { DEFAULT_BRANDING_SETTINGS, getBrandingSettings } from "../services/appSettingsService"
import { applyBrandingTheme } from "../utils/brandingTheme"

const BrandingContext = createContext(DEFAULT_BRANDING_SETTINGS)

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING_SETTINGS)

  useEffect(() => {
    let mounted = true
    getBrandingSettings().then(({ data }) => {
      if (mounted && data) {
        setBranding(data)
        applyBrandingTheme(data)
      }
    })
    function handleBrandingUpdated(event) {
      const next = event.detail || DEFAULT_BRANDING_SETTINGS
      setBranding(next)
      applyBrandingTheme(next)
    }
    window.addEventListener("branding-updated", handleBrandingUpdated)
    return () => {
      mounted = false
      window.removeEventListener("branding-updated", handleBrandingUpdated)
    }
  }, [])

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
}

export function useBrandingContext() {
  return useContext(BrandingContext)
}

export default BrandingProvider
