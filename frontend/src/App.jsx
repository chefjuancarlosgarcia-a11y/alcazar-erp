import AppRoutes from "./routes/AppRoutes"
import LocalNetworkAccessBanner from "./components/LocalNetworkAccessBanner"
import IdleSessionManager from "./components/IdleSessionManager"
import { AuthProvider } from "./context/AuthContext"
import { DeviceProvider } from "./context/DeviceContext"
import { BrandingProvider } from "./context/BrandingProvider"

function App() {
  return (
    <DeviceProvider>
      <AuthProvider>
        <BrandingProvider>
          <AppRoutes />
          <IdleSessionManager />
          <LocalNetworkAccessBanner />
        </BrandingProvider>
      </AuthProvider>
    </DeviceProvider>
  )
}

export default App
