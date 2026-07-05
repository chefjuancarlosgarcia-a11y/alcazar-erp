import {
  getRecipeStatusBadge,
  getInventoryTrackingBadge
} from "../utils/posImplementationMode"
import "../components/inventory/PosImplementationDashboard.css"

export default function PosProductImplementationBadges({ state, product }) {
  if (!state?.active) return null
  const recipeBadge = getRecipeStatusBadge(state.recipeStatus || product?.recipeStatus || product?.recipe_status || "missing")
  const inventoryBadge = getInventoryTrackingBadge(product || state)

  return (
    <div className="pos-product-implementation-badges">
      <span className={`pos-implementation-badge ${recipeBadge.tone}`}>{recipeBadge.label}</span>
      <span className={`pos-implementation-badge ${inventoryBadge.tone}`}>{inventoryBadge.label}</span>
      {state.saleAllowed && !state.inventoryWillDeduct && (
        <span className="pos-implementation-badge warning">Venta sin inventario</span>
      )}
    </div>
  )
}
