export const DUPLICATION_MODES = {
  FULL: "full_duplicate",
  PENDING: "pending_only",
  TEMPLATE: "template"
}

export function getRequisitionDuplicateConfig(status) {
  switch (status) {
    case "draft":
    case "pending":
    case "approved":
      return {
        actionType: "duplicate",
        label: "Duplicar con configuración actual",
        modes: [DUPLICATION_MODES.FULL],
        requiresPartialChoice: false
      }
    case "partially_fulfilled":
    case "pending_fulfillment":
      return {
        actionType: "duplicate_partial",
        label: "Duplicar pendientes",
        modes: [DUPLICATION_MODES.PENDING, DUPLICATION_MODES.FULL],
        requiresPartialChoice: true
      }
    case "completed":
      return {
        actionType: "template",
        label: "Usar como plantilla",
        modes: [DUPLICATION_MODES.TEMPLATE],
        requiresPartialChoice: false
      }
    case "cancelled":
      return {
        actionType: "template_confirm",
        label: "Usar como plantilla",
        modes: [DUPLICATION_MODES.TEMPLATE],
        requiresPartialChoice: false,
        requiresCancelledConfirm: true
      }
    default:
      return null
  }
}

export function buildDuplicateResultMessage(result) {
  if (!result) return ""
  const copied = Number(result.items_copied || 0)
  const skipped = Number(result.items_skipped || 0)
  const parts = [`Se creó ${result.requisition_number || "la nueva requisición"} en borrador.`]
  parts.push(`${copied} producto${copied === 1 ? "" : "s"} copiado${copied === 1 ? "" : "s"}.`)
  if (skipped > 0) {
    parts.push(`${skipped} producto${skipped === 1 ? "" : "s"} omitido${skipped === 1 ? "" : "s"} y requiere${skipped === 1 ? "" : "n"} revisión.`)
  }
  return parts.join(" ")
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
