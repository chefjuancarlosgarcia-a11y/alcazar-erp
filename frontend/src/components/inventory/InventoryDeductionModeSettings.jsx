import { useMemo, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import { useInventoryDeductionMode } from "../../context/InventoryMigrationModeProvider"
import { setInventoryDeductionMode } from "../../services/inventoryDeductionModeService"
import { INVENTORY_DEDUCTION_MODES } from "../../utils/posImplementationMode"
import "./MigrationModeBanner.css"

const MODE_OPTIONS = [
  {
    value: INVENTORY_DEDUCTION_MODES.ACTIVE_RECIPES_ONLY,
    title: "Solo recetas activas (recomendado)",
    description: "Permite vender sin receta. Descarga inventario únicamente en productos con receta activa y control de inventario habilitado."
  },
  {
    value: INVENTORY_DEDUCTION_MODES.DISABLED,
    title: "Inventario desactivado",
    description: "Nunca descarga inventario en ventas POS. Ideal durante implementación inicial."
  },
  {
    value: INVENTORY_DEDUCTION_MODES.STRICT,
    title: "Modo estricto",
    description: "Exige receta e inventario completos. Bloquea ventas sin validación completa."
  }
]

export default function InventoryDeductionModeSettings() {
  const { user } = useAuth()
  const { deductionMode, deductionState, refreshDeductionMode, applyDeductionState } = useInventoryDeductionMode()
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState("")
  const [message, setMessage] = useState("")

  const canManage = useMemo(
    () => user?.role === "admin",
    [user?.role]
  )

  if (!canManage) return null

  async function handleSave(nextMode) {
    if (nextMode === deductionMode) return
    setBusy(true)
    setMessage("")
    const result = await setInventoryDeductionMode(nextMode, notes || null)
    setBusy(false)
    if (result.error) {
      setMessage(result.error)
      return
    }
    applyDeductionState(result.data)
    await refreshDeductionMode()
    setMessage("Modo de descarga de inventario actualizado.")
    setNotes("")
  }

  return (
    <section className="settings-panel migration-mode-settings">
      <header>
        <h3>Modo de descarga de inventario POS</h3>
        <p>
          Controla cuándo las ventas POS descuentan materias primas. Las ventas, KDS y caja siguen operando en todos los modos.
        </p>
      </header>

      <div className="migration-mode-options">
        {MODE_OPTIONS.map((option) => (
          <label key={option.value} className={`migration-mode-option${deductionMode === option.value ? " is-active" : ""}`}>
            <input
              type="radio"
              name="inventory_deduction_mode"
              value={option.value}
              checked={deductionMode === option.value}
              disabled={busy}
              onChange={() => handleSave(option.value)}
            />
            <div>
              <strong>{option.title}</strong>
              <p>{option.description}</p>
            </div>
          </label>
        ))}
      </div>

      <label className="migration-mode-notes">
        Notas (opcional)
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Motivo del cambio de modo"
          disabled={busy}
        />
      </label>

      {deductionState?.updated_by_name && (
        <p className="migration-mode-meta">
          Último cambio por {deductionState.updated_by_name}
          {deductionState.updated_at ? ` · ${new Date(deductionState.updated_at).toLocaleString("es-GT")}` : ""}
        </p>
      )}

      {message && <p className="migration-mode-feedback">{message}</p>}
    </section>
  )
}
