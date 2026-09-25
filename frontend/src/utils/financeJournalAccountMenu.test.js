import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  ACCOUNT_MENU_KEYBOARD_SELECTION_PENDING,
  applyAccountQueryChange,
  applyLineAccountQuery,
  applyLineAccountSelection,
  bindAccountMenuViewportListeners,
  computeAccountMenuPosition,
  filterAccountSuggestions
} from "./financeJournalAccountMenu.js"
import { validateJournalForm } from "./financeJournalValidation.js"

const cash = {
  id: "cash-id",
  code: "STAGE_UI_SMOKE-CASH",
  name: "Caja smoke",
  is_active: true,
  account_kind: "detail",
  accepts_entries: true,
  branch_dimension_rule: "optional",
  cost_center_dimension_rule: "optional"
}

const equity = {
  id: "equity-id",
  code: "STAGE_UI_SMOKE-EQUITY",
  name: "Capital smoke",
  is_active: true,
  account_kind: "detail",
  accepts_entries: true,
  branch_dimension_rule: "optional",
  cost_center_dimension_rule: "optional"
}

const accounts = [cash, equity]

function blankLine(key) {
  return {
    key,
    account_id: "",
    account_code: "",
    account_label: "",
    branch_id: "principal",
    cost_center_id: "cc-1",
    description: "",
    reference: "",
    debit: "",
    credit: ""
  }
}

function listenerTarget() {
  const entries = []
  return {
    entries,
    addEventListener(type, fn, options) {
      entries.push({ type, fn, options, removed: false })
    },
    removeEventListener(type, fn, options) {
      const found = entries.find((entry) => (
        !entry.removed && entry.type === type && entry.fn === fn && entry.options === options
      ))
      if (found) found.removed = true
    }
  }
}

test("la etiqueta ya seleccionada sigue apareciendo como sugerencia", () => {
  const label = `${cash.code} — ${cash.name}`
  const suggestions = filterAccountSuggestions(accounts, label)
  assert.deepEqual(suggestions.map((account) => account.id), [cash.id])
})

test("escribir texto no asigna account_id", () => {
  const lines = [blankLine("a"), blankLine("b")]
  const next = applyLineAccountQuery(lines, {}, 0, cash.code)
  assert.equal(next.queries[0], cash.code)
  assert.equal(next.lines[0].account_id, "")
  assert.equal(next.lines[0].account_code, "")
  assert.equal(next.lines[0].account_label, "")
  assert.equal(applyAccountQueryChange(next.lines[0], cash.code).linePatch, null)
})

test("seleccionar una sugerencia asigna UUID, código y etiqueta", () => {
  const lines = [blankLine("a"), blankLine("b")]
  const queried = applyLineAccountQuery(lines, {}, 0, "CASH")
  const suggestions = filterAccountSuggestions(accounts, queried.queries[0])
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].id, cash.id)
  const selected = applyLineAccountSelection(queried.lines, queried.queries, 0, suggestions[0])
  assert.equal(selected.lines[0].account_id, cash.id)
  assert.equal(selected.lines[0].account_code, cash.code)
  assert.equal(selected.queries[0], `${cash.code} — ${cash.name}`)
  assert.equal(selected.lines[0].account_label, selected.queries[0])
  assert.equal(selected.lines[0].branch_id, "principal")
})

test("editar el texto de una cuenta seleccionada limpia el UUID y las dimensiones", () => {
  const lines = [blankLine("a"), blankLine("b")]
  const selected = applyLineAccountSelection(lines, {}, 0, cash)
  const edited = applyLineAccountQuery(selected.lines, selected.queries, 0, "STAGE_UI_SMOKE-CAS")
  assert.equal(edited.queries[0], "STAGE_UI_SMOKE-CAS")
  assert.equal(edited.lines[0].account_id, "")
  assert.equal(edited.lines[0].account_code, "")
  assert.equal(edited.lines[0].account_label, "")
  assert.equal(edited.lines[0].branch_id, "")
  assert.equal(edited.lines[0].cost_center_id, "")
  assert.equal(edited.lines[1].branch_id, "principal")
})

test("dos filas conservan estados independientes", () => {
  let lines = [blankLine("a"), blankLine("b")]
  let queries = {}
  const first = applyLineAccountSelection(
    applyLineAccountQuery(lines, queries, 0, "CASH").lines,
    applyLineAccountQuery(lines, queries, 0, "CASH").queries,
    0,
    cash
  )
  lines = first.lines
  queries = first.queries
  const secondQuery = applyLineAccountQuery(lines, queries, 1, "EQUITY")
  assert.equal(secondQuery.lines[0].account_id, cash.id)
  assert.equal(secondQuery.lines[1].account_id, "")
  assert.equal(secondQuery.queries[0], `${cash.code} — ${cash.name}`)
  assert.equal(secondQuery.queries[1], "EQUITY")
})

test("la última fila puede mostrar y seleccionar sugerencias", () => {
  const lines = [blankLine("a"), blankLine("b")]
  const queried = applyLineAccountQuery(lines, {}, 1, "EQUITY")
  const suggestions = filterAccountSuggestions(accounts, queried.queries[1])
  assert.ok(suggestions.some((account) => account.id === equity.id))
  const selected = applyLineAccountSelection(queried.lines, queried.queries, 1, equity)
  assert.equal(selected.lines[1].account_id, equity.id)
  assert.equal(selected.lines[0].account_id, "")
  assert.equal(selected.queries[1], `${equity.code} — ${equity.name}`)
})

