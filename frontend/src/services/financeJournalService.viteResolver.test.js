import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  closeFinanceJournalServiceTestServer,
  getFinanceJournalServiceModule,
  loadFinanceJournalTestModule
} from "./financeJournalServiceTestHarness.js"

const serviceSourcePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "financeJournalService.js"
)

test.after(async () => {
  await closeFinanceJournalServiceTestServer()
})

test("financeJournalService source uses static supabase import only", () => {
  const source = readFileSync(serviceSourcePath, "utf8")

  assert.match(
    source,
    /import\s*\{\s*supabase\s*\}\s*from\s*["']\.\.\/lib\/supabase["']/,
    "production service must statically import the supabase singleton"
  )
  assert.doesNotMatch(
    source,
    /import\s*\(\s*["']\.\.\/lib\/supabase(?:\.js)?["']\s*\)/,
    "production service must not dynamically import supabase"
  )
})

test("supabase module exposes supabase.rpc under Vite SSR resolution", async () => {
  const mod = await loadFinanceJournalTestModule("/src/lib/supabase.js")
  assert.ok(mod.supabase, "module.supabase must exist")
  assert.equal(typeof mod.supabase.rpc, "function", "module.supabase.rpc must be a function")
})

test("financeJournalService static resolver uses shared supabase singleton under Vite", async () => {
  const service = await getFinanceJournalServiceModule()
  const supabaseMod = await loadFinanceJournalTestModule("/src/lib/supabase.js")

  service.__resetRpcClientForTests()

  const invoke = service.__resolveSupabaseRpcCallForTests()

  assert.ok(supabaseMod.supabase, "static singleton must expose supabase")
  assert.equal(typeof supabaseMod.supabase.rpc, "function")

  assert.equal(typeof invoke, "function", "resolver must return invocable bound rpc")
  assert.notStrictEqual(invoke, supabaseMod.supabase, "resolver returns rpc binding, not the client")
  assert.equal(invoke.length, supabaseMod.supabase.rpc.length, "bound rpc preserves callable arity")
})
