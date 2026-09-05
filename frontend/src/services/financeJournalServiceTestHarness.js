import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const FAKE_SUPABASE_URL = "http://127.0.0.1:54321"
const FAKE_ANON_KEY = "sb_publishable_test_finance_journal_resolver"

let server = null
let serviceModule = null

export async function getFinanceJournalServiceModule() {
  if (serviceModule) {
    return serviceModule
  }

  server = await createServer({
    configFile: false,
    root: frontendRoot,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: "custom",
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(FAKE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(FAKE_ANON_KEY),
      "import.meta.env.DEV": JSON.stringify(false),
      "import.meta.env.PROD": JSON.stringify(true),
      "import.meta.env.MODE": JSON.stringify("test"),
      "import.meta.env.SSR": JSON.stringify(true)
    }
  })

  serviceModule = await server.ssrLoadModule("/src/services/financeJournalService.js")
  return serviceModule
}

export async function loadFinanceJournalTestModule(specifier) {
  if (!server) {
    await getFinanceJournalServiceModule()
  }
  return server.ssrLoadModule(specifier)
}

export async function closeFinanceJournalServiceTestServer() {
  await server?.close()
  server = null
  serviceModule = null
}
