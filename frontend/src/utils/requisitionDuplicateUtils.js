export const DUPLICATION_MODES = {
  FULL: "full_duplicate",
  PENDING: "pending_only",
  TEMPLATE: "template"
}

export function getRequisitionDuplicateActions(status) {
  switch (status) {
    case "draft":
    case "pending":
    case "approved":
      return [{
        mode: DUPLICATION_MODES.FULL,
        label: "Duplicar con configuración actual",
        tone: "success"
      }]
    case "partially_fulfilled":
    case "pending_fulfillment":
      return [
        {
          mode: DUPLICATION_MODES.PENDING,
          label: "Duplicar pendientes",
          badge: "Recomendado",
          tone: "success"
        },
        {
          mode: DUPLICATION_MODES.FULL,
          label: "Duplicar completa",
          tone: "success"
        }
      ]
    case "completed":
      return [{
        mode: DUPLICATION_MODES.TEMPLATE,
        label: "Usar como plantilla",
        tone: "template"
      }]
    case "cancelled":
      return [{
        mode: DUPLICATION_MODES.TEMPLATE,
        label: "Usar como plantilla",
        tone: "warning",
        requiresCancelledConfirm: true
      }]
    default:
      return []
  }
}

/** @deprecated use getRequisitionDuplicateActions */
export function getRequisitionDuplicateConfig(status) {
  const actions = getRequisitionDuplicateActions(status)
  if (!actions.length) return null
  const first = actions[0]
  return {
    actionType: first.mode === DUPLICATION_MODES.TEMPLATE
      ? (status === "cancelled" ? "template_confirm" : "template")
      : actions.length > 1 ? "duplicate_partial" : "duplicate",
    label: first.label,
    modes: actions.map((action) => action.mode),
    requiresPartialChoice: actions.length > 1,
    requiresCancelledConfirm: Boolean(first.requiresCancelledConfirm)
  }
}

export function duplicateModeTitle(mode) {
  switch (mode) {
    case DUPLICATION_MODES.PENDING:
      return "Duplicar pendientes"
    case DUPLICATION_MODES.FULL:
      return "Duplicar con configuración actual"
    case DUPLICATION_MODES.TEMPLATE:
      return "Usar como plantilla"
    default:
      return "Duplicar requisición"
  }
}

export function duplicateModeDescription(mode, requisitionNumber) {
  const ref = requisitionNumber || "esta requisición"
  switch (mode) {
    case DUPLICATION_MODES.PENDING:
      return `Se creará una nueva requisición en borrador copiando solo las cantidades pendientes de ${ref}, recalculando unidades y stock con la configuración actual. La requisición original no cambiará.`
    case DUPLICATION_MODES.FULL:
      return `Se creará una nueva requisición en borrador con las mismas áreas, notas y cantidades solicitadas de ${ref}, recalculando unidades y stock con la configuración actual. La requisición original no cambiará.`
    case DUPLICATION_MODES.TEMPLATE:
      return `Se creará una nueva requisición en borrador basada en ${ref} como plantilla, usando la configuración actual del inventario. No quedará ligada operacionalmente como pendiente de la original.`
    default:
      return ""
  }
}

export function normalizeDuplicateWarnings(warnings) {
  if (!warnings) return []
  if (Array.isArray(warnings)) return warnings
  return []
}

export function buildDuplicateResultSummary(result) {
  const warnings = normalizeDuplicateWarnings(result?.warnings)
  return {
    requisitionNumber: result?.requisition_number || "",
    itemsCopied: Number(result?.items_copied || 0),
    itemsSkipped: Number(result?.items_skipped || 0),
    warningsCount: warnings.length,
    warnings
  }
}

export function buildDuplicateResultMessage(result) {
  const summary = buildDuplicateResultSummary(result)
  return `Se creó ${summary.requisitionNumber || "una nueva requisición"} utilizando la configuración actual.`
}

export function formatDuplicateWarning(warning) {
  if (!warning) return ""
  if (warning.message) return warning.message
  const name = warning.item_name || "Producto"
  if (warning.reason === "producto_inactivo") return `${name} está inactivo o ya no existe.`
  if (warning.reason === "sin_conversion") return `No existe conversión configurada para ${name}.`
  if (warning.reason === "sin_cantidad_pendiente") return `${name} no tiene cantidad pendiente.`
  return `${name} no pudo copiarse.`
}
