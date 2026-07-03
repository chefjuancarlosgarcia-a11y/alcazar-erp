import { useEffect, useState } from "react"
import { COLD_ROOM_ALERT_HOURS } from "./bakeryPermissions"
import { getBakerySupervisorDashboard } from "./bakeryService"

export default function BakerySupervisorDashboard({ onOpenBatch }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: dashboard, error: loadError } = await getBakerySupervisorDashboard()
      if (loadError) setError(loadError.message)
      else setData(dashboard)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="bakery-card"><p>Cargando panel...</p></div>
  if (error) return <div className="bakery-card"><div className="bakery-error">{error}</div></div>
  if (!data) return null

  const todayPlan = data.today_plan || []
  const overduePlan = data.overdue_plan || []
  const inProgress = data.batches_in_progress || []
  const pendingDelivery = data.batches_pending_delivery || []
  const coldDough = data.cold_room_dough || []
  const recentWaste = data.recent_waste || []

  return (
    <div className="bakery-module">
      <div className="bakery-grid">
        <div className="bakery-stat"><span>Hoy planificados</span><strong>{todayPlan.length}</strong></div>
        <div className="bakery-stat"><span>Atrasados</span><strong>{overduePlan.length}</strong></div>
        <div className="bakery-stat"><span>Lotes en proceso</span><strong>{inProgress.length}</strong></div>
        <div className="bakery-stat"><span>Pendientes entrega</span><strong>{pendingDelivery.length}</strong></div>
        <div className="bakery-stat"><span>Masas cuarto frío</span><strong>{coldDough.length}</strong></div>
        <div className="bakery-stat"><span>Producción semanal entregada</span><strong>{Number(data.weekly_delivered || 0)}</strong></div>
      </div>

      <section className="bakery-card">
        <h3>¿Qué toca hacer hoy?</h3>
        <div className="bakery-list">
          {todayPlan.length === 0 && <p>No hay producciones planificadas para hoy.</p>}
          {todayPlan.map((item) => (
            <div key={item.id} className="bakery-list-item">
              <div>
                <strong>{item.product_name}</strong>
                <div>{item.planned_quantity} {item.unit} · {item.required_date}</div>
              </div>
              <span className={`bakery-badge ${item.status}`}>{item.status}</span>
            </div>
          ))}
        </div>
      </section>

      {overduePlan.length > 0 && (
        <section className="bakery-card">
          <h3>Producciones atrasadas</h3>
          <div className="bakery-list">
            {overduePlan.map((item) => (
              <div key={item.id} className="bakery-list-item overdue">
                <div>
                  <strong>{item.product_name}</strong>
                  <div>Requerido: {item.required_date}</div>
                </div>
                <span className="bakery-badge urgent">Atrasado</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bakery-card">
        <h3>Lotes en proceso</h3>
        <div className="bakery-list">
          {inProgress.length === 0 && <p>No hay lotes activos.</p>}
          {inProgress.map((batch) => (
            <div key={batch.id} className="bakery-list-item">
              <div>
                <strong>{batch.batch_code}</strong>
                <div>{batch.product_name} · plan {batch.planned_quantity} {batch.unit}</div>
              </div>
              <button type="button" className="bakery-btn secondary" onClick={() => onOpenBatch?.(batch.id)}>Abrir</button>
            </div>
          ))}
        </div>
      </section>

      <section className="bakery-card">
        <h3>Masas en cuarto frío</h3>
        <div className="bakery-list">
          {coldDough.length === 0 && <p>No hay masas en fermentación fría.</p>}
          {coldDough.map((dough) => (
            <div
              key={dough.id}
              className={`bakery-list-item ${Number(dough.hours_in_cold) >= COLD_ROOM_ALERT_HOURS ? "cold-alert" : ""}`}
            >
              <div>
                <strong>{dough.batch_code}</strong>
                <div>{dough.dough_type} · {dough.quantity_units} u · {dough.hours_in_cold} h en frío</div>
              </div>
              {Number(dough.hours_in_cold) >= COLD_ROOM_ALERT_HOURS && (
                <span className="bakery-badge urgent">Revisar</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bakery-card">
        <h3>Mermas recientes</h3>
        <div className="bakery-list">
          {recentWaste.length === 0 && <p>Sin mermas registradas recientemente.</p>}
          {recentWaste.map((waste) => (
            <div key={waste.id} className="bakery-list-item">
              <div>
                <strong>{waste.product_name}</strong>
                <div>{waste.quantity} {waste.unit} · {waste.waste_reason}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
