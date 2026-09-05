import { useCallback, useEffect, useState } from "react"
import {
  createFinanceAccountingPeriod,
  listFinanceAccountingPeriods,
  reopenFinanceAccountingPeriod,
  setFinanceAccountingPeriodStatus
} from "../../services/financeAccountingFoundationService"
import {
  canCloseAccountingPeriod,
  canManageAccountingPeriods,
  canManageAccountingStructure,
  canReopenAccountingPeriod
} from "../../utils/financePermissions"
import {
  MONTH_LABELS,
  PERIOD_STATUS_LABELS,
  PERIOD_STATUSES
} from "../../utils/financeAccountingFoundationConstants"

function Field({ label, className = "", children }) {
  return (
    <label className={`finance-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function statusBadgeClass(status) {
  if (status === "open") return "finance-badge--paid"
  if (status === "soft_closed") return "finance-badge--partial"
  return "finance-badge--cancelled"
}

export default function FinanceAccountingPeriodsTab({ user, notify }) {
  const canManage = canManageAccountingPeriods(user)
  const canClose = canCloseAccountingPeriod(user)
  const canReopen = canReopenAccountingPeriod(user)
  const currentYear = new Date().getFullYear()
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ year: String(currentYear), status: "" })
  const [createYear, setCreateYear] = useState(String(currentYear))
  const [createMonth, setCreateMonth] = useState(String(new Date().getMonth() + 1))
  const [reopenTarget, setReopenTarget] = useState(null)
  const [reopenReason, setReopenReason] = useState("")

  const loadPeriods = useCallback(async () => {
    setLoading(true)
    const result = await listFinanceAccountingPeriods({
      year: filters.year || null,
      status: filters.status || null
    })
    setLoading(false)
    if (result.error) {
      notify(result.error, "error")
      return
    }
    setPeriods(result.data)
  }, [filters, notify])

  useEffect(() => {
    loadPeriods()
  }, [loadPeriods])

  async function handleCreate(event) {
    event.preventDefault()
    if (!canManage) return notify("No tienes permiso para administrar periodos contables.", "error")
    const result = await createFinanceAccountingPeriod(Number(createYear), Number(createMonth))
    if (result.error) notify(result.error, "error")
    else {
      notify("Periodo contable creado.", "success")
      await loadPeriods()
    }
  }

  async function changeStatus(period, nextStatus) {
    if (period.status === "closed" && nextStatus === "open") {
      if (!canReopen) return notify("No tienes permiso para reabrir periodos contables.", "error")
      setReopenTarget(period)
      setReopenReason("")
      return
    }
    if (nextStatus === "closed" && !canClose) {
      return notify("No tienes permiso para cerrar periodos contables.", "error")
    }
    if (!canManage) return notify("No tienes permiso para administrar periodos contables.", "error")
    const result = await setFinanceAccountingPeriodStatus(period.id, nextStatus)
    if (result.error) notify(result.error, "error")
    else {
      notify("Estado del periodo actualizado.", "success")
      await loadPeriods()
    }
  }

  async function submitReopen(event) {
    event.preventDefault()
    if (!reopenTarget) return
    if (!canReopen) return notify("No tienes permiso para reabrir periodos contables.", "error")
    const result = await reopenFinanceAccountingPeriod(reopenTarget.id, reopenReason)
    if (result.error) notify(result.error, "error")
    else {
      notify("Periodo reabierto.", "success")
      setReopenTarget(null)
      setReopenReason("")
      await loadPeriods()
    }
  }

  return (
    <>
      <article className="finance-panel finance-chart-panel">
        <div className="finance-panel__head">
          <div>
            <h2>Periodos contables</h2>
            <p className="tasks-muted">
              Periodos mensuales de calendario. El cierre y la reapertura quedan en flujo controlado.
            </p>
          </div>
        </div>

        <div className="finance-filters finance-chart-filters">
          <select value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })}>
            <option value="">Todos los años</option>
            {[currentYear - 1, currentYear, currentYear + 1].map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Todos los estados</option>
            {PERIOD_STATUSES.map((value) => (
              <option key={value} value={value}>{PERIOD_STATUS_LABELS[value]}</option>
            ))}
          </select>
          <button type="button" className="tasks-primary" onClick={loadPeriods} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>

        {canManage ? (
          <form className="finance-form-grid finance-chart-form" onSubmit={handleCreate}>
            <h3 className="finance-field--full">Crear periodo</h3>
            <Field label="Año">
              <input
                type="number"
                min="2000"
                max="2100"
                value={createYear}
                onChange={(e) => setCreateYear(e.target.value)}
                required
              />
            </Field>
            <Field label="Mes">
              <select value={createMonth} onChange={(e) => setCreateMonth(e.target.value)} required>
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>{label}</option>
                ))}
              </select>
            </Field>
            <div className="finance-actions finance-field--full">
              <button type="submit" className="tasks-primary">Crear periodo</button>
            </div>
          </form>
        ) : null}

        <div className="finance-table-wrap">
          <table className="finance-table finance-chart-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Estado</th>
                {canManage || canClose || canReopen ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {periods.map((row) => (
                <tr key={row.id}>
                  <td>{MONTH_LABELS[row.period_month - 1]} {row.period_year}</td>
                  <td>{row.start_date}</td>
                  <td>{row.end_date}</td>
                  <td>
                    <span className={`finance-badge ${statusBadgeClass(row.status)}`}>
                      {PERIOD_STATUS_LABELS[row.status] || row.status}
                    </span>
                  </td>
                  {canManage || canClose || canReopen ? (
                    <td>
                      <div className="finance-actions">
                        {row.status === "open" && canManage ? (
                          <>
                            <button type="button" className="tasks-link" onClick={() => changeStatus(row, "soft_closed")}>
                              Cierre suave
                            </button>
                            {canClose ? (
                              <button type="button" className="tasks-link" onClick={() => changeStatus(row, "closed")}>
                                Cerrar
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        {row.status === "soft_closed" && canManage ? (
                          <>
                            <button type="button" className="tasks-link" onClick={() => changeStatus(row, "open")}>
                              Reabrir
                            </button>
                            {canClose ? (
                              <button type="button" className="tasks-link" onClick={() => changeStatus(row, "closed")}>
                                Cerrar
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        {row.status === "closed" && canReopen ? (
                          <button type="button" className="tasks-link" onClick={() => changeStatus(row, "open")}>
                            Reabrir con motivo
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!periods.length && !loading ? (
                <tr>
                  <td colSpan={canManage || canClose || canReopen ? 5 : 4} className="tasks-muted">
                    No hay periodos contables para los filtros seleccionados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {reopenTarget ? (
        <div className="finance-modal-backdrop">
          <form className="finance-panel finance-modal" onSubmit={submitReopen}>
            <h3>Reabrir periodo</h3>
            <p className="tasks-muted">
              {MONTH_LABELS[reopenTarget.period_month - 1]} {reopenTarget.period_year} — el motivo es obligatorio.
            </p>
            <Field label="Motivo de reapertura" className="finance-field--full">
              <textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                rows={3}
                required
              />
            </Field>
            <div className="finance-actions">
              <button type="submit" className="tasks-primary">Confirmar reapertura</button>
              <button type="button" className="tasks-secondary" onClick={() => setReopenTarget(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
