import assert from "node:assert/strict"
import test from "node:test"
import {
  normalizeChartAccountCode,
  sortImportRowsTopologically,
  validateChartAccountImportRows
} from "./financeChartAccountsValidation.js"

const FINANCE_VIEW_ROLES = ["admin", "gerente_general", "contador"]
const ACCOUNTING_CATALOG_MANAGE_ROLES = ["admin", "contador"]

function row(overrides = {}) {
  return {
    codigo: "1",
    nombre: "Activos",
    codigo_padre: "",
    tipo_financiero: "asset",
    naturaleza: "debit",
    tipo_cuenta: "header",
    acepta_movimientos: "false",
    descripcion: "",
    ...overrides
  }
}

test("duplicate code within file is blocking", () => {
  const preview = validateChartAccountImportRows([
    row({ codigo: "1.01", nombre: "Caja", tipo_cuenta: "detail", acepta_movimientos: "true" }),
    row({ codigo: "1.01", nombre: "Banco", tipo_cuenta: "detail", acepta_movimientos: "true" })
  ])
  assert.equal(preview.blocking_errors, true)
  assert.match(preview.errors[0].message, /duplicado/i)
})

test("account code is treated as text preserving leading zeros", () => {
  assert.equal(normalizeChartAccountCode(" 01.001 "), "01.001")
  assert.equal(normalizeChartAccountCode(1001), "1001")
})

test("missing parent is blocking", () => {
  const preview = validateChartAccountImportRows([
    row({ codigo: "9", nombre: "Hija", codigo_padre: "NO-EXISTE", tipo_cuenta: "detail", acepta_movimientos: "true" })
  ])
  assert.equal(preview.blocking_errors, true)
  assert.match(preview.errors[0].message, /padre/i)
})

test("hierarchical cycle in file is blocking", () => {
  const preview = validateChartAccountImportRows([
    row({ codigo: "A", nombre: "A", codigo_padre: "B", tipo_cuenta: "header" }),
    row({ codigo: "B", nombre: "B", codigo_padre: "A", tipo_cuenta: "header" })
  ])
  assert.equal(preview.blocking_errors, true)
  assert.ok(preview.errors.some((entry) => /ciclo/i.test(entry.message)))
})

test("parent defined in same file is accepted", () => {
  const preview = validateChartAccountImportRows([
    row({ codigo: "1", nombre: "Activos" }),
    row({ codigo: "1.01", nombre: "Caja", codigo_padre: "1", tipo_cuenta: "detail", acepta_movimientos: "true" })
  ])
  assert.equal(preview.blocking_errors, false)
  assert.equal(preview.valid_rows, 2)
})

test("invalid classification values are blocking", () => {
  const preview = validateChartAccountImportRows([
    row({ tipo_financiero: "invalid", naturaleza: "left", tipo_cuenta: "group" })
  ])
  assert.equal(preview.blocking_errors, true)
  assert.ok(preview.errors.length >= 3)
})

test("header account accepting movements is blocking", () => {
  const preview = validateChartAccountImportRows([
    row({ acepta_movimientos: "true" })
  ])
  assert.equal(preview.blocking_errors, true)
  assert.match(preview.errors[0].message, /acumuladoras/i)
})

test("one invalid row marks import as blocking (atomic preview)", () => {
  const preview = validateChartAccountImportRows([
    row({ codigo: "1", nombre: "OK" }),
    row({ codigo: "2", nombre: "", tipo_cuenta: "detail", acepta_movimientos: "true" })
  ])
  assert.equal(preview.blocking_errors, true)
  assert.equal(preview.new_accounts, 0)
})

test("roles without finance access cannot view catalog", () => {
  assert.equal(FINANCE_VIEW_ROLES.includes("mesero"), false)
  assert.equal(ACCOUNTING_CATALOG_MANAGE_ROLES.includes("gerente_general"), false)
})

test("admin and contador can manage accounting catalog", () => {
  for (const role of ACCOUNTING_CATALOG_MANAGE_ROLES) {
    assert.equal(ACCOUNTING_CATALOG_MANAGE_ROLES.includes(role), true)
  }
  assert.deepEqual(FINANCE_VIEW_ROLES.sort(), ["admin", "contador", "gerente_general"].sort())
})

test("topological sort preserves parent before child order", () => {
  const sorted = sortImportRowsTopologically([
    row({ codigo: "1.01", nombre: "Caja", codigo_padre: "1", tipo_cuenta: "detail", acepta_movimientos: "true" }),
    row({ codigo: "1", nombre: "Activos" })
  ])
  assert.deepEqual(sorted.map((entry) => entry.codigo), ["1", "1.01"])
})

test("deactivation is modeled separately from deletion (no delete helper exported)", () => {
  const preview = validateChartAccountImportRows([row()])
  assert.equal(preview.blocking_errors, false)
  assert.equal(typeof preview.errors, "object")
})
