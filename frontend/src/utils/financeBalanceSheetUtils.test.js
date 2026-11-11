import assert from "node:assert/strict"
import test from "node:test"
import {
  BALANCE_SHEET_ACCUMULATED_LABEL,
  BALANCE_SHEET_CLASSIFIED_NOTE,
  BALANCE_SHEET_COMPLETE_LABEL,
  BALANCE_SHEET_PROVISIONAL_LABEL,
  BALANCE_SHEET_SECTION_LABELS,
  BALANCE_SHEET_SECTION_ORDER
} from "./financeBalanceSheetConstants.js"
import {
  buildBalanceSheetCsv,
  mapBalanceSheetResponse,
  resolveBalanceSheetScreen,
  validateBalanceSheetQuery
} from "./financeBalanceSheetUtils.js"

function account(overrides = {}) {
  return {
    account_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    code: "1.01",
    name: "Caja",
    financial_type: "asset",
    natural_balance: "debit",
    balance_sheet_section: "current_asset",
    is_active: true,
    parent_code: null,
    debit: 100,
    credit: 0,
    amount: 100,
    natural_signed: 100,
    contrary: false,
    movement_count: 1,
    ...overrides
  }
}

function sections({ current = [], noncurrent = [], currentLiabilities = [], noncurrentLiabilities = [], equity = [], subtotals = {} } = {}) {
  const accounts = {
    current_asset: current,
    noncurrent_asset: noncurrent,
    current_liability: currentLiabilities,
    noncurrent_liability: noncurrentLiabilities,
    equity
  }
  return BALANCE_SHEET_SECTION_ORDER.map((key) => ({
    key,
    label: BALANCE_SHEET_SECTION_LABELS[key],
    subtotal: subtotals[key] ?? 0,
    accounts: accounts[key]
  }))
}

function payload(overrides = {}) {
  return {
    cutoff_date: "2097-04-30",
    snapshot_at: "2097-04-30T12:00:00.000Z",
    scope: "global",
    include_zero_accounts: false,
    dimensional_filter: false,
    report_complete: true,
    report_label: BALANCE_SHEET_COMPLETE_LABEL,
    balance_status: "Cuadrado",
    is_square: true,
    current_assets_total: 100,
    noncurrent_assets_total: 0,
    classified_total_assets: 100,
    current_liabilities_total: 0,
    noncurrent_liabilities_total: 0,
    classified_total_liabilities: 0,
    classified_registered_equity: 70,
    accumulated_result: 30,
    classified_total_equity: 100,
    classified_total_liabilities_and_equity: 100,
    classified_difference: 0,
    unclassified_asset_amount: 0,
    unclassified_liability_amount: 0,
    unclassified_equity_amount: 0,
    control_total_assets: 100,
    control_total_liabilities: 0,
    control_registered_equity: 70,
    control_total_equity: 100,
    control_total_liabilities_and_equity: 100,
    difference: 0,
    unclassified_debit: 0,
    unclassified_credit: 0,
    unclassified_account_count: 0,
    account_count: 1,
    warnings: [],
    sections: sections({
      current: [account()],
      subtotals: { current_asset: 100, equity: 70 }
    }),
    unclassified_accounts: [],
    ...overrides
  }
}

test("la fecha de corte es obligatoria", () => {
  assert.equal(validateBalanceSheetQuery({ cutoffDate: "" }).ok, false)
  assert.equal(validateBalanceSheetQuery({ cutoffDate: "2097-04-30" }).ok, true)
})

test("un balance completo separa subtotales clasificados de la ecuación de control", () => {
  const mapped = mapBalanceSheetResponse(payload())
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.reportLabel, BALANCE_SHEET_COMPLETE_LABEL)
  assert.equal(mapped.report.classifiedTotalAssets, 100)
  assert.equal(mapped.report.controlTotalAssets, 100)
  assert.equal(mapped.report.difference, 0)
  assert.equal(mapped.report.isSquare, true)
  assert.equal(mapped.report.accumulatedResult, 30)
})

