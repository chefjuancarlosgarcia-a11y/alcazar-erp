import AppRoutes from "./routes/AppRoutes"
import LocalNetworkAccessBanner from "./components/LocalNetworkAccessBanner"
import { AuthProvider } from "./context/AuthContext"

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
      <LocalNetworkAccessBanner />
    </AuthProvider>
  )
}

export default App
