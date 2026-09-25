import assert from "node:assert/strict"
import test from "node:test"
import { applySelectionPatchAfterPersistResult, selectionPatchAfterPersistResult } from "./financeJournalEditorPersist.js"
import { persistJournalDraft, submitJournalEntryFlow } from "./financeJournalPersist.js"

const account = {
  id: "a1",
  code: "1.01",
  branch_dimension_rule: "optional",
  cost_center_dimension_rule: "optional"
}

const accountsById = new Map([[account.id, account]])

const validForm = {
  entry_date: "2026-08-01",
  description: "Prueba",
  reference: "",
  lines: [
    { account_id: "a1", branch_id: "", cost_center_id: "", description: "", reference: "", debit: "0.10", credit: "" },
    { account_id: "a1", branch_id: "", cost_center_id: "", description: "", reference: "", debit: "", credit: "0.10" }
  ]
}

test("selectionPatchAfterPersistResult binds selectedId and clears local draft flag", () => {
  assert.deepEqual(selectionPatchAfterPersistResult({ entryId: "ID-A", data: { id: "ID-A" } }), {
    selectedId: "ID-A",
    isLocalDraft: false
  })
  assert.equal(selectionPatchAfterPersistResult({ entryId: null }), null)
})

test("save draft then submit without close/reopen reuses ID-A and creates once", async () => {
  let createCount = 0
  let submitId = null
  const createdIds = []

  let selection = { selectedId: null, isLocalDraft: true }

  const createDraft = async () => {
    createCount += 1
    const id = "ID-A"
    createdIds.push(id)
    return { data: { id, status: "draft", lines: [] }, error: "" }
  }

  const replaceLines = async (entryId) => ({
    data: { id: entryId, status: "draft", lines: [] },
    error: ""
  })

  const saveResult = await persistJournalDraft({
    form: validForm,
    accountsById,
    entryId: selection.selectedId,
    isLocalDraft: selection.isLocalDraft,
    createDraft,
    replaceLines,
    reloadEntry: async () => ({ data: null, error: "" })
  })

  assert.equal(saveResult.ok, true)
  assert.equal(saveResult.entryId, "ID-A")
  selection = applySelectionPatchAfterPersistResult(selection, saveResult)
  assert.equal(selection.selectedId, "ID-A")
  assert.equal(selection.isLocalDraft, false)

  const submitResult = await submitJournalEntryFlow({
    form: validForm,
    accountsById,
    entryId: selection.selectedId,
    isLocalDraft: selection.isLocalDraft,
    createDraft: async () => {
      createCount += 1
      const id = "ID-B"
      createdIds.push(id)
      return { data: { id, status: "draft", lines: [] }, error: "" }
    },
    replaceLines,
    submitEntry: async (id) => {
      submitId = id
      return { data: { id, status: "pending_approval", lines: [] }, error: "" }
    },
    reloadEntry: async () => ({ data: null, error: "" })
  })

  assert.equal(submitResult.ok, true)
  assert.equal(createCount, 1)
  assert.equal(submitId, "ID-A")
  assert.deepEqual(createdIds, ["ID-A"])
  assert.equal(submitResult.entryId, "ID-A")
  assert.equal(submitResult.data.status, "pending_approval")
})

test("multiple saves on same draft do not recreate entry", async () => {
  let createCount = 0
  let selection = { selectedId: null, isLocalDraft: true }

  const createDraft = async () => {
    createCount += 1
    return { data: { id: "ID-A", status: "draft", lines: [] }, error: "" }
  }

  const replaceLines = async (entryId) => ({
    data: { id: entryId, status: "draft", lines: [] },
    error: ""
  })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await persistJournalDraft({
      form: validForm,
      accountsById,
      entryId: selection.selectedId,
      isLocalDraft: selection.isLocalDraft,
      createDraft,
      replaceLines,
      reloadEntry: async () => ({ data: null, error: "" })
    })
    assert.equal(result.ok, true)
    selection = applySelectionPatchAfterPersistResult(selection, result)
  }

  assert.equal(createCount, 1)
  assert.equal(selection.selectedId, "ID-A")
  assert.equal(selection.isLocalDraft, false)
})