test("un activo sin clasificar deja el balance provisional y distingue los totales", () => {
  const mapped = mapBalanceSheetResponse(payload({
    report_complete: false,
    report_label: BALANCE_SHEET_PROVISIONAL_LABEL,
    current_assets_total: 23,
    classified_total_assets: 23,
    classified_registered_equity: 35,
    accumulated_result: 0,
    classified_total_equity: 35,
    classified_total_liabilities_and_equity: 35,
    classified_difference: -12,
    unclassified_asset_amount: 12,
    unclassified_debit: 12,
    unclassified_account_count: 1,
    account_count: 2,
    control_total_assets: 35,
    control_registered_equity: 35,
    control_total_equity: 35,
    control_total_liabilities_and_equity: 35,
    difference: 0,
    sections: sections({
      current: [account({ debit: 23, amount: 23, natural_signed: 23 })],
      subtotals: { current_asset: 23, equity: 35 }
    }),
    unclassified_accounts: [account({
      account_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      code: "1.99",
      name: "Activo sin sección",
      balance_sheet_section: null,
      debit: 12,
      amount: 12,
      natural_signed: 12
    })]
  }))
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.reportLabel, BALANCE_SHEET_PROVISIONAL_LABEL)
  assert.equal(mapped.report.classifiedTotalAssets, 23)
  assert.equal(mapped.report.controlTotalAssets, 35)
  assert.equal(mapped.report.classifiedDifference, -12)
  assert.equal(mapped.report.difference, 0)
  assert.equal(mapped.report.isSquare, true)
  assert.equal(resolveBalanceSheetScreen({ canView: true, report: mapped.report }).state, "incomplete")
})

test("la depreciación acumulada reduce el activo sin marcarse como saldo contrario", () => {
  const mapped = mapBalanceSheetResponse(payload({
    current_assets_total: 10,
    noncurrent_assets_total: 50,
    classified_total_assets: 60,
    classified_registered_equity: 60,
    accumulated_result: 0,
    classified_total_equity: 60,
    classified_total_liabilities_and_equity: 60,
    control_total_assets: 60,
    control_registered_equity: 60,
    control_total_equity: 60,
    control_total_liabilities_and_equity: 60,
    account_count: 2,
    sections: sections({
      current: [account({ debit: 10, amount: 10, natural_signed: 10 })],
      noncurrent: [account({
        account_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        code: "1.20",
        name: "Depreciación acumulada",
        natural_balance: "credit",
        balance_sheet_section: "noncurrent_asset",
        debit: 0,
        credit: 30,
        amount: -30,
        natural_signed: 30,
        contrary: false
      })],
      subtotals: { current_asset: 10, noncurrent_asset: 50, equity: 60 }
    })
  }))
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.sections[1].accounts[0].amount, -30)
  assert.equal(mapped.report.sections[1].accounts[0].contrary, false)
  assert.equal(mapped.report.classifiedTotalAssets, 60)
})

test("un saldo contrario se acepta solo si el signo natural es negativo", () => {
  const contrary = mapBalanceSheetResponse(payload({
    sections: sections({
      current: [account({
        debit: 0,
        credit: 10,
        amount: -10,
        natural_signed: -10,
        contrary: true
      })],
      subtotals: { current_asset: 100, equity: 70 }
    })
  }))
  assert.equal(contrary.ok, true)
  assert.equal(contrary.report.sections[0].accounts[0].contrary, true)
  const mismatched = mapBalanceSheetResponse(payload({
    sections: sections({
      current: [account({ amount: -10, natural_signed: 10, contrary: true })],
      subtotals: { current_asset: 100, equity: 70 }
    })
  }))
  assert.equal(mismatched.ok, false)
})

test("el CSV incompleto marca INCOMPLETO e incluye cuentas y la ecuación de control", () => {
  const mapped = mapBalanceSheetResponse(payload({
    report_complete: false,
    report_label: BALANCE_SHEET_PROVISIONAL_LABEL,
    current_assets_total: 23,
    classified_total_assets: 23,
    classified_registered_equity: 35,
    accumulated_result: 0,
    classified_total_equity: 35,
    classified_total_liabilities_and_equity: 35,
    classified_difference: -12,
    unclassified_asset_amount: 12,
    unclassified_debit: 12,
    unclassified_account_count: 1,
    account_count: 2,
    control_total_assets: 35,
    control_registered_equity: 35,
    control_total_equity: 35,
    control_total_liabilities_and_equity: 35,
    dimensional_filter: true,
    warnings: ["El filtro de sucursal o centro de costo puede descuadrar el balance porque excluye líneas de contrapartida."],
    sections: sections({
      current: [account({
        code: "1.01",
        name: "=Caja",
        debit: 23,
        amount: 23,
        natural_signed: 23
      })],
      subtotals: { current_asset: 23, equity: 35 }
    }),
    unclassified_accounts: [account({
      account_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      code: "1.99",
      name: "Activo sin sección",
      balance_sheet_section: null,
      debit: 12,
      amount: 12,
      natural_signed: 12
    })]
  }))
  const csv = buildBalanceSheetCsv(mapped.report)
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /INCOMPLETO/)
  assert.match(csv, /'=Caja/)
  assert.match(csv, /1\.99/)
  assert.match(csv, /Ecuación de control/)
  assert.match(csv, /35\.00/)
  assert.match(csv, new RegExp(BALANCE_SHEET_ACCUMULATED_LABEL))
  assert.match(csv, new RegExp(BALANCE_SHEET_CLASSIFIED_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(csv, /descuadrar el balance/)
})
