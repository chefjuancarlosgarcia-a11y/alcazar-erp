import { lazy, Suspense } from "react"
import { useSearchParams } from "react-router-dom"
import InventoryBase from "./InventoryBase"
import InventoryItemConversions from "./InventoryItemConversions"
import InternalProduction from "./InternalProduction"
import RequisitionsSupabase from "./RequisitionsSupabase"
import RecipesSupabase from "./RecipesSupabase"

const LegacyInventoryApp = lazy(() => import("../modules/LegacyInventoryApp"))

const allowedSections = new Set([
  "inventario",
  "requisicion",
  "movimientosInventario",
  "inventarioAreas",
  "areas",
  "ordenes",
  "proveedores",
  "recetas",
  "produccionInterna",
  "conversiones"
])

function Inventory() {
  const [searchParams] = useSearchParams()
  const section = searchParams.get("section") || "inventario"
  const areaId = searchParams.get("area") || "todos"
  const orderView = searchParams.get("view") || ""
  const orderId = searchParams.get("order") || ""
  const initialSeccion = allowedSections.has(section) ? section : "inventario"

  if (["inventario", "inventarioAreas", "movimientosInventario"].includes(initialSeccion)) {
    return <InventoryBase section={initialSeccion} initialAreaId={areaId} />
  }

  if (initialSeccion === "requisicion") {
    return <RequisitionsSupabase />
  }

  if (initialSeccion === "recetas") {
    return <RecipesSupabase />
  }

  if (initialSeccion === "produccionInterna") {
    return <InternalProduction />
  }

  if (initialSeccion === "conversiones") {
    return <InventoryItemConversions />
  }

  return <Suspense fallback={<p>Cargando módulo...</p>}><LegacyInventoryApp initialSeccion={initialSeccion} initialPurchaseOrderView={orderView} initialPurchaseOrderId={orderId} hideLegacyNavigation /></Suspense>
}

export default Inventory
