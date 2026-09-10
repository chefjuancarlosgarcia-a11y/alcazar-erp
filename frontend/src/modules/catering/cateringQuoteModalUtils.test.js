import assert from "node:assert/strict"
import test from "node:test"
import {
  areQuoteEditorSnapshotsEqual,
  buildQuotePdfRow,
  duplicateQuoteItemAtIndex,
  emitCateringQuoteDraft,
  getQuoteDownloadActionLabel,
  getQuoteEditorLineKey,
  getQuoteEditorSnapshot,
  getQuoteEmitActionLabel,
  getStatusChangeBlockedReason,
  isDraftQuoteStatus,
  shouldPersistBeforeEmit,
  UNSAVED_STATUS_CHANGE_MESSAGE
} from "./cateringQuoteModalUtils.js"
import { createEmptyQuoteItem, groupQuoteItemsForEditor } from "./cateringQuoteTemplates.js"

const CLOSING_FIELDS = {
  discountAmount: "0",
  validUntil: "2026-09-01",
  notes: "Nota base",
  terms: "IVA incluido"
}

test("duplicateQuoteItemAtIndex inserts copy after original and reindexes sort_order", () => {
  const items = [
    { ...createEmptyQuoteItem(1), description: "Pizza", quantity: 2, unit_price: 50 },
    { ...createEmptyQuoteItem(2), description: "Bebida", quantity: 1, unit_price: 10 }
  ]

  const next = duplicateQuoteItemAtIndex(items, 0)

  assert.equal(next.length, 3)
  assert.equal(next[0].description, "Pizza")
  assert.equal(next[1].description, "Pizza")
  assert.equal(next[2].description, "Bebida")
  assert.deepEqual(next.map((item) => item.sort_order), [1, 2, 3])
  assert.notEqual(next[0], next[1])
})

test("duplicateQuoteItemAtIndex copies selected option as not selected and keeps original selected", () => {
  const items = [
    {
      ...createEmptyQuoteItem(1),
      description: "Menu Res",
      quantity: 10,
      unit_price: 85,
      line_kind: "option",
      option_group_name: "Plato fuerte",
      option_label: "Res",
      is_selected_option: true,
      section_name: "Banquete",
      section_order: 1,
      source_template_id: "tpl-1",
      source_template_name: "Banquete"
    },
    { ...createEmptyQuoteItem(2), description: "Postre", quantity: 10, unit_price: 15 }
  ]

  const next = duplicateQuoteItemAtIndex(items, 0)

  assert.equal(next.length, 3)
  assert.equal(next[0].is_selected_option, true)
  assert.equal(next[1].is_selected_option, false)
  assert.equal(next[1].option_group_name, "Plato fuerte")
  assert.equal(next[1].option_label, "Res")
  assert.equal(next[1].description, "Menu Res")
  assert.equal(next[1].section_name, "Banquete")
  assert.equal(next[1].source_template_id, "tpl-1")
  assert.deepEqual(next.map((item) => item.sort_order), [1, 2, 3])
})

test("getQuoteEditorSnapshot ignores empty placeholder lines when another line exists", () => {
  const snapshot = getQuoteEditorSnapshot({
    items: [
      createEmptyQuoteItem(1),
      { ...createEmptyQuoteItem(2), description: "Menu", quantity: 10, unit_price: 85 }
    ],
    discountAmount: "0",
    validUntil: "2026-09-01",
    notes: "",
    terms: "IVA incluido"
  })

  assert.equal(snapshot.items.length, 1)
  assert.equal(snapshot.items[0].description, "Menu")
})

test("getQuoteEditorSnapshot keeps placeholder when it is the only line", () => {
  const snapshot = getQuoteEditorSnapshot({
    items: [createEmptyQuoteItem(1)],
    ...CLOSING_FIELDS
  })

  assert.equal(snapshot.items.length, 1)
  assert.equal(snapshot.items[0].description, "")
})

test("areQuoteEditorSnapshotsEqual treats equivalent commercial content as clean", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: "10", unit_price: "85" }],
    discountAmount: "0",
    validUntil: "2026-09-01",
    notes: "",
    terms: "IVA incluido"
  })

  const current = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 10, unit_price: 85 }],
    discountAmount: 0,
    validUntil: "2026-09-01",
    notes: "",
    terms: "IVA incluido"
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), true)
})

test("areQuoteEditorSnapshotsEqual detects dirty discount changes", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    discountAmount: "0",
    validUntil: "2026-09-01",
    notes: "",
    terms: ""
  })

  const current = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    discountAmount: "5",
    validUntil: "2026-09-01",
    notes: "",
    terms: ""
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)
})

test("areQuoteEditorSnapshotsEqual detects removing a commercial line", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [
      { ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 },
      { ...createEmptyQuoteItem(2), description: "Bebida", quantity: 1, unit_price: 5 }
    ],
    ...CLOSING_FIELDS
  })

  const current = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)
})

test("areQuoteEditorSnapshotsEqual detects clearing the only commercial line", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS
  })

  const current = getQuoteEditorSnapshot({
    items: [createEmptyQuoteItem(1)],
    ...CLOSING_FIELDS
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)
})

