import assert from "node:assert/strict"
import test from "node:test"
import { removeEntrySearchParam } from "./financeJournalUrl.js"

test("removeEntrySearchParam removes only entry", () => {
  const current = new URLSearchParams("tab=partidas&entry=e1&foo=bar")
  const next = removeEntrySearchParam(current)
  assert.ok(next)
  assert.equal(next.get("tab"), "partidas")
  assert.equal(next.get("entry"), null)
  assert.equal(next.get("foo"), "bar")
})

test("removeEntrySearchParam returns null when entry absent", () => {
  const current = new URLSearchParams("tab=partidas")
  assert.equal(removeEntrySearchParam(current), null)
})
