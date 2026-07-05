import { useEffect, useState } from "react"
import { getPosImplementationDashboard } from "../../services/inventoryDeductionModeService"
import { INVENTORY_DEDUCTION_MODES } from "../../utils/posImplementationMode"
import "./PosImplementationDashboard.css"

const MODE_LABELS = {
  [INVENTORY_DEDUCTION_MODES.DISABLED]: "Inventario desactivado",
  [INVENTORY_DEDUCTION_MODES.ACTIVE_RECIPES_ONLY]: "Solo recetas activas",
  [INVENTORY_DEDUCTION_MODES.STRICT]: "Modo estricto"
}

function SoldProductsTable({ title, rows = [] }) {
  return (
    <section className="pos-implementation-panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="pos-implementation-empty">Sin ventas en los últimos 30 días.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Unidades</th>
              <th>Órdenes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.product_id}>
                <td>{row.product_name}</td>
                <td>{Number(row.units_sold || 0)}</td>
                <td>{Number(row.order_count || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function PosImplementationDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getPosImplementationDashboard().then((result) => {
      if (!active) return
      setLoading(false)
      if (result.error) {
        setError(result.error)
        return
      }
      setData(result.data)
    })
    return () => { active = false }
  }, [])

  if (loading) {
    return <div className="pos-implementation-dashboard"><p>Cargando panel de implementación…</p></div>
  }

  if (error) {
    return <div className="pos-implementation-dashboard"><p className="pos-implementation-empty">{error}</p></div>
  }

  const percent = Number(data?.implementation_percent || 0)

  return (
    <div className="pos-implementation-dashboard">
      <header>
        <h2>Implementación POS / Recetas</h2>
        <p>
          Resumen de avance para operar ventas mientras se completan recetas e inventario.
          {" "}
          <span className="pos-implementation-mode-badge">
            {MODE_LABELS[data?.deduction_mode] || data?.deduction_mode}
          </span>
        </p>
      </header>

      <div className="pos-implementation-kpis">
        <article className="pos-implementation-kpi">
          <strong>{Number(data?.total_pos_products || 0)}</strong>
          <span>Productos POS activos</span>
        </article>
        <article className="pos-implementation-kpi">
          <strong>{Number(data?.products_with_active_recipe || 0)}</strong>
          <span>Con receta activa</span>
        </article>
        <article className="pos-implementation-kpi">
          <strong>{Number(data?.products_with_inventory_tracking || 0)}</strong>
          <span>Con inventario activo</span>
        </article>
        <article className="pos-implementation-kpi">
          <strong>{Number(data?.products_pending_recipe || 0)}</strong>
          <span>Pendientes de receta</span>
        </article>
      </div>

      <section className="pos-implementation-progress">
        <strong>{percent}% implementado</strong>
        <span> — productos con receta activa sobre el total POS activo</span>
        <div className="pos-implementation-progress-bar" aria-hidden="true">
          <div style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      </section>

      <div className="pos-implementation-lists">
        <SoldProductsTable
          title="Vendidos (30 días) sin receta activa"
          rows={data?.sold_last_30_days_without_active_recipe || []}
        />
        <SoldProductsTable
          title="Vendidos (30 días) sin inventario activo"
          rows={data?.sold_last_30_days_without_inventory_tracking || []}
        />
      </div>
    </div>
  )
}
