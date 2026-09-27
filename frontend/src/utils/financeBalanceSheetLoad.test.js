import assert from "node:assert/strict"
import test from "node:test"
import {
  createBalanceSheetLoadController,
  fetchBalanceSheetReport
} from "./financeBalanceSheetLoad.js"

const filters = { cutoffDate: "2097-04-30", branchId: "", costCenterId: "" }

test("la carga pide un snapshot y conserva el último", async () => {
  const controller = createBalanceSheetLoadController()
  const calls = []
  const outcome = await fetchBalanceSheetReport({
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
  assert.equal(calls[0].cutoffDate, "2097-04-30")
  assert.equal(controller.snapshotAt, "T1")
})

test("una respuesta vieja no reemplaza la carga vigente", async () => {
  const controller = createBalanceSheetLoadController()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = fetchBalanceSheetReport({
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

test("sin fecha de corte no consulta el reporte", async () => {
  const controller = createBalanceSheetLoadController()
  let called = false
  const errors = []
  const outcome = await fetchBalanceSheetReport({
    canView: true,
    filters: { cutoffDate: "" },
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
  assert.match(errors[0], /fecha de corte/i)
})
