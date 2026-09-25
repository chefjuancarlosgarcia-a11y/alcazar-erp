import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { normalizeChartAccountCode, normalizeImportRow } from "../src/utils/financeChartAccountsValidation.js"

const csvRow = {
  codigo: " 01.0010 ",
  nombre: "Caja",
  codigo_padre: "1.00",
  tipo_financiero: "asset",
  naturaleza: "debit",
  tipo_cuenta: "detail",
  acepta_movimientos: "true",
  descripcion: ""
}

assert.equal(normalizeChartAccountCode(csvRow.codigo), "01.0010")
assert.equal(normalizeChartAccountCode("001.0100"), "001.0100")

const normalized = normalizeImportRow(csvRow)
assert.equal(normalized.codigo, " 01.0010 ")
assert.equal(normalizeChartAccountCode(normalized.codigo), "01.0010")

const sheetRows = [
  { codigo: "01.0010", nombre: "Caja", codigo_padre: "1.00", tipo_financiero: "asset", naturaleza: "debit", tipo_cuenta: "detail", acepta_movimientos: "true", descripcion: "" },
  { codigo: "001.0100", nombre: "Banco", codigo_padre: "", tipo_financiero: "asset", naturaleza: "debit", tipo_cuenta: "header", acepta_movimientos: "false", descripcion: "" }
]

const workbook = XLSX.utils.book_new()
const worksheet = XLSX.utils.json_to_sheet(sheetRows)
XLSX.utils.book_append_sheet(workbook, worksheet, "catalogo")
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
const parsed = XLSX.read(buffer, { type: "buffer", raw: false })
const roundtrip = XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { defval: "", raw: false })

assert.equal(normalizeChartAccountCode(roundtrip[0].codigo), "01.0010")
assert.equal(normalizeChartAccountCode(roundtrip[1].codigo), "001.0100")

console.log("CSV/XLSX code preservation: PASS")
