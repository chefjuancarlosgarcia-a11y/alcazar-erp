import { useSearchParams } from "react-router-dom"
import LegacyInventoryApp from "../modules/LegacyInventoryApp"
import InventoryBase from "./InventoryBase"
import RequisitionsSupabase from "./RequisitionsSupabase"
import RecipesSupabase from "./RecipesSupabase"

const allowedSections = new Set([
  "inventario",
  "requisicion",
  "movimientosInventario",
  "inventarioAreas",
  "areas",
  "ordenes",
  "proveedores",
  "recetas"
])

function Inventory() {
  const [searchParams] = useSearchParams()
  const section = searchParams.get("section") || "inventario"
  const areaId = searchParams.get("area") || "todos"
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

  return <LegacyInventoryApp initialSeccion={initialSeccion} hideLegacyNavigation />
}

export default Inventory
