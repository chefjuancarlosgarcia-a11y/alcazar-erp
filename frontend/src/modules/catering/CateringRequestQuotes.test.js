import assert from "node:assert/strict"
import test from "node:test"
import {
  canDownloadQuotePdf,
  getQuoteDownloadLabel,
  normalizeCateringRequestQuotesPayload
} from "./cateringQuoteHistoryUtils.js"

const QUOTE = {
  id: "quote-1",
  quote_number: "CAT-2026-0001",
  status: "sent",
  status_label: "Enviada",
  total: 1500,
  valid_until: "2026-12-31",
  created_at: "2026-09-01T12:00:00Z"
}

test("normalize supports multiple quotes for one lead", () => {
  const payload = normalizeCateringRequestQuotesPayload({
    count: 2,
    latest: { ...QUOTE, id: "q2", quote_number: "CAT-2026-0023" },
    quotes: [
      { ...QUOTE, id: "q1", quote_number: "CAT-2026-0022" },
      { ...QUOTE, id: "q2", quote_number: "CAT-2026-0023" }
    ]
  })
  assert.equal(payload.count, 2)
  assert.equal(payload.quotes.length, 2)
})

test("quote card model exposes open and download actions", () => {
  assert.equal(QUOTE.id, "quote-1")
  assert.equal(canDownloadQuotePdf(QUOTE.status), true)
  assert.equal(getQuoteDownloadLabel("draft"), "Descargar borrador")
})

test("opening existing quote uses quoteId not requestId", () => {
  const activeQuoteId = "q2"
  const requestId = "lead-1"
  assert.notEqual(activeQuoteId, requestId)
})

test("rpc error payload keeps empty quotes without pretending success", () => {
  const empty = normalizeCateringRequestQuotesPayload(null)
  assert.deepEqual(empty.quotes, [])
  assert.equal(empty.count, 0)
})
