import assert from "node:assert/strict"
import test from "node:test"
import {
  formatAmountPayload,
  parseAmountToCents
} from "./financeJournalAmounts.js"
import {
  buildRpcLinesPayload,
  canPerformJournalAction,
  canSubmitJournalForm,
  filterCostCentersForBranch,
  filterPostableAccounts,
  journalActionsForRole,
  lineTotals,
  normalizeBackendError,
  parseAmount,
  validateBalance,
  validateJournalForm,
  validateLineDimensions,
  validateLineXor,
  validateMinLines,
  isJournalFormDirty,
  serializeFormSnapshot
} from "./financeJournalValidation.js"
import { confirmDiscardJournalChanges, UNSAVED_JOURNAL_CONFIRM } from "./financeJournalUnsaved.js"

const accountRequiredBranch = {
  id: "a1",
  code: "5.01",
  branch_dimension_rule: "required",
  cost_center_dimension_rule: "optional"
}

const accountProhibitedBranch = {
  id: "a2",
  code: "3.01",
  branch_dimension_rule: "prohibited",
  cost_center_dimension_rule: "prohibited"
}

test("cent-based balance: 0.10 + 0.20 equals 0.30", () => {
  const lines = [
    { debit: "0.10", credit: "" },
    { debit: "0.20", credit: "" },
    { debit: "", credit: "0.30" }
  ]
  const totals = lineTotals(lines)
  assert.equal(totals.balanced, true)
  assert.equal(validateBalance(lines).valid, true)
})

test("parseAmount handles comma thousands and two decimals", () => {
  assert.equal(parseAmount("1,000.00"), 1000)
  assert.equal(formatAmountPayload("1000"), "1000.00")
})

test("rejects invalid amounts", () => {
  assert.equal(parseAmountToCents("-1").ok, false)
  assert.equal(parseAmountToCents("NaN").ok, false)
  assert.equal(parseAmountToCents("1.234").ok, false)
  assert.equal(parseAmountToCents("9999999999999999.99").ok, true)
  assert.equal(parseAmountToCents("100000000000000000.00").ok, false)
})

test("line XOR validation", () => {
  assert.equal(validateLineXor({ debit: "10", credit: "" }).valid, true)
  assert.equal(validateLineXor({ debit: "", credit: "10" }).valid, true)
  assert.equal(validateLineXor({ debit: "10", credit: "5" }).valid, false)
  assert.equal(validateLineXor({ debit: "", credit: "" }).valid, false)
})

test("minimum two lines", () => {
  assert.equal(validateMinLines([{ account_id: "x" }]).valid, false)
  assert.equal(validateMinLines([{ account_id: "x" }, { account_id: "y" }]).valid, true)
})

test("dimension required optional prohibited", () => {
  assert.equal(
    validateLineDimensions(accountRequiredBranch, { branch_id: "", cost_center_id: "" }).valid,
    false
  )
  assert.equal(
    validateLineDimensions(accountRequiredBranch, { branch_id: "b1", cost_center_id: "" }).valid,
    true
  )
  assert.equal(
    validateLineDimensions(accountProhibitedBranch, { branch_id: "b1", cost_center_id: "" }).valid,
    false
  )
})

test("filter cost centers by branch includes corporate", () => {
  const rows = [
    { id: "1", branch_id: null, is_active: true, account_kind: "detail" },
    { id: "2", branch_id: "b1", is_active: true, account_kind: "detail" },
    { id: "3", branch_id: "b2", is_active: true, account_kind: "detail" }
  ]
  const filtered = filterCostCentersForBranch(rows, "b1")
  assert.deepEqual(filtered.map((row) => row.id), ["1", "2"])
})

test("filter postable accounts", () => {
  const rows = [
    { is_active: true, account_kind: "detail", accepts_entries: true },
    { is_active: false, account_kind: "detail", accepts_entries: true },
    { is_active: true, account_kind: "header", accepts_entries: false },
    { is_active: true, account_kind: "detail", accepts_entries: false }
  ]
  assert.equal(filterPostableAccounts(rows).length, 1)
})

test("journal actions by status and role", () => {
  const contador = { canView: true, canCreate: true, canApprove: true, canPost: true, canReverse: false }
  const gerente = { canView: true, canCreate: false, canApprove: false, canPost: false, canReverse: true }
  assert.deepEqual(journalActionsForRole("draft", contador), ["save_draft", "submit"])
  assert.deepEqual(journalActionsForRole("pending_approval", contador), ["approve", "reject"])
  assert.deepEqual(journalActionsForRole("approved", contador), ["post"])
  assert.deepEqual(journalActionsForRole("posted", gerente), ["reverse"])
  assert.deepEqual(journalActionsForRole("draft", gerente), [])
})

test("canPerformJournalAction matrix blocks wrong state actions", () => {
  const contador = { canView: true, canCreate: true, canApprove: true, canPost: true, canReverse: false }
  assert.equal(canPerformJournalAction("draft", "approve", contador), false)
  assert.equal(canPerformJournalAction("pending_approval", "post", contador), false)
  assert.equal(canPerformJournalAction("approved", "reverse", contador), false)
  assert.equal(canPerformJournalAction("posted", "save_draft", contador), false)
})

test("inactive profile has no journal actions", () => {
  const inactivePerms = { canView: false, canCreate: false, canApprove: false, canPost: false, canReverse: false }
  assert.deepEqual(journalActionsForRole("draft", inactivePerms), [])
})

