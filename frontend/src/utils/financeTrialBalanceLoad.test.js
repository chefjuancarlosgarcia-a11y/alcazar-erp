import assert from "node:assert/strict"
import test from "node:test"
import {
  createTrialBalanceLoadController,
  fetchTrialBalanceReport
} from "./financeTrialBalanceLoad.js"

const filters = {
  fromDate: "2026-09-01",
  toDate: "2026-09-30",
  periodId: "",
  pageSize: 50
}

function report(snapshotAt) {
  return {
    rows: [],
    matchCount: 0,
    accountCount: 0,
    isSquare: true,
    page: 1,
    pageSize: 50,
    totalPages: 0,
    snapshotAt
  }
}

test("la carga inicial de la balanza pide un snapshot nuevo", async () => {
  const controller = createTrialBalanceLoadController()
  const calls = []
  const outcome = await fetchTrialBalanceReport({
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
  const controller = createTrialBalanceLoadController()
  const calls = []
  const fetchReport = async (params) => {
    calls.push(params.snapshotAt)
    return { data: report(params.snapshotAt || "T2"), error: "" }
  }
  await fetchTrialBalanceReport({
    canView: true,
    filters,
    options: { fresh: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })
  await fetchTrialBalanceReport({
    canView: true,
    filters,
    targetPage: 2,
    options: { reuseSnapshot: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })
  assert.equal(calls[0], null)
  assert.equal(calls[1], "T2")
})

test("una fecha invertida no consulta el reporte", async () => {
  let called = false
  const outcome = await fetchTrialBalanceReport({
    canView: true,
    filters: { ...filters, fromDate: "2026-09-30", toDate: "2026-09-01" },
    controller: createTrialBalanceLoadController(),
    fetchReport: async () => {
      called = true
      return { data: report("T1"), error: "" }
    },
    setLoading: () => {},
    onError: () => {}
  })
  assert.equal(outcome.ok, false)
  assert.equal(called, false)
  assert.match(outcome.error, /posterior/)
})

test("un error de consulta deja la pantalla en error y no conserva un reporte previo", async () => {
  let message = ""
  const outcome = await fetchTrialBalanceReport({
    canView: true,
    filters,
    controller: createTrialBalanceLoadController(),
    fetchReport: async () => ({ data: null, error: "No tienes permiso para consultar reportes contables." }),
    setLoading: () => {},
    onError: (value) => {
      message = value
    }
  })
  assert.equal(outcome.ok, false)
  assert.match(message, /permiso/)
})
