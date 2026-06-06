import { DEFAULT_PAGE_SIZE } from "../utils/pagination"

export default function PaginationControls({ page, total, pageSize = DEFAULT_PAGE_SIZE, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const safePage = Math.min(Math.max(1, page), pages)
  return (
    <div className="inventory-modal-actions">
      <button type="button" className="secondary" disabled={safePage <= 1} onClick={() => onChange(safePage - 1)}>Anterior</button>
      <span>{safePage} de {pages} · {total} registros</span>
      <button type="button" className="secondary" disabled={safePage >= pages} onClick={() => onChange(safePage + 1)}>Siguiente</button>
    </div>
  )
}
