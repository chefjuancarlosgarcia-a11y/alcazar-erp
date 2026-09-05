import assert from "node:assert/strict"
import test from "node:test"
import {
  canDownloadQuotePdf,
  getQuoteDownloadLabel,
  normalizeCateringRequestQuotesPayload
} from "./cateringQuoteHistoryUtils.js"

test("normalizeCateringRequestQuotesPayload returns empty shape for invalid data", () => {
  assert.deepEqual(normalizeCateringRequestQuotesPayload(null), {
    count: 0,
    latest: null,
    quotes: []
  })
})

test("normalizeCateringRequestQuotesPayload preserves quotes array", () => {
  const payload = {
    count: 2,
    latest: { id: "q2", quote_number: "CAT-2" },
    quotes: [{ id: "q1" }, { id: "q2" }]
  }
  assert.deepEqual(normalizeCateringRequestQuotesPayload(payload), payload)
})

test("normalizeCateringRequestQuotesPayload coerces missing quotes to empty array", () => {
  const normalized = normalizeCateringRequestQuotesPayload({ count: 1, latest: null })
  assert.deepEqual(normalized.quotes, [])
  assert.equal(normalized.count, 1)
})

test("canDownloadQuotePdf distinguishes draft from issued quotes", () => {
  assert.equal(canDownloadQuotePdf("draft"), false)
  assert.equal(canDownloadQuotePdf("sent"), true)
  assert.equal(canDownloadQuotePdf("approved"), true)
})

test("getQuoteDownloadLabel matches quote status", () => {
  assert.equal(getQuoteDownloadLabel("draft"), "Descargar borrador")
  assert.equal(getQuoteDownloadLabel("sent"), "Descargar PDF")
})
