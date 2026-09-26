import assert from "node:assert/strict"
import test from "node:test"
import {
  createIncomeStatementLoadController,
  fetchIncomeStatementReport
} from "./financeIncomeStatementLoad.js"

const filters = {
  fromDate: "2026-09-01",
  toDate: "2026-09-30",
  periodId: ""
}

test("la carga pide un snapshot y conserva el último", async () => {
  const controller = createIncomeStatementLoadController()
  const calls = []
  const outcome = await fetchIncomeStatementReport({
    canView: true,
    filters,
    controller,
    fetchReport: async (params) => {
      calls.push(params)
      return { data: { snapshotAt: "T1", reportComplete: true, sections: [] }, error: "" }
    },
    setLoading: () => {}
  })
  assert.equal(outcome.ok, true)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(controller.snapshotAt, "T1")
})

test("una respuesta vieja no reemplaza la carga vigente", async () => {
  const controller = createIncomeStatementLoadController()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = fetchIncomeStatementReport({
    canView: true,
    filters,
    controller,
    fetchReport: async () => {
      await gate
      return { data: { snapshotAt: "OLD" }, error: "" }
    },
    setLoading: () => {}
  })
  controller.nextRequestId()
  release()
  const outcome = await first
  assert.equal(outcome.stale, true)
})

test("un rango invertido no consulta el reporte", async () => {
  const controller = createIncomeStatementLoadController()
  let called = false
  const errors = []
  const outcome = await fetchIncomeStatementReport({
    canView: true,
    filters: { fromDate: "2026-09-30", toDate: "2026-09-01" },
    controller,
    fetchReport: async () => {
      called = true
      return { data: null, error: "" }
    },
    onError: (message) => errors.push(message),
    setLoading: () => {}
  })
  assert.equal(outcome.ok, false)
  assert.equal(called, false)
  assert.match(errors[0], /posterior/)
})
