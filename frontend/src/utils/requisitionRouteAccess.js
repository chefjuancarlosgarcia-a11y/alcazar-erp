/**
 * Legacy /inventory?section=requisicion handling.
 * Redirect only when the user has the requisitions module; otherwise inventory guard applies.
 */
export function shouldRedirectInventoryRequisitionSection(section, canAccessRequisitions) {
  return section === "requisicion" && Boolean(canAccessRequisitions)
}

/** @returns {"redirect-requisitions" | "inventory-guard"} */
export function resolveInventoryRouteGate(section, canAccessRequisitions) {
  return shouldRedirectInventoryRequisitionSection(section, canAccessRequisitions)
    ? "redirect-requisitions"
    : "inventory-guard"
}