test("gerente_general cannot create approve or post", () => {
  const gerentePerms = { canView: true, canCreate: false, canApprove: false, canPost: false, canReverse: true }
  assert.equal(canPerformJournalAction("posted", "reverse", gerentePerms), true)
  assert.equal(canPerformJournalAction("draft", "submit", gerentePerms), false)
  assert.equal(canPerformJournalAction("pending_approval", "approve", gerentePerms), false)
  assert.equal(canPerformJournalAction("approved", "post", gerentePerms), false)
})

test("build RPC payload clears prohibited dimensions and two decimals", () => {
  const accountsById = new Map([[accountProhibitedBranch.id, accountProhibitedBranch]])
  const payload = buildRpcLinesPayload(
    [{
      account_id: accountProhibitedBranch.id,
      branch_id: "ignored",
      cost_center_id: "ignored",
      description: "",
      reference: "",
      debit: "25.5",
      credit: ""
    }],
    accountsById
  )
  assert.equal(payload[0].branch_id, null)
  assert.equal(payload[0].cost_center_id, null)
  assert.equal(payload[0].debit, "25.50")
  assert.equal(payload[0].credit, "0.00")
})

test("validateJournalForm requires account and description", () => {
  const accountsById = new Map([[accountRequiredBranch.id, accountRequiredBranch]])
  const bad = validateJournalForm(
    {
      entry_date: "2026-08-01",
      description: "",
      reference: "",
      lines: [
        { account_id: "", debit: "10", credit: "", branch_id: "", cost_center_id: "" },
        { account_id: accountRequiredBranch.id, debit: "", credit: "10", branch_id: "b1", cost_center_id: "" }
      ]
    },
    accountsById
  )
  assert.equal(bad.valid, false)
})

test("normalize backend errors hides internal details", () => {
  assert.match(normalizeBackendError("permission denied for table x"), /permission denied/i)
  assert.match(normalizeBackendError("Could not find the function public.foo"), /no está disponible/i)
  assert.equal(normalizeBackendError(""), "No se pudo completar la operación.")
})

test("double submit guard pattern via pending flag contract", () => {
  let pending = false
  function runOnce(fn) {
    if (pending) return false
    pending = true
    fn()
    pending = false
    return true
  }
  assert.equal(runOnce(() => {}), true)
  pending = true
  assert.equal(runOnce(() => {}), false)
  pending = false
})

test("unsaved journal dirty detection", () => {
  const base = { entry_date: "2026-08-01", description: "A", reference: "", lines: [] }
  const snapshot = serializeFormSnapshot(base)
  assert.equal(isJournalFormDirty(base, snapshot), false)
  assert.equal(isJournalFormDirty({ ...base, description: "B" }, snapshot), true)
})

test("unsaved confirm message constant", () => {
  assert.match(UNSAVED_JOURNAL_CONFIRM, /cambios sin guardar/i)
  assert.equal(typeof confirmDiscardJournalChanges, "function")
})

const baseSubmitForm = {
  entry_date: "2026-08-15",
  description: "Partida smoke LOCAL TEST",
  reference: "",
  lines: [
    {
      account_id: accountRequiredBranch.id,
      debit: "100.00",
      credit: "",
      branch_id: "b1",
      cost_center_id: ""
    },
    {
      account_id: "a-cash",
      debit: "",
      credit: "100.00",
      branch_id: "",
      cost_center_id: ""
    }
  ]
}

const accountsForSubmit = new Map([
  [accountRequiredBranch.id, accountRequiredBranch],
  [
    "a-cash",
    {
      id: "a-cash",
      code: "1.01",
      branch_dimension_rule: "optional",
      cost_center_dimension_rule: "optional"
    }
  ]
])

test("canSubmitJournalForm rejects zero lines", () => {
  assert.equal(
    canSubmitJournalForm({ ...baseSubmitForm, lines: [] }, accountsForSubmit),
    false
  )
})

test("canSubmitJournalForm rejects one line", () => {
  assert.equal(
    canSubmitJournalForm({ ...baseSubmitForm, lines: [baseSubmitForm.lines[0]] }, accountsForSubmit),
    false
  )
})

test("canSubmitJournalForm rejects two empty lines even when balanced at zero", () => {
  assert.equal(
    canSubmitJournalForm(
      {
        entry_date: "2026-08-15",
        description: "Vacía",
        reference: "",
        lines: [
          { account_id: "", debit: "", credit: "", branch_id: "", cost_center_id: "" },
          { account_id: "", debit: "", credit: "", branch_id: "", cost_center_id: "" }
        ]
      },
      accountsForSubmit
    ),
    false
  )
})

test("canSubmitJournalForm accepts two valid balanced lines", () => {
  assert.equal(canSubmitJournalForm(baseSubmitForm, accountsForSubmit), true)
})

test("canSubmitJournalForm rejects balanced lines without account", () => {
  assert.equal(
    canSubmitJournalForm(
      {
        ...baseSubmitForm,
        lines: [
          { account_id: "", debit: "50", credit: "", branch_id: "", cost_center_id: "" },
          { account_id: "", debit: "", credit: "50", branch_id: "", cost_center_id: "" }
        ]
      },
      accountsForSubmit
    ),
    false
  )
})

test("canSubmitJournalForm rejects when required dimensions are missing", () => {
  assert.equal(
    canSubmitJournalForm(
      {
        ...baseSubmitForm,
        lines: [
          { ...baseSubmitForm.lines[0], branch_id: "" },
          baseSubmitForm.lines[1]
        ]
      },
      accountsForSubmit
    ),
    false
  )
})
