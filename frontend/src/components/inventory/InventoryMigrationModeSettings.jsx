import { useMemo, useState } from "react"
import { normalizeRole } from "../../utils/profilePermissions"
import { useAuth } from "../../context/AuthContext"
import { useInventoryMigrationMode } from "../../context/InventoryMigrationModeProvider"
import { setInventoryMigrationMode } from "../../services/inventoryMigrationModeService"
import "./MigrationModeBanner.css"

function formatDateTime(value) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("es-GT")
}

function ActivationModal({ onCancel, onConfirm, busy }) {
  return (
    <div className="migration-mode-modal-backdrop" role="presentation" onClick={onCancel}>
      <section className="migration-mode-modal" onClick={(event) => event.stopPropagation()} aria-labelledby="migration-activate-title">
        <h3 id="migration-activate-title">⚠ Activar Modo Migración</h3>
        <p>Está a punto de activar el Modo Migración.</p>
        <p>Mientras este modo permanezca activo:</p>
        <ul>
          <li>✅ Inventarios funcionan normalmente.</li>
          <li>✅ Compras funcionan normalmente.</li>
          <li>✅ Recepciones funcionan normalmente.</li>
          <li>✅ Requisiciones funcionan normalmente.</li>
          <li>✅ Ajustes de inventario funcionan normalmente.</li>
          <li>❌ Las ventas NO descontarán inventario.</li>
          <li>❌ Las recetas NO generarán consumo automático.</li>
          <li>❌ El costo de ventas NO será calculado automáticamente.</li>
        </ul>
        <p>Utilice este modo únicamente durante procesos de implementación o migración.</p>
        <div className="migration-mode-modal-actions">
          <button type="button" className="settings-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className="settings-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Activando..." : "Activar Modo Migración"}
          </button>
        </div>
      </section>
    </div>
  )
}

function DeactivationModal({ onCancel, onConfirm, busy, confirmed, onConfirmChange, notes, onNotesChange }) {
  return (
    <div className="migration-mode-modal-backdrop" role="presentation" onClick={onCancel}>
      <section className="migration-mode-modal" onClick={(event) => event.stopPropagation()} aria-labelledby="migration-deactivate-title">
        <h3 id="migration-deactivate-title">Finalizar Modo Migración</h3>
        <p>Está a punto de activar el consumo automático de inventario.</p>
        <p>A partir de este momento:</p>
        <ul>
          <li>✅ Todas las ventas descontarán materias primas.</li>
          <li>✅ Se calculará automáticamente el costo de ventas.</li>
          <li>✅ Los reportes de inventario y margen empezarán a depender de recetas estandarizadas.</li>
        </ul>
        <p>Esta acción afectará la operación diaria.</p>
        <div className="migration-mode-checklist">
          <strong>Checklist de salida</strong>
          <label><input type="checkbox" readOnly checked /> Recetas estandarizadas revisadas.</label>
          <label><input type="checkbox" readOnly checked /> Inventario físico de conciliación realizado.</label>
          <label><input type="checkbox" readOnly checked /> Órdenes y requisiciones críticas revisadas.</label>
          <label>
            <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmChange(event.target.checked)} />
            Confirmo que la conciliación fue revisada y que deseo finalizar el Modo Migración.
          </label>
        </div>
        <label className="migration-mode-notes">
          Notas (opcional)
          <textarea value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Motivo o observaciones del cierre de migración" />
        </label>
        <div className="migration-mode-modal-actions">
          <button type="button" className="settings-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className="settings-primary" onClick={onConfirm} disabled={busy || !confirmed}>
            {busy ? "Finalizando..." : "Finalizar Migración"}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function InventoryMigrationModeSettings() {
  const { user } = useAuth()
  const { state, enabled, refresh, applyState } = useInventoryMigrationMode()
  const isAdmin = normalizeRole(user?.role) === "admin"
  const [showActivate, setShowActivate] = useState(false)
  const [showDeactivate, setShowDeactivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: "", tone: "info" })
  const [deactivateConfirmed, setDeactivateConfirmed] = useState(false)
  const [notes, setNotes] = useState("")

  const statusLabel = useMemo(() => (enabled ? "Activo" : "Inactivo"), [enabled])

  if (!isAdmin) {
    return (
      <article className="migration-mode-settings-card">
        <h2>Modo Migración</h2>
        <p>Solo un Administrador del sistema puede activar o desactivar este modo.</p>
        <span className={`migration-mode-status ${enabled ? "is-active" : "is-inactive"}`}>
          Estado: {statusLabel}
        </span>
      </article>
    )
  }

  async function handleSetEnabled(nextEnabled) {
    setBusy(true)
    setMessage({ text: "", tone: "info" })
    const result = await setInventoryMigrationMode(nextEnabled, notes || null)
    setBusy(false)
    if (result.error) {
      setMessage({ text: result.error, tone: "error" })
      return
    }
    applyState(result.data)
    await refresh()
    setShowActivate(false)
    setShowDeactivate(false)
    setDeactivateConfirmed(false)
    setNotes("")
    setMessage({
      text: nextEnabled ? "Modo Migración activado." : "Modo Migración finalizado.",
      tone: "success"
    })
  }

  return (
    <>
      <article className="migration-mode-settings-card">
        <div>
          <p className="settings-eyebrow">Sistema · Operación</p>
          <h2>Modo Migración</h2>
          <p>
            Cuando está activo, el ERP permite operar inventario, compras y requisiciones sin descontar
            automáticamente el consumo generado por ventas.
          </p>
        </div>

        <span className={`migration-mode-status ${enabled ? "is-active" : "is-inactive"}`}>
          Estado: {statusLabel}
        </span>

        {enabled ? (
          <div className="migration-mode-meta">
            <div><strong>Activado por:</strong> {state?.activated_by_name || "—"}</div>
            <div><strong>Activado el:</strong> {formatDateTime(state?.activated_at)}</div>
            {state?.notes ? <div><strong>Notas:</strong> {state.notes}</div> : null}
          </div>
        ) : state?.deactivated_at ? (
          <div className="migration-mode-meta">
            <div><strong>Última desactivación:</strong> {formatDateTime(state?.deactivated_at)}</div>
            <div><strong>Por:</strong> {state?.deactivated_by_name || "—"}</div>
          </div>
        ) : null}

        {message.text ? <p className={`migration-mode-message ${message.tone}`}>{message.text}</p> : null}

        {!enabled ? (
          <button type="button" className="settings-primary" onClick={() => setShowActivate(true)}>
            Activar Modo Migración
          </button>
        ) : (
          <button type="button" className="settings-secondary" onClick={() => setShowDeactivate(true)}>
            Finalizar Modo Migración
          </button>
        )}
      </article>

      {showActivate ? (
        <ActivationModal
          busy={busy}
          onCancel={() => setShowActivate(false)}
          onConfirm={() => handleSetEnabled(true)}
        />
      ) : null}

      {showDeactivate ? (
        <DeactivationModal
          busy={busy}
          confirmed={deactivateConfirmed}
          onConfirmChange={setDeactivateConfirmed}
          notes={notes}
          onNotesChange={setNotes}
          onCancel={() => {
            setShowDeactivate(false)
            setDeactivateConfirmed(false)
            setNotes("")
          }}
          onConfirm={() => handleSetEnabled(false)}
        />
      ) : null}
    </>
  )
}
