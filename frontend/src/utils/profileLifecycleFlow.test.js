import assert from "node:assert/strict"
import test from "node:test"
import {
  applyDeactivateAttemptFinish,
  applyDeactivateAttemptStart,
  applyReactivateAttemptFinish,
  applyReactivateAttemptStart,
  shouldKeepLifecycleModalOpen,
  validateDeactivateReason
} from "./profileLifecycleFlow.js"

const baseDeactivateState = {
  deactivateTarget: { id: "u1" },
  deactivateReason: "motivo de prueba",
  deactivatingId: "",
  deactivateModalError: ""
}

test("validateDeactivateReason rejects short motives", () => {
  assert.match(validateDeactivateReason("ab"), /obligatorio/)
})

test("deactivate failure keeps modal open and preserves reason", () => {
  const started = applyDeactivateAttemptStart(baseDeactivateState)
  assert.equal(started.deactivatingId, "u1")
  const finished = applyDeactivateAttemptFinish(started, { ok: false, message: "fallo controlado" })
  assert.equal(finished.deactivateTarget.id, "u1")
  assert.equal(finished.deactivateReason, "motivo de prueba")
  assert.equal(finished.deactivateModalError, "fallo controlado")
  assert.equal(finished.deactivatingId, "")
  assert.equal(shouldKeepLifecycleModalOpen({ ok: false }), true)
})

test("deactivate success closes modal and clears reason", () => {
  const finished = applyDeactivateAttemptFinish(baseDeactivateState, { ok: true, data: {} })
  assert.equal(finished.deactivateTarget, null)
  assert.equal(finished.deactivateReason, "")
  assert.equal(finished.deactivateModalError, "")
  assert.equal(shouldKeepLifecycleModalOpen({ ok: true }), false)
})

test("reactivate failure keeps modal open", () => {
  const state = { reactivateTarget: { id: "u2" }, reactivatingId: "", reactivateModalError: "" }
  const started = applyReactivateAttemptStart(state)
  const finished = applyReactivateAttemptFinish(started, { ok: false, message: "sin permiso" })
  assert.equal(finished.reactivateTarget.id, "u2")
  assert.equal(finished.reactivateModalError, "sin permiso")
})

test("reactivate success closes modal", () => {
  const state = { reactivateTarget: { id: "u2" }, reactivatingId: "", reactivateModalError: "" }
  const finished = applyReactivateAttemptFinish(state, { ok: true, message: "Usuario reactivado." })
  assert.equal(finished.reactivateTarget, null)
  assert.equal(finished.pageMessage, "Usuario reactivado.")
})