test("areQuoteEditorSnapshotsEqual detects validUntil changes", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS
  })

  const current = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS,
    validUntil: "2026-10-01"
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)
})

test("areQuoteEditorSnapshotsEqual detects notes changes", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS
  })

  const current = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS,
    notes: "Nota actualizada"
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)
})

test("areQuoteEditorSnapshotsEqual detects terms changes", () => {
  const baseline = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS
  })

  const current = getQuoteEditorSnapshot({
    items: [{ ...createEmptyQuoteItem(1), description: "Menu", quantity: 1, unit_price: 10 }],
    ...CLOSING_FIELDS,
    terms: "Terminos actualizados"
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)
})

test("areQuoteEditorSnapshotsEqual detects option metadata changes", () => {
  const optionItem = {
    ...createEmptyQuoteItem(1),
    description: "Menu Res",
    quantity: 10,
    unit_price: 85,
    line_kind: "option",
    option_group_name: "Plato fuerte",
    option_label: "Res",
    is_selected_option: true
  }

  const baseline = getQuoteEditorSnapshot({
    items: [optionItem],
    ...CLOSING_FIELDS
  })

  const current = getQuoteEditorSnapshot({
    items: [
      { ...optionItem, option_group_name: "Plato fuerte premium" },
    ],
    ...CLOSING_FIELDS
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, current), false)

  const selectionChanged = getQuoteEditorSnapshot({
    items: [{ ...optionItem, is_selected_option: false }],
    ...CLOSING_FIELDS
  })

  assert.equal(areQuoteEditorSnapshotsEqual(baseline, selectionChanged), false)
})

test("getStatusChangeBlockedReason blocks status change when editor is dirty", () => {
  assert.equal(
    getStatusChangeBlockedReason({ isDirty: true, currentQuoteId: "quote-1" }),
    UNSAVED_STATUS_CHANGE_MESSAGE
  )
})

test("getStatusChangeBlockedReason allows status change when editor is clean", () => {
  assert.equal(
    getStatusChangeBlockedReason({ isDirty: false, currentQuoteId: "quote-1" }),
    null
  )
})

test("getStatusChangeBlockedReason requires a saved quote id before any transition", () => {
  assert.equal(
    getStatusChangeBlockedReason({ isDirty: false, currentQuoteId: null }),
    "Guarda la cotizacion antes de cambiar el estado."
  )
})

test("getQuoteEditorLineKey stays stable when description changes", () => {
  const index = 0
  const before = getQuoteEditorLineKey(index)
  const after = getQuoteEditorLineKey(index)

  assert.equal(before, after)
  assert.equal(before, "quote-line-0")
})

test("getQuoteEditorLineKey does not depend on editable field values", () => {
  const index = 1
  const itemBefore = {
    ...createEmptyQuoteItem(2),
    description: "P",
    option_label: "Res ",
    option_group_name: "Plato ",
    quantity: "1",
    unit_price: "10"
  }
  const itemAfter = {
    ...itemBefore,
    description: "Pizza completa",
    option_label: "Res premium ",
    option_group_name: "Plato fuerte ",
    quantity: "12",
    unit_price: "99.5"
  }

  assert.equal(getQuoteEditorLineKey(index), "quote-line-1")
  assert.equal(getQuoteEditorLineKey(index), "quote-line-1")
  assert.notEqual(itemBefore.description, itemAfter.description)
  assert.notEqual(itemBefore.quantity, itemAfter.quantity)
})

test("getQuoteEditorLineKey differs between distinct line indices", () => {
  assert.notEqual(getQuoteEditorLineKey(0), getQuoteEditorLineKey(1))
  assert.equal(getQuoteEditorLineKey(2), "quote-line-2")
})

test("groupQuoteItemsForEditor keeps original index for stable line identity", () => {
  const items = [
    { ...createEmptyQuoteItem(1), description: "P" },
    { ...createEmptyQuoteItem(2), description: "Bebida" }
  ]

  items[0].description = "Pizza completa"

  const groups = groupQuoteItemsForEditor(items)
  const indices = groups.flatMap((group) => group.lines.map((line) => line.index))

  assert.deepEqual(indices, [0, 1])
  assert.equal(getQuoteEditorLineKey(indices[0]), "quote-line-0")
})

test("isDraftQuoteStatus treats empty and draft as draft", () => {
  assert.equal(isDraftQuoteStatus(undefined), true)
  assert.equal(isDraftQuoteStatus("draft"), true)
  assert.equal(isDraftQuoteStatus("sent"), false)
  assert.equal(isDraftQuoteStatus("approved"), false)
})

test("shouldPersistBeforeEmit requires save for new or dirty quotes", () => {
  assert.equal(shouldPersistBeforeEmit({ currentQuoteId: null, isDirty: false }), true)
  assert.equal(shouldPersistBeforeEmit({ currentQuoteId: "q1", isDirty: true }), true)
  assert.equal(shouldPersistBeforeEmit({ currentQuoteId: "q1", isDirty: false }), false)
})