test("selección en la segunda fila permite que validateJournalForm continúe", () => {
  let lines = [blankLine("a"), blankLine("b")]
  let queries = {}
  const first = applyLineAccountSelection(lines, queries, 0, cash)
  lines = first.lines.map((line, index) => (
    index === 0 ? { ...line, debit: "100", credit: "" } : line
  ))
  queries = first.queries
  const second = applyLineAccountSelection(lines, queries, 1, equity)
  lines = second.lines.map((line, index) => (
    index === 1 ? { ...line, debit: "", credit: "100" } : line
  ))
  const result = validateJournalForm({
    entry_date: "2026-09-25",
    description: "SMOKE PR31 LIBRO DIARIO",
    reference: "PR31-SMOKE",
    lines
  }, new Map(accounts.map((account) => [account.id, account])))
  assert.equal(result.valid, true)
  assert.equal(lines[1].account_id, equity.id)
})

test("línea balanceada con texto pero sin UUID sigue siendo rechazada", () => {
  const result = validateJournalForm({
    entry_date: "2026-09-25",
    description: "SMOKE PR31 LIBRO DIARIO",
    reference: "PR31-SMOKE",
    lines: [
      { ...blankLine("a"), account_label: `${cash.code} — ${cash.name}`, debit: "100", credit: "" },
      { ...blankLine("b"), account_label: `${equity.code} — ${equity.name}`, debit: "", credit: "100" }
    ]
  }, new Map(accounts.map((account) => [account.id, account])))
  assert.equal(result.valid, false)
  assert.equal(result.message, "Seleccione una cuenta contable en cada línea.")
})

test("el popup se muestra arriba cuando no hay espacio debajo", () => {
  const below = computeAccountMenuPosition({
    anchor: { top: 80, bottom: 120, left: 32, width: 220 },
    viewport: { width: 1280, height: 800 },
    menuHeight: 160
  })
  assert.equal(below.placement, "below")
  assert.equal(below.top, 128)
  assert.equal(below.left, 32)
  assert.equal(below.width, 220)

  const above = computeAccountMenuPosition({
    anchor: { top: 700, bottom: 740, left: 40, width: 240 },
    viewport: { width: 1280, height: 780 },
    menuHeight: 192
  })
  assert.equal(above.placement, "above")
  assert.equal(above.top, 700 - 8 - 192)
  assert.equal(above.width, 240)
})

test("el popup no se sale del viewport por la derecha", () => {
  const placed = computeAccountMenuPosition({
    anchor: { top: 40, bottom: 80, left: 1200, width: 220 },
    viewport: { width: 1280, height: 800 },
    menuHeight: 80
  })
  assert.equal(placed.left + placed.width <= 1280 - 8, true)
})

test("cleanup de listeners al cerrar", () => {
  const windowTarget = listenerTarget()
  const documentTarget = listenerTarget()
  let repositioned = 0
  let dismissed = 0
  let keys = 0
  const unbind = bindAccountMenuViewportListeners(
    { window: windowTarget, document: documentTarget },
    {
      onReposition: () => { repositioned += 1 },
      onPointerDown: () => { dismissed += 1 },
      onKeyDown: () => { keys += 1 }
    }
  )

  const scroll = windowTarget.entries.find((entry) => entry.type === "scroll")
  const resize = windowTarget.entries.find((entry) => entry.type === "resize")
  const pointer = documentTarget.entries.find((entry) => entry.type === "pointerdown")
  const keydown = documentTarget.entries.find((entry) => entry.type === "keydown")
  assert.equal(scroll.options, true)
  assert.equal(pointer.options, true)
  scroll.fn()
  resize.fn()
  pointer.fn({ target: null })
  keydown.fn({ key: "Escape" })
  assert.equal(repositioned, 2)
  assert.equal(dismissed, 1)
  assert.equal(keys, 1)

  unbind()
  assert.equal(windowTarget.entries.every((entry) => entry.removed), true)
  assert.equal(documentTarget.entries.every((entry) => entry.removed), true)
})

test("el menú sale por portal y la tabla conserva el scroll", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const component = readFileSync(join(here, "../modules/finance/FinanceJournalAccountInput.jsx"), "utf8")
  const editor = readFileSync(join(here, "../modules/finance/FinanceJournalLinesEditor.jsx"), "utf8")
  const css = readFileSync(join(here, "../modules/finance/Finance.css"), "utf8")
  assert.match(component, /createPortal\(/)
  assert.match(component, /document\.body/)
  assert.match(component, /bindAccountMenuViewportListeners/)
  assert.match(component, /ResizeObserver/)
  assert.match(editor, /applyAccountQueryChange/)
  assert.match(css, /\.finance-journal-lines-wrap\s*\{[^}]*overflow:\s*auto/)
  assert.match(css, /\.finance-journal-account-menu\s*\{[^}]*position:\s*fixed/)
  assert.doesNotMatch(css, /\.finance-journal-account-suggestions\s*\{/)
  assert.match(ACCOUNT_MENU_KEYBOARD_SELECTION_PENDING, /flechas y Enter/)
})
