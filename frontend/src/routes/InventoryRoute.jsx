import { Navigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { buildRequisitionUrlFromInventorySearchParams } from "../utils/requisitionRouteParams"
import ProtectedRoute from "./ProtectedRoute"
import Inventory from "../pages/Inventory"

/**
 * Legacy /inventory?section=requisicion must reach /requisitions even when the user
 * lacks the inventory module (e.g. barista).
 */
export default function InventoryRoute() {
  const { canAccess } = useAuth()
  const [searchParams] = useSearchParams()
  const section = searchParams.get("section") || "inventario"

  if (section === "requisicion" && canAccess("requisitions")) {
    return <Navigate to={buildRequisitionUrlFromInventorySearchParams(searchParams)} replace />
  }

  return (
    <ProtectedRoute module="inventory">
      <Inventory />
    </ProtectedRoute>
  )
}
