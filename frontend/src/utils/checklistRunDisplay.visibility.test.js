import assert from "node:assert/strict"
import test from "node:test"
import { canSeeChecklistRun } from "./checklistRunDisplay.js"

const anelia = { id: "anelia-id", role: "limpieza", area_name: "Limpieza" }

test("limpieza sees the run assigned to her profile", () => {
  const run = {
    id: "run-anelia",
    status: "pending",
    assigned_profile_id: "anelia-id",
    assigned_role: "limpieza",
    area: "Limpieza"
  }
  assert.equal(canSeeChecklistRun(run, anelia, [], { seeAll: false }), true)
})

test("limpieza does not see a run assigned to another collaborator", () => {
  const run = {
    id: "run-other",
    status: "pending",
    assigned_profile_id: "other-id",
    assigned_role: "limpieza",
    area: "Limpieza"
  }
  assert.equal(canSeeChecklistRun(run, anelia, [], { seeAll: false }), false)
})
