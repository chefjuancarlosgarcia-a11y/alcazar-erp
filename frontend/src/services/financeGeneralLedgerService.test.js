import assert from "node:assert/strict"
import test from "node:test"
import {
  closeFinanceJournalServiceTestServer,
  loadFinanceJournalTestModule
} from "./financeJournalServiceTestHarness.js"

let service = null
let permissions = null

async function getModules() {
  if (!service) {
    service = await loadFinanceJournalTestModule("/src/services/financeGeneralLedgerService.js")
    permissions = await loadFinanceJournalTestModule("/src/utils/financePermissions.js")
  }
  return { service, permissions }
}

test.before(async () => {
  await getModules()
})

test.after(async () => {
  await closeFinanceJournalServiceTestServer()
})

test("el servicio rechaza a quien el RPC declara sin permiso", async () => {
  const { service: ledger } = await getModules()
  ledger.__setGeneralLedgerRpcClientForTests(async () => ({
    data: null,
    error: { message: "No tienes permiso para consultar reportes contables." }
  }))
  try {
    const result = await ledger.getFinanceGeneralLedger({ accountId: "account-1" })
    assert.equal(result.data, null)
    assert.match(result.error, /No tienes permiso/)
  } finally {
    ledger.__resetGeneralLedgerRpcClientForTests()
  }
})

test("el servicio no publica un reporte con metadatos inválidos", async () => {
  const { service: ledger } = await getModules()
  ledger.__setGeneralLedgerRpcClientForTests(async () => ({ data: { rows: [] }, error: null }))
  try {
    const result = await ledger.getFinanceGeneralLedger({ accountId: "account-1" })
    assert.equal(result.data, null)
    assert.match(result.error, /inválidos/)
  } finally {
    ledger.__resetGeneralLedgerRpcClientForTests()
  }
})

test("admin consulta el mayor y un rol operativo no", async () => {
  const { permissions: access } = await getModules()
  assert.equal(access.canViewAccountingJournal({ status: "active", role: "admin" }), true)
  assert.equal(access.canViewAccountingJournal({ status: "active", role: "contador" }), true)
  assert.equal(access.canViewAccountingJournal({ status: "active", role: "gerente_general" }), true)
  assert.equal(access.canViewAccountingJournal({ status: "active", role: "mesero" }), false)
  assert.equal(access.canViewAccountingJournal({ status: "inactive", role: "admin" }), false)
})

test("una función ausente no muestra detalles internos", async () => {
  const { service: ledger } = await getModules()
  ledger.__setGeneralLedgerRpcClientForTests(async () => ({
    data: null,
    error: { message: "Could not find the function public.get_finance_general_ledger in the schema cache" }
  }))
  try {
    const result = await ledger.getFinanceGeneralLedger({ accountId: "account-1" })
    assert.equal(result.data, null)
    assert.match(result.error, /no está disponible/i)
    assert.doesNotMatch(result.error, /migración|propuesto|schema cache|get_finance_general_ledger/i)
  } finally {
    ledger.__resetGeneralLedgerRpcClientForTests()
  }
})
