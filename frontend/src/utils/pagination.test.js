import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_PAGE_SIZE,
  formatPaginationLabel,
  normalizePaginationState,
  pageItems
} from "./pagination.js"

function buttonState(input) {
  const state = normalizePaginationState(input)
  return {
    ...state,
    previousDisabled: state.safePage <= 1,
    nextDisabled: state.safePage >= state.pages,
    label: formatPaginationLabel(state)
  }
}

test("normalizePaginationState hides controls for a single page", () => {
  const state = normalizePaginationState({ page: 1, total: 2, pageSize: 50 })
  assert.equal(state.showControls, false)
  assert.equal(state.pages, 1)
  assert.equal(state.safeTotal, 2)
  assert.ok(!String(state.pages).includes("NaN"))
})

test("normalizePaginationState shows 1 de 3 for 120 rows and pageSize 50", () => {
  const state = buttonState({ page: 1, total: 120, pageSize: 50 })
  assert.equal(state.showControls, true)
  assert.equal(state.label, "1 de 3 · 120 registros")
  assert.equal(state.previousDisabled, true)
  assert.equal(state.nextDisabled, false)
})

test("normalizePaginationState enables both directions on middle page", () => {
  const state = buttonState({ page: 2, total: 120, pageSize: 50 })
  assert.equal(state.label, "2 de 3 · 120 registros")
  assert.equal(state.previousDisabled, false)
  assert.equal(state.nextDisabled, false)
})

test("normalizePaginationState disables next on last page", () => {
  const state = buttonState({ page: 3, total: 120, pageSize: 50 })
  assert.equal(state.label, "3 de 3 · 120 registros")
  assert.equal(state.previousDisabled, false)
  assert.equal(state.nextDisabled, true)
})

test("normalizePaginationState accepts numeric strings", () => {
  const state = normalizePaginationState({ page: "2", total: "120", pageSize: "50" })
  assert.equal(state.safePage, 2)
  assert.equal(state.safeTotal, 120)
  assert.equal(state.safePageSize, 50)
})

test("normalizePaginationState fail-closed on invalid metadata", () => {
  const state = normalizePaginationState({ page: "bad", total: "bad", pageSize: 0 })
  assert.equal(state.safePage, 1)
  assert.equal(state.safeTotal, 0)
  assert.equal(state.safePageSize, DEFAULT_PAGE_SIZE)
  assert.equal(state.showControls, false)
  assert.ok(!formatPaginationLabel(state).includes("NaN"))
})

test("page click target uses normalized next page", () => {
  const current = normalizePaginationState({ page: 1, total: 120, pageSize: 50 })
  const nextPage = Math.min(current.safePage + 1, current.pages)
  assert.equal(nextPage, 2)
})

test("pageItems slices using normalized pagination", () => {
  const items = Array.from({ length: 120 }, (_, index) => index + 1)
  const pageOne = pageItems(items, 1, 50)
  const pageTwo = pageItems(items, 2, 50)
  assert.equal(pageOne.length, 50)
  assert.equal(pageOne[0], 1)
  assert.equal(pageTwo[0], 51)
})
