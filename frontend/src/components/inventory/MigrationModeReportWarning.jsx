import { useInventoryMigrationMode } from "../../context/InventoryMigrationModeProvider"
import "./MigrationModeBanner.css"

const REPORT_TABS = new Set(["executive", "menu", "inventory", "yields", "sales"])

export default function MigrationModeReportWarning({ tab }) {
  const { enabled, loading } = useInventoryMigrationMode()

  if (loading || !enabled || !REPORT_TABS.has(tab)) return null

  return (
    <p className="migration-mode-report-warning" role="status">
      Este reporte puede no reflejar el consumo real debido a que el sistema se encuentra en Modo Migración.
    </p>
  )
}
