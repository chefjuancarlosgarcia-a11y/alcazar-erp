import AppRoutes from "./routes/AppRoutes"
import LocalNetworkAccessBanner from "./components/LocalNetworkAccessBanner"
import { AuthProvider } from "./context/AuthContext"
import { DeviceProvider } from "./context/DeviceContext"

function App() {
  return (
    <DeviceProvider>
      <AuthProvider>
        <AppRoutes />
        <LocalNetworkAccessBanner />
      </AuthProvider>
    </DeviceProvider>
  )
}

export default App
