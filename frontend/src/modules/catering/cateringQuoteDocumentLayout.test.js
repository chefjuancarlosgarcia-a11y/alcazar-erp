import assert from "node:assert/strict"
import test from "node:test"
import { buildQuoteDocumentMeta } from "./cateringQuoteDocumentLayout.js"

test("buildQuoteDocumentMeta marks numbered draft quotes as draft watermark", () => {
  const meta = buildQuoteDocumentMeta({
    quoteNumber: "CAT-2026-0001",
    quoteStatus: "draft",
    validUntil: "2026-09-01"
  })

  assert.equal(meta.isDraft, true)
  assert.equal(meta.quoteNumber, "CAT-2026-0001")
})

test("buildQuoteDocumentMeta removes draft watermark for sent numbered quotes", () => {
  const meta = buildQuoteDocumentMeta({
    quoteNumber: "CAT-2026-0001",
    quoteStatus: "sent",
    validUntil: "2026-09-01"
  })

  assert.equal(meta.isDraft, false)
  assert.equal(meta.quoteNumber, "CAT-2026-0001")
})

test("buildQuoteDocumentMeta removes draft watermark for approved quotes", () => {
  const meta = buildQuoteDocumentMeta({
    quoteNumber: "CAT-2026-0001",
    quoteStatus: "approved",
    validUntil: "2026-09-01"
  })

  assert.equal(meta.isDraft, false)
})

test("buildQuoteDocumentMeta treats missing quote number as BORRADOR draft", () => {
  const meta = buildQuoteDocumentMeta({
    quoteNumber: "",
    quoteStatus: "draft",
    validUntil: "2026-09-01"
  })

  assert.equal(meta.isDraft, true)
  assert.equal(meta.quoteNumber, "BORRADOR")
})
