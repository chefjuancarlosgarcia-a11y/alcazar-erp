import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { catalogStatusLabel, filterPosProductQuickSearch } from "../utils/posCatalogFilters"

function productNeedsConfiguration(product) {
  const type = product?.productType || product?.product_type
  return type === "pizza"
    || (product?.modifierOptions || product?.modifiers || []).some((modifier) => modifier?.isActive !== false && modifier?.is_active !== false)
    || product?.allowKitchenNotes === true
    || product?.allow_kitchen_notes === true
}

const PosProductQuickSearch = forwardRef(function PosProductQuickSearch({
  items,
  getRecipe,
  getItemState,
  getProductBasePrice,
  productCategoryId,
  posCategories,
  onAddProduct
}, ref) {
  const listboxId = useId()
  const containerRef = useRef(null)
  const dropdownRef = useRef(null)
  const addButtonRef = useRef(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [pendingProduct, setPendingProduct] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [adding, setAdding] = useState(false)
  const [dropdownRect, setDropdownRect] = useState(null)

  const results = useMemo(
    () => filterPosProductQuickSearch(items, query, getRecipe, 12),
    [items, query, getRecipe]
  )

  const showDropdown = open && query.trim().length > 0

  useEffect(() => {
    setHighlightIndex(0)
  }, [query, results.length])

  useLayoutEffect(() => {
    if (!showDropdown || !containerRef.current) {
      setDropdownRect(null)
      return undefined
    }

    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setDropdownRect({
        top: rect.bottom + 8,
        left: rect.left,
        width: Math.max(rect.width, 360)
      })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [showDropdown, query, pendingProduct, results.length])

  useEffect(() => {
    function handlePointerDown(event) {
      if (containerRef.current?.contains(event.target)) return
      if (dropdownRef.current?.contains(event.target)) return
      closeAll()
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [])

  function getCategoryLabel(product) {
    const categoryId = productCategoryId(product)
    return posCategories.find((category) => category.id === categoryId)?.name
      || product.categoria
      || product.categoryName
      || "Sin categoría"
  }

  function getCategoryColor(product) {
    const categoryId = productCategoryId(product)
    return posCategories.find((category) => category.id === categoryId)?.color || "#0d9488"
  }

  function formatPrice(product) {
    const productType = product.productType || product.product_type
    if (productType === "pizza") {
      return `Desde Q${Number(getProductBasePrice(product) || 0).toFixed(2)}`
    }
    return `Q${Number(product.precio ?? product.price ?? 0).toFixed(2)}`
  }

  function closeAll() {
    setOpen(false)
    setPendingProduct(null)
    setQuantity(1)
    setHighlightIndex(0)
  }

  function resetSearch() {
    setQuery("")
    closeAll()
  }

  function openPendingProduct(product) {
    setPendingProduct(product)
    setQuantity(1)
    setOpen(true)
    window.setTimeout(() => addButtonRef.current?.focus(), 0)
  }

  async function handleConfirmAdd() {
    if (!pendingProduct || adding) return
    setAdding(true)
    try {
      const result = await onAddProduct(pendingProduct, quantity)
      if (result !== false) resetSearch()
    } finally {
      setAdding(false)
    }
  }

  function handleResultClick(product) {
    openPendingProduct(product)
  }

  function handleKeyDown(event) {
    if (pendingProduct) {
      if (event.key === "Enter") {
        event.preventDefault()
        handleConfirmAdd()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setPendingProduct(null)
        setQuantity(1)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setQuantity((current) => Math.max(1, current - 1))
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setQuantity((current) => Math.min(99, current + 1))
      }
      return
    }

    if (!open && event.key !== "Escape") {
      if (query.trim()) setOpen(true)
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!results.length) return
      setOpen(true)
      setHighlightIndex((current) => (current + 1) % results.length)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (!results.length) return
      setOpen(true)
      setHighlightIndex((current) => (current - 1 + results.length) % results.length)
      return
    }

    if (event.key === "Enter") {
      if (!open || !results.length) return
      event.preventDefault()
      openPendingProduct(results[highlightIndex])
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeAll()
    }
  }

  const dropdownContent = showDropdown && dropdownRect ? (
    <div
      ref={dropdownRef}
      className="pos-quick-search__dropdown pos-quick-search__dropdown--portal"
      role="listbox"
      id={listboxId}
      style={{
        top: dropdownRect.top,
        left: dropdownRect.left,
        width: dropdownRect.width
      }}
    >
      {pendingProduct ? (
        <div className="pos-quick-search__confirm">
          <div className="pos-quick-search__confirm-head">
            <strong>{pendingProduct.nombre || pendingProduct.name}</strong>
            <span className="pos-quick-search__price">{formatPrice(pendingProduct)}</span>
          </div>
          <span
            className="pos-quick-search__category"
            style={{ "--pos-quick-cat-color": getCategoryColor(pendingProduct) }}
          >
            {getCategoryLabel(pendingProduct)}
          </span>
          {productNeedsConfiguration(pendingProduct) ? (
            <p className="pos-quick-search__confirm-note">
              Este platillo requiere configuración. Se abrirá el selector de tamaño o extras.
            </p>
          ) : null}
          <div className="pos-quick-search__quantity">
            <span>Cantidad</span>
            <div className="pos-quick-search__quantity-controls">
              <button
                type="button"
                className="pos-quick-search__qty-btn"
                aria-label="Disminuir cantidad"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              >
                −
              </button>
              <strong>{quantity}</strong>
              <button
                type="button"
                className="pos-quick-search__qty-btn"
                aria-label="Aumentar cantidad"
                onClick={() => setQuantity((current) => Math.min(99, current + 1))}
              >
                +
              </button>
            </div>
          </div>
          <div className="pos-quick-search__confirm-actions">
            <button
              ref={addButtonRef}
              type="button"
              className="pos-quick-search__add-btn"
              disabled={adding}
              onClick={handleConfirmAdd}
            >
              {adding ? "Agregando..." : "Agregar a mesa"}
            </button>
            <button
              type="button"
              className="pos-quick-search__cancel-btn"
              disabled={adding}
              onClick={() => {
                setPendingProduct(null)
                setQuantity(1)
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : results.length ? results.map((product, index) => {
        const state = getItemState(product)
        const available = state.active && (state.saleAllowed ?? state.productionReady)
        return (
          <button
            key={product.id}
            type="button"
            role="option"
            aria-selected={highlightIndex === index}
            className={`pos-quick-search__option${highlightIndex === index ? " is-highlighted" : ""}${available ? "" : " is-unavailable"}`}
            onMouseEnter={() => setHighlightIndex(index)}
            onClick={() => handleResultClick(product)}
          >
            <div className="pos-quick-search__option-main">
              <strong>{product.nombre || product.name}</strong>
              <span
                className="pos-quick-search__category"
                style={{ "--pos-quick-cat-color": getCategoryColor(product) }}
              >
                {getCategoryLabel(product)}
              </span>
            </div>
            <div className="pos-quick-search__option-meta">
              <span className="pos-quick-search__price">{formatPrice(product)}</span>
              <span className={`pos-quick-search__status${available ? " is-available" : " is-unavailable"}`}>
                {available ? "Disponible" : catalogStatusLabel(state)}
              </span>
            </div>
          </button>
        )
      }) : (
        <div className="pos-quick-search__empty">No se encontraron productos.</div>
      )}
    </div>
  ) : null

  return (
    <>
      <div className="pos-quick-search" ref={containerRef}>
        <label className="pos-quick-search__field">
          <span className="pos-quick-search__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
          <input
            ref={ref}
            type="search"
            className="pos-quick-search__input"
            placeholder="Buscar producto rápido…"
            value={query}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setPendingProduct(null)
              setQuantity(1)
              setOpen(true)
            }}
            onFocus={() => { if (query.trim()) setOpen(true) }}
            onKeyDown={handleKeyDown}
          />
        </label>
      </div>
      {dropdownContent ? createPortal(dropdownContent, document.body) : null}
    </>
  )
})

export default PosProductQuickSearch
