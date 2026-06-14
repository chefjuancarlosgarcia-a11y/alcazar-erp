import { Navigate, useParams } from "react-router-dom"
import { normalizeProductionArea } from "../utils/posProduction"

const RESERVED = new Set(["kds", "areas", "products", "assignments"])

export default function ProductionLegacyRedirect() {
  const { areaId } = useParams()
  const normalized = normalizeProductionArea(areaId)
  if (!areaId || RESERVED.has(String(areaId).toLowerCase())) {
    return <Navigate to="/production" replace />
  }
  return <Navigate to={`/production/kds/${normalized}`} replace />
}
