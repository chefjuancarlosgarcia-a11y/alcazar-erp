import assert from "node:assert/strict"
import test from "node:test"
import { checklistAssignmentMatchesRun, checklistDueTimeKey } from "./checklistAssignmentMatch.js"

test("due time key ignores seconds from the database", () => {
  assert.equal(checklistDueTimeKey("14:00:00"), "14:00")
  assert.equal(checklistDueTimeKey("14:00"), "14:00")
  assert.equal(checklistDueTimeKey(""), null)
  assert.equal(checklistDueTimeKey(null), null)
})

test("in-place reassignment matches profile, role, area and time", () => {
  const run = {
    assigned_profile_id: "8e6acf10-2ac5-47c9-b59e-e5688c8e09b9",
    assigned_role: "barista",
    area: "Cafeteria",
    due_time: "14:00:00",
    status: "in_progress"
  }
  assert.equal(checklistAssignmentMatchesRun(run, {
    assigned_profile_id: "8e6acf10-2ac5-47c9-b59e-e5688c8e09b9",
    assigned_role: "barista",
    area: "Cafeteria",
    due_time: "14:00"
  }), true)
  assert.equal(checklistAssignmentMatchesRun(run, {
    assigned_profile_id: "11111111-1111-4111-8111-111111111111",
    assigned_role: "barista",
    area: "Cafeteria",
    due_time: "14:00"
  }), false)
})

test("blank form values match nulls, and a leftover assignee does not", () => {
  assert.equal(checklistAssignmentMatchesRun({
    assigned_profile_id: null,
    assigned_role: null,
    area: null,
    due_time: null
  }, {
    assigned_profile_id: "",
    assigned_role: "  ",
    area: "",
    due_time: ""
  }), true)

  assert.equal(checklistAssignmentMatchesRun({
    assigned_profile_id: "8e6acf10-2ac5-47c9-b59e-e5688c8e09b9",
    assigned_role: "barista",
    area: "Cafeteria",
    due_time: "14:00:00"
  }, {
    assigned_profile_id: "",
    assigned_role: "",
    area: "",
    due_time: ""
  }), false)
})
