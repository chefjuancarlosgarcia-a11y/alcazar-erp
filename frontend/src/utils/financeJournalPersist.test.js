import assert from "node:assert/strict"
import test from "node:test"
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

test("partial failure: create ok, replace fails keeps entry id", async () => {
  let createCount = 0
  const result = await persistJournalDraft({
    form: validForm,
    accountsById,
    entryId: null,
    isLocalDraft: true,
    createDraft: async () => {
      createCount += 1
      return { data: { id: "draft-1", status: "draft", lines: [] }, error: "" }
    },
    replaceLines: async () => ({ data: null, error: "Líneas inválidas" }),
    reloadEntry: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" })
  })
  assert.equal(createCount, 1)
  assert.equal(result.partial, true)
  assert.equal(result.stage, "replace")
  assert.equal(result.entryId, "draft-1")
})

test("retry after partial create does not duplicate draft", async () => {
  let createCount = 0
  const first = await persistJournalDraft({
    form: validForm,
    accountsById,
    entryId: null,
    isLocalDraft: true,
    createDraft: async () => {
      createCount += 1
      return { data: { id: "draft-1", status: "draft", lines: [] }, error: "" }
    },
    replaceLines: async () => ({ data: null, error: "fallo" }),
    reloadEntry: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" })
  })
  assert.equal(first.entryId, "draft-1")

  const retry = await persistJournalDraft({
    form: validForm,
    accountsById,
    entryId: first.entryId,
    isLocalDraft: false,
    createDraft: async () => {
      createCount += 1
      return { data: { id: "draft-2" }, error: "" }
    },
    replaceLines: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" }),
    reloadEntry: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" })
  })
  assert.equal(createCount, 1)
  assert.equal(retry.ok, true)
  assert.equal(retry.entryId, "draft-1")
})

test("partial failure: replace ok submit fails", async () => {
  const result = await submitJournalEntryFlow({
    form: validForm,
    accountsById,
    entryId: null,
    isLocalDraft: true,
    createDraft: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" }),
    replaceLines: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" }),
    submitEntry: async () => ({ data: null, error: "Periodo cerrado" }),
    reloadEntry: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" })
  })
  assert.equal(result.partial, true)
  assert.equal(result.stage, "submit")
  assert.equal(result.submitFailed, true)
  assert.match(result.message, /no se pudo enviar/i)
})

test("successful submit flow", async () => {
  const result = await submitJournalEntryFlow({
    form: validForm,
    accountsById,
    entryId: "draft-1",
    isLocalDraft: false,
    createDraft: async () => assert.fail("should not create"),
    replaceLines: async () => ({ data: { id: "draft-1", status: "draft", lines: [] }, error: "" }),
    submitEntry: async () => ({ data: { id: "draft-1", status: "pending_approval", lines: [] }, error: "" }),
    reloadEntry: async () => ({ data: null, error: "" })
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.status, "pending_approval")
})
