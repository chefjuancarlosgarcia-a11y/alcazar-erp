import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const FAKE_SUPABASE_URL = "http://127.0.0.1:54321"
const FAKE_ANON_KEY = "sb_publishable_test_finance_journal_resolver"

async function withViteSsrServer(run) {
  const server = await createServer({
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

  try {
    await run(server)
  } finally {
    await server.close()
  }
}

test("supabase module exposes supabase.rpc under Vite SSR resolution", async () => {
  await withViteSsrServer(async (server) => {
    const mod = await server.ssrLoadModule("/src/lib/supabase.js")
    assert.ok(mod.supabase, "module.supabase must exist")
    assert.equal(typeof mod.supabase.rpc, "function", "module.supabase.rpc must be a function")
  })
})

test("default financeJournalService resolver uses real dynamic import without injected client", async () => {
  await withViteSsrServer(async (server) => {
    const service = await server.ssrLoadModule("/src/services/financeJournalService.js")

    service.__resetRpcClientForTests()

    const invoke = await service.__resolveSupabaseRpcCallForTests()

    const supabaseMod = await server.ssrLoadModule("/src/lib/supabase.js")
    assert.ok(supabaseMod.supabase, "real import must resolve module.supabase")
    assert.equal(typeof supabaseMod.supabase.rpc, "function")

    assert.equal(typeof invoke, "function", "resolver must return an invocable bound rpc function")
    assert.notStrictEqual(invoke, supabaseMod.supabase, "resolver returns rpc binding, not the client")
    assert.equal(invoke.length, supabaseMod.supabase.rpc.length, "bound rpc preserves callable arity")
  })
})
