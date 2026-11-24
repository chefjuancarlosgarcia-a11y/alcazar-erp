import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  LOCAL_RECONCILE_MESSAGE,
  UNVERIFIED_CASH_MESSAGE,
  applyAuthorizedAdjustment,
  firstConfirmedOpening,
  openingAmountToSubmit,
  paymentBinding,
  preferredRegisterId,
  resolveCashSessionView,
  shiftAfterAuthorizedClose
} from "./cashierSession.js"

const emySession = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "open",
  cash_register_id: "register-principal",
  opened_by: "emy-id",
  opened_at: "2026-11-24T15:10:00.000Z",
  opening_amount: 350,
  opener: { full_name: "Emy Velásquez", username: "emy" }
}

const principal = { id: "register-principal", name: "Caja Principal" }
const juan = { id: "juan-id", name: "Juan Carlos", username: "juancarlos" }

test("Juan Carlos sees Emy's open register without an opening form", () => {
  const view = resolveCashSessionView({
    remoteAvailable: true,
    remoteSession: emySession,
    localSession: null,
    register: principal
  })
  assert.equal(view.status, "open")
  assert.equal(view.showOpeningForm, false)
  assert.equal(view.session.registerName, "Caja Principal")
  assert.equal(view.session.openerName, "Emy Velásquez")
  assert.equal(view.session.openerId, "emy-id")
  assert.equal(view.session.openingAmount, 350)
  assert.equal(view.session.openedAt, "2026-11-24T15:10:00.000Z")
  const binding = paymentBinding(view.session, juan)
  assert.equal(binding.cashSessionId, emySession.id)
  assert.equal(binding.cashierId, "juan-id")
  assert.notEqual(binding.cashierId, binding.openerId)
})

test("the first confirmed opening amount is kept when two tablets race", () => {
  const winner = firstConfirmedOpening([
    { amount: 800, confirmed: false },
    { amount: 350, confirmed: true }
  ])
  assert.equal(winner.amount, 350)
  assert.equal(openingAmountToSubmit({ canOpen: false, typedAmount: "500" }), null)
})

test("an authorized cash correction keeps the original opening amount", () => {
  const session = {
    id: emySession.id,
    openingAmount: 350,
    openerId: "emy-id",
    openedAt: emySession.opened_at,
    registerId: principal.id,
    movements: []
  }
  const result = applyAuthorizedAdjustment(session, { amount: 20, reason: "Faltante de cambio", author: "Juan Carlos" })
  assert.equal(result.ok, true)
  assert.equal(result.session.openingAmount, 350)
  assert.equal(result.session.openerId, "emy-id")
  assert.equal(result.session.movements[0].type, "adjustment")
  assert.equal(result.session.movements[0].author, "Juan Carlos")
})

test("an authorized close can be followed by a new shift", () => {
  const closed = { id: emySession.id, status: "closed", openingAmount: 350 }
  const next = { id: "22222222-2222-4222-8222-222222222222", status: "open", openingAmount: 400 }
  const result = shiftAfterAuthorizedClose(closed, next)
  assert.equal(result.ok, true)
  assert.equal(result.previousOpeningAmount, 350)
  assert.equal(result.openingAmount, 400)
})

test("a tablet-only opening is preserved and does not use the default fund", () => {
  const local = {
    id: "session-1732460000000-10",
    status: "open",
    cashierId: "emy-id",
    cashierName: "Emy Velásquez",
    openedAt: "2026-11-24T15:05:00.000Z",
    openingAmount: 280
  }
  const view = resolveCashSessionView({
    remoteAvailable: true,
    remoteSession: null,
    localSession: local,
    register: principal
  })
  assert.equal(view.status, "local_only")
  assert.equal(view.showOpeningForm, false)
  assert.equal(view.canOpen, false)
  assert.equal(view.message, LOCAL_RECONCILE_MESSAGE)
  assert.equal(view.reconciliation.preserved, true)
  assert.equal(view.reconciliation.openingAmount, 280)
  assert.equal(view.session.shared, false)
  assert.equal(openingAmountToSubmit({ canOpen: view.canOpen, typedAmount: "500" }), null)
})

test("a failed server check blocks a new opening", () => {
  const view = resolveCashSessionView({ remoteAvailable: false, remoteSession: null, localSession: null })
  assert.equal(view.status, "unverified")
  assert.equal(view.message, UNVERIFIED_CASH_MESSAGE)
  assert.equal(view.canOpen, false)
  assert.equal(view.canCharge, false)
  assert.equal(view.showOpeningForm, false)
})

test("Caja Principal is the default register when several exist", () => {
  const id = preferredRegisterId([
    { id: "bar", name: "Caja Barra" },
    { id: "principal", name: "Caja Principal" }
  ])
  assert.equal(id, "principal")
})

test("the server migration locks one open session and freezes the opening", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const sql = readFileSync(resolve(root, "supabase/schema/222_cash_session_open_guard.sql"), "utf8")
  assert.match(sql, /for update/)
  assert.match(sql, /Ya existe una caja abierta/)
  assert.match(sql, /opening_amount is distinct from old\.opening_amount/)
  assert.match(sql, /cash_register_id is distinct from old\.cash_register_id/)
  assert.match(sql, /opened_by is distinct from old\.opened_by/)
  assert.match(sql, /opened_at is distinct from old\.opened_at/)
  assert.match(sql, /p_cash_session_id uuid default null/)
  assert.match(sql, /where id = p_cash_session_id and status = 'open'/)
  assert.match(sql, /cash_sessions_one_open_per_register_idx/)
})
