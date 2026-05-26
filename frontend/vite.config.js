import os from "node:os"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

function getLocalIp() {
  const interfaces = os.networkInterfaces()

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address
      }
    }
  }

  return "localhost"
}

function localNetworkInfoPlugin(port, localIp) {
  return {
    name: "local-network-info",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer.address()
        const resolvedPort = typeof address === "object" && address?.port ? address.port : port

        console.log("")
        console.log("Acceso local habilitado")
        console.log(`Local:   http://localhost:${resolvedPort}`)
        console.log(`Network: http://${localIp}:${resolvedPort}`)
        console.log("")
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const port = Number(env.VITE_PORT || 5173)
  const localIp = getLocalIp()

  return {
    plugins: [react(), localNetworkInfoPlugin(port, localIp)],
    server: {
      host: "0.0.0.0",
      port,
      strictPort: true
    },
    define: {
      "import.meta.env.VITE_LOCAL_IP": JSON.stringify(localIp),
      "import.meta.env.VITE_PORT": JSON.stringify(String(port))
    }
  }
})