test("buildQuotePdfRow keeps draft watermark inputs until status is sent", () => {
  const draftRow = buildQuotePdfRow({
    quote: { quote_number: "CAT-2026-0001", status: "draft" },
    totals: { subtotal: 100, discount_amount: 0, total: 100 }
  })
  assert.equal(draftRow.status, "draft")
  assert.equal(draftRow.quote_number, "CAT-2026-0001")

  const sentRow = buildQuotePdfRow({
    quote: { quote_number: "CAT-2026-0001", status: "draft" },
    statusOverride: "sent"
  })
  assert.equal(sentRow.status, "sent")
})

test("buildQuotePdfRow forces draft override for borrador downloads", () => {
  const draftDownload = buildQuotePdfRow({
    quote: { quote_number: "CAT-2026-0001", status: "sent" },
    statusOverride: "draft"
  })
  assert.equal(draftDownload.status, "draft")
})

test("getQuoteDownloadActionLabel switches between draft and final download", () => {
  assert.equal(getQuoteDownloadActionLabel(true), "Descargar borrador")
  assert.equal(getQuoteDownloadActionLabel(false), "Descargar PDF")
})

test("getQuoteEmitActionLabel reflects emitting state", () => {
  assert.equal(getQuoteEmitActionLabel(false), "Emitir y descargar PDF")
  assert.equal(getQuoteEmitActionLabel(true), "Emitiendo…")
})

test("emitCateringQuoteDraft saves, marks sent, and returns persisted detail", async () => {
  const calls = []
  const result = await emitCateringQuoteDraft({
    currentQuoteId: null,
    requestId: "req-1",
    isDirty: true,
    payload: { items: [] },
    createQuote: async (requestId, payload) => {
      calls.push(["create", requestId, payload])
      return { data: { quote: { id: "q-new", status: "draft", quote_number: "CAT-2026-0002" }, items: [] } }
    },
    updateQuote: async () => ({ error: "unexpected update" }),
    updateStatus: async (quoteId, status) => {
      calls.push(["status", quoteId, status])
      return {
        data: {
          quote: { id: quoteId, status: "sent", quote_number: "CAT-2026-0002" },
          items: []
        }
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.detail.quote.status, "sent")
  assert.deepEqual(calls, [
    ["create", "req-1", { items: [] }],
    ["status", "q-new", "sent"]
  ])
})

test("emitCateringQuoteDraft updates dirty existing draft before marking sent", async () => {
  const calls = []
  const result = await emitCateringQuoteDraft({
    currentQuoteId: "q-dirty",
    requestId: "req-1",
    isDirty: true,
    payload: { items: [{ description: "Menu" }] },
    createQuote: async () => ({ error: "unexpected create" }),
    updateQuote: async (quoteId, payload) => {
      calls.push(["update", quoteId, payload])
      return {
        data: {
          quote: { id: quoteId, status: "draft", quote_number: "CAT-2026-0003" },
          items: []
        }
      }
    },
    updateStatus: async (quoteId, status) => {
      calls.push(["status", quoteId, status])
      return {
        data: {
          quote: { id: quoteId, status: "sent", quote_number: "CAT-2026-0003" },
          items: []
        }
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.detail.quote.status, "sent")
  assert.deepEqual(calls, [
    ["update", "q-dirty", { items: [{ description: "Menu" }] }],
    ["status", "q-dirty", "sent"]
  ])
})

test("emitCateringQuoteDraft skips save when draft is already clean", async () => {
  const calls = []
  const result = await emitCateringQuoteDraft({
    currentQuoteId: "q-clean",
    requestId: "req-1",
    isDirty: false,
    payload: { items: [] },
    createQuote: async () => ({ error: "unexpected create" }),
    updateQuote: async () => ({ error: "unexpected update" }),
    updateStatus: async (quoteId, status) => {
      calls.push(["status", quoteId, status])
      return { data: { quote: { id: quoteId, status: "sent" }, items: [] } }
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [["status", "q-clean", "sent"]])
})

test("emitCateringQuoteDraft stops before sent when save fails", async () => {
  const calls = []
  const result = await emitCateringQuoteDraft({
    currentQuoteId: null,
    requestId: "req-1",
    isDirty: true,
    payload: { items: [] },
    createQuote: async () => ({ error: "save failed" }),
    updateQuote: async () => ({ error: "save failed" }),
    updateStatus: async () => {
      calls.push(["status"])
      return { error: "should not run" }
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.stage, "save")
  assert.equal(result.error, "save failed")
  assert.deepEqual(calls, [])
})

test("emitCateringQuoteDraft keeps draft when status change fails", async () => {
  const result = await emitCateringQuoteDraft({
    currentQuoteId: "q-1",
    requestId: "req-1",
    isDirty: false,
    payload: { items: [] },
    createQuote: async () => ({ error: "unexpected" }),
    updateQuote: async () => ({ error: "unexpected" }),
    updateStatus: async () => ({ error: "status failed" })
  })

  assert.equal(result.ok, false)
  assert.equal(result.stage, "status")
  assert.equal(result.error, "status failed")
  assert.equal(result.quoteId, "q-1")
})
