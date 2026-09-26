import assert from "node:assert/strict"
import test from "node:test"
import {
  createGeneralLedgerLoadController,
  fetchGeneralLedgerReport
} from "./financeGeneralLedgerLoad.js"

const filters = {
  accountId: "cash",
  fromDate: "2026-09-01",
  toDate: "2026-09-30",
  periodId: "",
  pageSize: 50
}

function report(snapshotAt, accountId = "cash") {
  return {
    account: { id: accountId },
    rows: [],
    openingBalance: 0,
    closingBalance: 0,
    periodDebit: 0,
    periodCredit: 0,
    movementCount: 0,
    matchCount: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
    snapshotAt
  }
}

test("la carga inicial pide un snapshot nuevo", async () => {
  const controller = createGeneralLedgerLoadController()
  const calls = []
  const outcome = await fetchGeneralLedgerReport({
    canView: true,
    filters,
    targetPage: 1,
    options: {},
    controller,
    fetchReport: async (params) => {
      calls.push(params)
      return { data: report("T1"), error: "" }
    },
    setLoading: () => {},
    onStart: () => {},
    onSuccess: () => {}
  })
  assert.equal(outcome.ok, true)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(controller.snapshotAt, "T1")
})

test("actualizar limpia el snapshot y la página siguiente lo reutiliza", async () => {
  const controller = createGeneralLedgerLoadController()
  const calls = []
  const fetchReport = async (params) => {
    calls.push(params.snapshotAt)
    return { data: report("T1"), error: "" }
  }
  await fetchGeneralLedgerReport({
    canView: true,
    filters,
    options: { fresh: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })
  await fetchGeneralLedgerReport({
    canView: true,
    filters,
    targetPage: 2,
    options: { reuseSnapshot: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })
  assert.deepEqual(calls, [null, "T1"])
})

test("un rango inválido no llama al reporte y conserva el error", async () => {
  const calls = []
  let message = ""
  const outcome = await fetchGeneralLedgerReport({
    canView: true,
    filters: { ...filters, fromDate: "2026-09-20", toDate: "2026-09-01" },
    controller: createGeneralLedgerLoadController(),
    fetchReport: async () => {
      calls.push("called")
      return { data: null, error: "" }
    },
    onError: (value) => { message = value },
    setLoading: () => {}
  })
  assert.equal(outcome.ok, false)
  assert.equal(calls.length, 0)
  assert.match(message, /fecha desde/i)
})

test("cambiar de cuenta descarta la respuesta anterior", async () => {
  const controller = createGeneralLedgerLoadController()
  let visible = report("T0", "old")
  let started = 0
  const outcome = await fetchGeneralLedgerReport({
    canView: true,
    filters: { ...filters, accountId: "new" },
    controller,
    fetchReport: async () => ({ data: report("T2", "new"), error: "" }),
    onStart: () => {
      started += 1
      visible = null
    },
    onSuccess: (data) => { visible = data },
    setLoading: () => {}
  })
  assert.equal(started, 1)
  assert.equal(outcome.data.account.id, "new")
  assert.equal(visible.account.id, "new")
})

test("un error de permisos no publica filas", async () => {
  let visible = report("T0")
  const outcome = await fetchGeneralLedgerReport({
    canView: true,
    filters,
    controller: createGeneralLedgerLoadController(),
    fetchReport: async () => ({ data: null, error: "No tienes permiso para consultar reportes contables." }),
    onStart: () => { visible = null },
    onError: () => {},
    onSuccess: (data) => { visible = data },
    setLoading: () => {}
  })
  assert.equal(outcome.ok, false)
  assert.equal(visible, null)
})

test("sin permiso de consulta no llama al reporte", async () => {
  let called = false
  const outcome = await fetchGeneralLedgerReport({
    canView: false,
    filters,
    controller: createGeneralLedgerLoadController(),
    fetchReport: async () => {
      called = true
      return { data: report("T"), error: "" }
    },
    setLoading: () => {}
  })
  assert.equal(outcome.skipped, true)
  assert.equal(called, false)
})
