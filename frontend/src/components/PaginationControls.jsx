import {
  DEFAULT_PAGE_SIZE,
  formatPaginationLabel,
  normalizePaginationState
} from "../utils/pagination"

export default function PaginationControls({ page, total, pageSize = DEFAULT_PAGE_SIZE, onChange }) {
  const { safePage, safeTotal, pages, showControls } = normalizePaginationState({
    page,
    total,
    pageSize
  })
  if (!showControls) return null

  function goToPage(nextPage) {
    if (typeof onChange === "function") {
      onChange(nextPage)
    }
  }

  return (
    <div className="inventory-modal-actions">
      <button
        type="button"
        className="secondary"
        disabled={safePage <= 1}
        onClick={() => goToPage(safePage - 1)}
      >
        Anterior
      </button>
      <span>{formatPaginationLabel({ safePage, pages, safeTotal })}</span>
      <button
        type="button"
        className="secondary"
        disabled={safePage >= pages}
        onClick={() => goToPage(safePage + 1)}
      >
        Siguiente
      </button>
    </div>
  )
}
