import { useEffect, useState } from "react"
import {
  computeUsableStock,
  getYieldAuditsForItem,
  getYieldProfileByItemId
} from "../../services/yieldCostingService"
import "../../pages/YieldCosting.css"

function formatMoney(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

export default function InventoryItemYieldPanel({ itemId, item, canManage = false }) {
  const [profile, setProfile] = useState(null)
  const [audits, setAudits] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!itemId) return
    let mounted = true
    async function load() {
      setLoading(true)
      const [profileResult, auditsResult] = await Promise.all([
        getYieldProfileByItemId(itemId),
        getYieldAuditsForItem(itemId, 8)
      ])
      if (!mounted) return
      setProfile(profileResult.data)
      setAudits(auditsResult.data || [])
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [itemId])

  if (!itemId) return null

  const yieldPercent = profile?.expectedYieldPercent ?? 100
  const stock = computeUsableStock(item?.totalQuantity ?? profile?.totalQuantity ?? 0, yieldPercent)

  return (
    <section className="yield-panel" style={{ marginTop: 16 }}>
      <h3>Rendimientos</h3>
      {loading && <p className="yield-empty">Cargando rendimiento del ingrediente...</p>}
      {!loading && (
        <>
          <div className="yield-metrics">
            <div className="yield-metric"><span>Stock físico</span><strong>{stock.physical} {item?.base_unit || profile?.baseUnit || ""}</strong></div>
            <div className="yield-metric"><span>Stock utilizable</span><strong>{stock.usable} {item?.base_unit || profile?.baseUnit || ""}</strong></div>
            <div className="yield-metric"><span>Merma esperada</span><strong>{stock.expectedWaste} {item?.base_unit || profile?.baseUnit || ""}</strong></div>
            <div className="yield-metric"><span>CPP</span><strong>{formatMoney(profile?.weightedAverageCost ?? item?.cost_per_base_unit)}</strong></div>
            <div className="yield-metric"><span>CUR</span><strong>{formatMoney(profile?.usableCost ?? item?.usable_cost ?? item?.cost_per_base_unit)}</strong></div>
            <div className="yield-metric"><span>Rendimiento esperado</span><strong>{profile ? `${profile.expectedYieldPercent}%` : "Sin perfil"}</strong></div>
            <div className="yield-metric"><span>Promedio histórico</span><strong>{profile?.historicalAverageYieldPercent != null ? `${profile.historicalAverageYieldPercent}%` : "—"}</strong></div>
          </div>

          {!profile && canManage && (
            <p className="yield-empty" style={{ marginTop: 12 }}>
              Este ingrediente aún no tiene perfil de rendimiento. Configúralo en Inventario → Rendimientos.
            </p>
          )}

          <h4 style={{ marginTop: 18 }}>Últimas auditorías</h4>
          {!audits.length && <p className="yield-empty">Sin auditorías registradas todavía.</p>}
          {audits.length > 0 && (
            <div className="yield-table-wrap">
              <table className="yield-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Rendimiento</th>
                    <th>Desviación</th>
                    <th>Merma</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((audit) => (
                    <tr key={audit.id}>
                      <td>{audit.audit_date}</td>
                      <td>{audit.yieldPercent}%</td>
                      <td>{audit.variancePercent != null ? `${audit.variancePercent}%` : "—"}</td>
                      <td>{audit.wasteWeight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
