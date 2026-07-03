import { useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import BakeryBatchPanel from "./BakeryBatchPanel"
import BakeryDoughPanel from "./BakeryDoughPanel"
import BakeryPlanMaster from "./BakeryPlanMaster"
import BakerySupervisorDashboard from "./BakerySupervisorDashboard"
import BakeryWastePanel from "./BakeryWastePanel"
import { canAccessBakeryModule, canManageBakeryPlans } from "./bakeryPermissions"
import "./Bakery.css"

const TABS = [
  { id: "dashboard", label: "Panel supervisor", roles: "all" },
  { id: "plan", label: "Plan maestro", roles: "all" },
  { id: "batches", label: "Producciones / lotes", roles: "all" },
  { id: "dough", label: "Masas", roles: "all" },
  { id: "waste", label: "Merma", roles: "all" }
]

export default function BakeryProductionHub() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get("tab") || "dashboard"
  const selectedBatchId = searchParams.get("batchId") || ""

  const allowed = canAccessBakeryModule(user?.role)
  const canManagePlans = canManageBakeryPlans(user?.role)

  const visibleTabs = useMemo(
    () => TABS.filter((entry) => entry.id !== "plan" || canManagePlans || user?.role === "supervisor_panaderia"),
    [canManagePlans, user?.role]
  )

  if (!allowed) {
    return (
      <div className="bakery-unauthorized">
        <h2>No autorizado</h2>
        <p>No tienes permiso para acceder al Centro de Producción de Panadería y Pastelería.</p>
      </div>
    )
  }

  function setTab(nextTab) {
    const params = new URLSearchParams(searchParams)
    params.set("tab", nextTab)
    if (nextTab !== "batches") params.delete("batchId")
    setSearchParams(params)
  }

  function handleBatchStarted(batch) {
    const params = new URLSearchParams(searchParams)
    params.set("tab", "batches")
    params.set("batchId", batch.id)
    setSearchParams(params)
  }

  function handleOpenBatch(batchId) {
    const params = new URLSearchParams(searchParams)
    params.set("tab", "batches")
    params.set("batchId", batchId)
    setSearchParams(params)
  }

  function clearBatchSelection() {
    const params = new URLSearchParams(searchParams)
    params.delete("batchId")
    setSearchParams(params)
  }

  return (
    <div className="bakery-module">
      <header className="bakery-header">
        <h1>Centro de Producción de Panadería y Pastelería</h1>
        <p>
          {canManagePlans
            ? "Planifica, documenta y entrega producción con trazabilidad completa."
            : "Panel operativo: ejecuta producciones, diario, entregas, masas y merma."}
        </p>
      </header>

      <nav className="bakery-tabs">
        {visibleTabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? "active" : ""}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <BakerySupervisorDashboard onOpenBatch={handleOpenBatch} />}
      {tab === "plan" && (
        <BakeryPlanMaster onBatchStarted={handleBatchStarted} />
      )}
      {tab === "batches" && (
        <BakeryBatchPanel selectedBatchId={selectedBatchId} onClearSelection={clearBatchSelection} />
      )}
      {tab === "dough" && <BakeryDoughPanel />}
      {tab === "waste" && <BakeryWastePanel />}
    </div>
  )
}
