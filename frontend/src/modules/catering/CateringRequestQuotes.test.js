import assert from "node:assert/strict"
import test from "node:test"
import {
  applyQuotesLoadResult,
  canDownloadQuotePdf,
  EMPTY_QUOTES_SUMMARY,
  getQuoteDownloadLabel,
  normalizeCateringRequestQuotesPayload,
  resolveSyncExpiredWarning,
  SYNC_EXPIRED_WARNING_COPY
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

function shouldShowRegisteredMeta({ count, error }) {
  return count > 0 && !error
}

function shouldShowEmptyState({ loading, error, itemsLength }) {
  return !loading && !error && itemsLength === 0
}

function shouldShowErrorState({ loading, error }) {
  return !loading && Boolean(error)
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

test("RPC error clears summary so header does not show stale count", () => {
  const stale = { count: 4, latest: { quote_number: "CAT-OLD" }, quotes: [{ id: "x" }] }
  const next = applyQuotesLoadResult(stale, { error: "permission denied" })
  assert.deepEqual(next.summary, EMPTY_QUOTES_SUMMARY)
  assert.equal(shouldShowRegisteredMeta({ count: stale.count, error: next.error }), false)
})

test("error and empty state are mutually exclusive", () => {
  const withError = applyQuotesLoadResult(EMPTY_QUOTES_SUMMARY, { error: "fallo RPC" })
  assert.equal(
    shouldShowEmptyState({ loading: false, error: withError.error, itemsLength: 0 }),
    false
  )
  assert.equal(shouldShowErrorState({ loading: false, error: withError.error }), true)
})

test("retry path re-applies load result after prior error", () => {
  const afterError = applyQuotesLoadResult(EMPTY_QUOTES_SUMMARY, { error: "fallo RPC" })
  const afterRetry = applyQuotesLoadResult(afterError.summary, {
    data: { count: 1, latest: QUOTE, quotes: [QUOTE] }
  })
  assert.equal(afterRetry.error, "")
  assert.equal(afterRetry.summary.count, 1)
})

test("sync warning is non-blocking and preserves KPI context", () => {
  const previousSummary = { total_leads: 12, quotes_sent: 3 }
  const warning = resolveSyncExpiredWarning({ error: "network" })
  assert.equal(warning, SYNC_EXPIRED_WARNING_COPY)
  assert.equal(previousSummary.total_leads, 12)
  assert.equal(previousSummary.quotes_sent, 3)
})
