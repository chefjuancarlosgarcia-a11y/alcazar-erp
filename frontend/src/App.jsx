import AppRoutes from "./routes/AppRoutes"
import LocalNetworkAccessBanner from "./components/LocalNetworkAccessBanner"
import IdleSessionManager from "./components/IdleSessionManager"
import { AuthProvider } from "./context/AuthContext"
import { DeviceProvider } from "./context/DeviceContext"

function App() {
  return (
    <DeviceProvider>
      <AuthProvider>
        <AppRoutes />
        <IdleSessionManager />
        <LocalNetworkAccessBanner />
      </AuthProvider>
    </DeviceProvider>
  )
}

export default App
