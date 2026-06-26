import AppRoutes from "./routes/AppRoutes"
import LocalNetworkAccessBanner from "./components/LocalNetworkAccessBanner"
import IdleSessionManager from "./components/IdleSessionManager"
import { AuthProvider } from "./context/AuthContext"
import { DeviceProvider } from "./context/DeviceContext"
import { BrandingProvider } from "./context/BrandingProvider"
import { InventoryMigrationModeProvider } from "./context/InventoryMigrationModeProvider"

function App() {
  return (
    <DeviceProvider>
      <AuthProvider>
        <BrandingProvider>
          <InventoryMigrationModeProvider>
            <AppRoutes />
            <IdleSessionManager />
            <LocalNetworkAccessBanner />
          </InventoryMigrationModeProvider>
        </BrandingProvider>
      </AuthProvider>
    </DeviceProvider>
  )
}

export default App
