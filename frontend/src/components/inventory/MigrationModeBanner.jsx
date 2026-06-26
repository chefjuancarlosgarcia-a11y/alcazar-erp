import { useInventoryMigrationMode } from "../../context/InventoryMigrationModeProvider"
import "./MigrationModeBanner.css"

export default function MigrationModeBanner() {
  const { enabled, loading } = useInventoryMigrationMode()

  if (loading || !enabled) return null

  return (
    <div className="migration-mode-banner" role="status">
      <strong>⚠ MODO MIGRACIÓN ACTIVO</strong>
      <span>— Las ventas NO están descontando inventario automáticamente. Solo Administrador puede desactivar este modo.</span>
    </div>
  )
}
