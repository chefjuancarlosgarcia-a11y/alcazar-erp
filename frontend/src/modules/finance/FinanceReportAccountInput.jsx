import { useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ACCOUNT_MENU_KEYBOARD_SELECTION_PENDING,
  ACCOUNT_MENU_MAX_HEIGHT,
  ACCOUNT_MENU_Z_INDEX,
  accountSelectionLabel,
  bindAccountMenuViewportListeners,
  computeAccountMenuPosition,
  filterAccountSuggestions
} from "../../utils/financeJournalAccountMenu"
import { reportAccountStatusMarks } from "../../utils/financeGeneralLedgerUtils"

function placeAccountMenu(input, menu) {
  const anchor = input.getBoundingClientRect()
  const menuHeight = Math.min(menu.scrollHeight, ACCOUNT_MENU_MAX_HEIGHT)
  const next = computeAccountMenuPosition({
    anchor: {
      top: anchor.top,
      bottom: anchor.bottom,
      left: anchor.left,
      width: anchor.width
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    menuHeight
  })
  menu.style.top = `${next.top}px`
  menu.style.left = `${next.left}px`
  menu.style.width = `${next.width}px`
  menu.dataset.placement = next.placement
  menu.style.visibility = "visible"
}

export default function FinanceReportAccountInput({
  id,
  query,
  accountId,
  accounts,
  onQueryChange,
  onSelectAccount
}) {
  const inputRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const hintId = useId()
  const suggestions = filterAccountSuggestions(accounts, query)
  const hasQuery = String(query || "").trim() !== ""
  const unbound = Boolean(hasQuery && !accountId)
  const showMenu = Boolean(open && (suggestions.length > 0 || hasQuery))
  const suggestionKey = suggestions.map((account) => account.id).join(",")

  useLayoutEffect(() => {
    if (!showMenu) return undefined
    const input = inputRef.current
    const menu = menuRef.current
    if (!input || !menu || typeof document === "undefined") return undefined

    const reposition = () => placeAccountMenu(input, menu)
    reposition()

    const unbind = bindAccountMenuViewportListeners(
      { window, document },
      {
        onReposition: reposition,
        onPointerDown: (event) => {
          const target = event.target
          if (input.contains(target) || menu.contains(target)) return
          setOpen(false)
        },
        onKeyDown: (event) => {
          if (event.key === "Escape") setOpen(false)
        }
      }
    )

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(reposition) : null
    observer?.observe(input)

    return () => {
      unbind()
      observer?.disconnect()
    }
  }, [showMenu, query, suggestionKey])

  const menu = showMenu ? (
    <div
      ref={menuRef}
      id={listId}
      className="finance-journal-account-menu"
      role="listbox"
      aria-label="Cuentas de detalle para el Libro Mayor"
      style={{
        position: "fixed",
        zIndex: ACCOUNT_MENU_Z_INDEX,
        visibility: "hidden",
        maxHeight: ACCOUNT_MENU_MAX_HEIGHT
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {suggestions.length ? suggestions.map((account) => {
        const marks = reportAccountStatusMarks(account)
        return (
          <button
            key={account.id}
            type="button"
            className="finance-journal-account-option finance-ledger-account-option"
            role="option"
            onClick={() => {
              onSelectAccount(account)
              setOpen(false)
            }}
          >
            <span>{accountSelectionLabel(account)}</span>
            {marks.length ? (
              <span className="finance-ledger-account-marks">
                {marks.map((mark) => (
                  <span key={mark} className="finance-badge finance-ledger-account-mark">{mark}</span>
                ))}
              </span>
            ) : null}
          </button>
        )
      }) : (
        <p className="finance-journal-account-menu__empty">Ninguna cuenta de detalle coincide. Elija una opción de la lista.</p>
      )}
    </div>
  ) : null

  return (
    <div className="finance-journal-account-field" data-keyboard-pending={ACCOUNT_MENU_KEYBOARD_SELECTION_PENDING}>
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        aria-controls={showMenu ? listId : undefined}
        aria-invalid={unbound}
        aria-describedby={unbound ? hintId : undefined}
        value={query}
        placeholder="Código o nombre de cuenta de detalle"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (menuRef.current?.contains(event.relatedTarget)) return
          setOpen(false)
        }}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {unbound ? (
        <p className="finance-journal-account-hint" id={hintId}>
          Elija una opción de la lista. El texto escrito no vincula la cuenta.
        </p>
      ) : null}
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  )
}
