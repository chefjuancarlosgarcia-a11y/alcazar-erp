import { useSearchParams } from "react-router-dom"
import InventoryBase from "./InventoryBase"
import InventoryItemConversions from "./InventoryItemConversions"
import YieldProfilesCatalog from "./YieldProfilesCatalog"
import YieldAuditCampaigns from "./YieldAuditCampaigns"
import InternalProduction from "./InternalProduction"
import RequisitionsSupabase from "./RequisitionsSupabase"
import RecipesSupabase from "./RecipesSupabase"
import { lazy, Suspense } from "react"
import { TEST_FLOW_FILTER } from "../utils/testFlowMode"

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
  "conversiones",
  "rendimientos",
  "auditoriasRendimiento"
])

function Inventory() {
  const [searchParams] = useSearchParams()
  const section = searchParams.get("section") || "inventario"
  const areaId = searchParams.get("area") || "todos"
  const orderView = searchParams.get("view") || ""
  const orderId = searchParams.get("order") || ""
  const focus = searchParams.get("focus") === "1"
  const notificationAction = searchParams.get("action") || ""
  const testFlowParam = searchParams.get("testFlow") || ""
  const requisitionId = searchParams.get("id") || ""
  const requisitionTab = searchParams.get("tab") || ""
  const requisitionApprove = searchParams.get("approve") || ""
  const initialSeccion = allowedSections.has(section) ? section : "inventario"
  const initialTestFlowFilter = testFlowParam === "test"
    ? TEST_FLOW_FILTER.TEST
    : testFlowParam === "all"
      ? TEST_FLOW_FILTER.ALL
      : ""

  if (["inventario", "inventarioAreas", "movimientosInventario"].includes(initialSeccion)) {
    return <InventoryBase section={initialSeccion} initialAreaId={areaId} />
  }

  if (initialSeccion === "requisicion") {
    return (
      <RequisitionsSupabase
        initialRequisitionId={requisitionId}
        initialTab={requisitionTab}
        initialApproveId={requisitionApprove}
        initialTestFlowFilter={initialTestFlowFilter || TEST_FLOW_FILTER.REAL}
        initialFocus={focus}
      />
    )
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

  if (initialSeccion === "rendimientos") {
    return <YieldProfilesCatalog />
  }

  if (initialSeccion === "auditoriasRendimiento") {
    return <YieldAuditCampaigns />
  }

  return (
    <Suspense fallback={<p>Cargando módulo...</p>}>
      <LegacyInventoryApp
        initialSeccion={initialSeccion}
        initialPurchaseOrderView={orderView}
        initialPurchaseOrderId={orderId}
        initialHighlightedOrder={focus ? orderId : ""}
        initialNotificationAction={notificationAction}
        initialTestFlowFilter={initialTestFlowFilter}
        hideLegacyNavigation
      />
    </Suspense>
  )
}

export default Inventory
