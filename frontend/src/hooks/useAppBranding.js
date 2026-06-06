import { useEffect, useState } from "react"
import { DEFAULT_BRANDING_SETTINGS, getBrandingSettings } from "../services/appSettingsService"

export default function useAppBranding() {
  const [branding, setBranding] = useState(DEFAULT_BRANDING_SETTINGS)

  useEffect(() => {
    let mounted = true
    getBrandingSettings().then(({ data }) => {
      if (mounted) setBranding(data)
    })
    function handleBrandingUpdated(event) {
      setBranding(event.detail || DEFAULT_BRANDING_SETTINGS)
    }
    window.addEventListener("branding-updated", handleBrandingUpdated)
    return () => {
      mounted = false
      window.removeEventListener("branding-updated", handleBrandingUpdated)
    }
  }, [])

  return branding
}
