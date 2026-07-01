const CHECK_CONSTRAINT_PATTERNS = [
  "area_inventory_quantity_check",
  "quantity_check"
]

export function formatRequisitionFulfillmentError(message) {
  return String(message || "").trim()
}

export function mapRequisitionError(error) {
  if (!error) return "No se pudo completar la operación de requisición."
  const message = String(error.message || error.details || "").trim()
  const lower = message.toLowerCase()

  if (!message) return "No se pudo completar la operación de requisición."

  if (CHECK_CONSTRAINT_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return "No hay suficiente inventario para surtir este producto. Verifica las cantidades disponibles en el almacén."
  }

  if (lower.includes("configuracion anterior del producto") || lower.includes("configuración anterior del producto")) {
    return message
  }

  if (lower.includes("no hay suficiente inventario para surtir")) {
    return formatRequisitionFulfillmentError(message)
  }

  if (lower.includes("no esta configurada para el producto") || lower.includes("no está configurada para el producto")) {
    return "No existe conversión configurada para la unidad solicitada."
  }

  if (lower.includes("la cantidad entregada") && lower.includes("superar lo solicitado")) {
    return message
  }

  if (lower.includes("permission") || lower.includes("row-level security") || lower.includes("not authorized")) {
    return "No tienes permisos para realizar esta acción en requisiciones."
  }

  if (lower.includes("invalid input syntax") || lower.includes("numeric")) {
    return "Revisa las cantidades ingresadas antes de continuar."
  }

  return message
}

export function hasCriticalInventoryUnitChange(previousItem, nextForm) {
  if (!previousItem) return false
  const normalize = (value) => String(value || "").trim().toLowerCase()
  return (
    normalize(previousItem.base_unit) !== normalize(nextForm.base_unit)
    || normalize(previousItem.purchase_unit) !== normalize(nextForm.purchase_unit)
    || normalize(previousItem.default_requisition_unit || previousItem.base_unit)
      !== normalize(nextForm.default_requisition_unit || nextForm.base_unit)
    || Number(previousItem.conversion_factor || 1) !== Number(nextForm.conversion_factor || 1)
  )
}
