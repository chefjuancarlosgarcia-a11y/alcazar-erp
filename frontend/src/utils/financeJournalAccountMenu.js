export const ACCOUNT_MENU_GAP = 8
export const ACCOUNT_MENU_MAX_HEIGHT = 192
export const ACCOUNT_MENU_Z_INDEX = 1100
export const ACCOUNT_MENU_LIMIT = 8

/** Pendiente: elegir sugerencias con flechas y Enter. La selección actual es por clic. */
export const ACCOUNT_MENU_KEYBOARD_SELECTION_PENDING =
  "Pendiente: elegir sugerencias con flechas y Enter. La selección actual es por clic."

export function accountSelectionLabel(account) {
  return `${account.code} — ${account.name}`
}

export function filterAccountSuggestions(accounts, query, limit = ACCOUNT_MENU_LIMIT) {
  const q = String(query || "").trim().toLowerCase()
  const matched = (accounts || []).filter((account) => {
    if (!q) return true
    const label = accountSelectionLabel(account).toLowerCase()
    return account.code.toLowerCase().includes(q)
      || account.name.toLowerCase().includes(q)
      || label.includes(q)
  })
  return matched.slice(0, limit)
}

export function clearedAccountSelectionPatch() {
  return {
    account_id: "",
    account_code: "",
    account_label: "",
    branch_id: "",
    cost_center_id: ""
  }
}

export function applyAccountQueryChange(line, nextQuery) {
  const query = String(nextQuery ?? "")
  const selectedLabel = String(line?.account_label ?? "")
  const hasSelection = Boolean(line?.account_id) || selectedLabel !== ""
  if (hasSelection && query !== selectedLabel) {
    return { query, linePatch: clearedAccountSelectionPatch() }
  }
  return { query, linePatch: null }
}

export function selectedAccountLinePatch(account, line) {
  return {
    account_id: account.id,
    account_code: account.code,
    account_label: accountSelectionLabel(account),
    branch_id: account.branch_dimension_rule === "prohibited" ? "" : line?.branch_id || "",
    cost_center_id: account.cost_center_dimension_rule === "prohibited" ? "" : line?.cost_center_id || ""
  }
}

export function applyLineAccountQuery(lines, queries, index, nextQuery) {
  const line = lines[index]
  const { query, linePatch } = applyAccountQueryChange(line, nextQuery)
  return {
    lines: lines.map((row, rowIndex) => (
      rowIndex === index && linePatch ? { ...row, ...linePatch } : row
    )),
    queries: { ...queries, [index]: query }
  }
}

export function applyLineAccountSelection(lines, queries, index, account) {
  const patch = selectedAccountLinePatch(account, lines[index])
  return {
    lines: lines.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    queries: { ...queries, [index]: patch.account_label }
  }
}

export function computeAccountMenuPosition({
  anchor,
  viewport,
  menuHeight,
  gap = ACCOUNT_MENU_GAP
}) {
  const maxWidth = Math.max(0, viewport.width - gap * 2)
  const width = Math.min(Math.max(anchor.width, 0), maxWidth)
  const spaceBelow = viewport.height - anchor.bottom - gap
  const spaceAbove = anchor.top - gap
  const fitsBelow = spaceBelow >= menuHeight
  const fitsAbove = spaceAbove >= menuHeight
  const placement = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow) ? "above" : "below"
  const unclampedTop = placement === "above"
    ? anchor.top - gap - menuHeight
    : anchor.bottom + gap
  const maxTop = Math.max(gap, viewport.height - menuHeight - gap)
  const top = Math.min(Math.max(unclampedTop, gap), maxTop)
  const maxLeft = Math.max(gap, viewport.width - width - gap)
  const left = Math.min(Math.max(anchor.left, gap), maxLeft)
  return { top, left, width, placement }
}

export function bindAccountMenuViewportListeners(targets, handlers) {
  const win = targets.window
  const doc = targets.document
  const onReposition = () => handlers.onReposition()
  const onPointerDown = (event) => handlers.onPointerDown(event)
  const onKeyDown = (event) => handlers.onKeyDown(event)

  win.addEventListener("scroll", onReposition, true)
  win.addEventListener("resize", onReposition)
  doc.addEventListener("pointerdown", onPointerDown, true)
  doc.addEventListener("keydown", onKeyDown)

  return function unbindAccountMenuViewportListeners() {
    win.removeEventListener("scroll", onReposition, true)
    win.removeEventListener("resize", onReposition)
    doc.removeEventListener("pointerdown", onPointerDown, true)
    doc.removeEventListener("keydown", onKeyDown)
  }
}
