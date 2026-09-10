import assert from "node:assert/strict"
import test from "node:test"
import {
  applyQuotesLoadResult,
  canDownloadQuotePdf,
  EMPTY_QUOTES_SUMMARY,
  getQuoteDownloadLabel,
  normalizeCateringRequestQuotesPayload,
  resolveSyncExpiredWarning,
  runQuotePdfDownload,
  SYNC_EXPIRED_WARNING_COPY
} from "./cateringQuoteHistoryUtils.js"

test("normalizeCateringRequestQuotesPayload returns empty shape for invalid data", () => {
  assert.deepEqual(normalizeCateringRequestQuotesPayload(null), EMPTY_QUOTES_SUMMARY)
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

test("applyQuotesLoadResult clears previous summary on RPC error", () => {
  const previous = {
    count: 3,
    latest: { quote_number: "CAT-OLD" },
    quotes: [{ id: "old" }]
  }
  const next = applyQuotesLoadResult(previous, { error: "cannot execute UPDATE in a read-only transaction" })
  assert.deepEqual(next.summary, EMPTY_QUOTES_SUMMARY)
  assert.match(next.error, /read-only transaction/)
})

test("applyQuotesLoadResult keeps error and empty mutually exclusive from success payload", () => {
  const success = applyQuotesLoadResult(EMPTY_QUOTES_SUMMARY, {
    data: { count: 1, latest: { id: "q1" }, quotes: [{ id: "q1" }] }
  })
  assert.equal(success.error, "")
  assert.equal(success.summary.count, 1)
})

test("resolveSyncExpiredWarning returns warning copy when sync fails", () => {
  assert.equal(resolveSyncExpiredWarning({ error: "timeout" }), SYNC_EXPIRED_WARNING_COPY)
  assert.equal(resolveSyncExpiredWarning({ data: 0 }), "")
})

test("runQuotePdfDownload resets via onFinish when generator throws", async () => {
  let downloadingId = "quote-1"
  const result = await runQuotePdfDownload({
    quoteId: "quote-1",
    downloadFn: async () => {
      throw new Error("PDF engine failure")
    },
    onStart: (quoteId) => {
      downloadingId = quoteId
    },
    onFinish: () => {
      downloadingId = ""
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /generar el PDF/)
  assert.equal(downloadingId, "")
})

test("runQuotePdfDownload surfaces service error without throwing", async () => {
  const result = await runQuotePdfDownload({
    quoteId: "quote-2",
    downloadFn: async () => ({ ok: false, error: "Detalle no disponible" }),
    onStart: () => {},
    onFinish: () => {}
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, "Detalle no disponible")
})

test("runQuotePdfDownload skips duplicate concurrent attempts when caller guards", async () => {
  let calls = 0
  await runQuotePdfDownload({
    quoteId: "quote-3",
    downloadFn: async () => {
      calls += 1
      return { ok: true }
    },
    onStart: () => {},
    onFinish: () => {}
  })
  assert.equal(calls, 1)
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
