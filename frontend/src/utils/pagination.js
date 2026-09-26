export const DEFAULT_PAGE_SIZE = 24

function safeNonNegativeInt(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

function safePositiveInt(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.floor(parsed)
}

export function normalizePaginationState({ page, total, pageSize = DEFAULT_PAGE_SIZE }) {
  const safeTotal = safeNonNegativeInt(total, 0)
  const safePageSize = safePositiveInt(pageSize, DEFAULT_PAGE_SIZE)
  const safePage = safePositiveInt(page, 1)
  const pages = Math.max(1, Math.ceil(safeTotal / safePageSize))
  const clampedPage = Math.min(safePage, pages)
  return {
    safePage: clampedPage,
    safeTotal,
    safePageSize,
    pages,
    showControls: pages > 1
  }
}

export function formatPaginationLabel({ safePage, pages, safeTotal }) {
  return `${safePage} de ${pages} · ${safeTotal} registros`
}

export function pageItems(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  const { safePage, safePageSize } = normalizePaginationState({
    page,
    total: items.length,
    pageSize
  })
  const start = (safePage - 1) * safePageSize
  return items.slice(start, start + safePageSize)
}
