export const DEFAULT_PAGE_SIZE = 24

export function pageItems(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pages)
  const start = (safePage - 1) * pageSize
  return items.slice(start, start + pageSize)
}
