import { useCallback, useEffect, useState } from "react"
import { getActiveRecipes } from "../../services/recipesService"
import { BAKERY_QUALITY_OPTIONS } from "./bakeryPermissions"
import RequiredPhotoUpload from "./components/RequiredPhotoUpload"
import {
  deliverBakeryBatch,
  getBakeryBatch,
  getBakeryDiaryEntry,
  listBakeryBatches,
  saveBakeryDiaryEntry,
  uploadBakeryPhoto
} from "./bakeryService"

function formatDateTime(value) {
  if (!value) return ""
  return new Date(value).toLocaleString("es-GT")
}

export default function BakeryBatchPanel({ selectedBatchId, onClearSelection }) {
  const [batches, setBatches] = useState([])
  const [batch, setBatch] = useState(null)
  const [diary, setDiary] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showDelivery, setShowDelivery] = useState(false)
  const [deliveryQty, setDeliveryQty] = useState("")
  const [deliveryQuality, setDeliveryQuality] = useState("good")
  const [deliveryNotes, setDeliveryNotes] = useState("")
  const [deliveryPhoto, setDeliveryPhoto] = useState(null)
  const [diaryForm, setDiaryForm] = useState({
    start_time: "",
    end_time: "",
    ambient_temperature: "",
    actual_quantity: "",
    process_notes: "",
    quality_result: "good",
    issues_detected: ""
  })

  const loadBatches = useCallback(async () => {
    const { data } = await listBakeryBatches()
    setBatches((data || []).filter((entry) => ["created", "in_progress"].includes(entry.status)))
  }, [])

  const loadBatchDetail = useCallback(async (batchId) => {
    if (!batchId) {
      setBatch(null)
      setDiary(null)
      return
    }
    setLoading(true)
    const [batchResult, diaryResult, recipesResult] = await Promise.all([
      getBakeryBatch(batchId),
      getBakeryDiaryEntry(batchId),
      getActiveRecipes()
    ])
    if (batchResult.error) setError(batchResult.error.message)
    else {
      setBatch(batchResult.data)
      setDeliveryQty(String(batchResult.data?.actual_quantity || batchResult.data?.planned_quantity || ""))
    }
    const diaryRow = diaryResult.data
    setDiary(diaryRow)
    setDiaryForm({
      start_time: diaryRow?.start_time ? diaryRow.start_time.slice(0, 16) : "",
      end_time: diaryRow?.end_time ? diaryRow.end_time.slice(0, 16) : "",
      ambient_temperature: diaryRow?.ambient_temperature ?? "",
      actual_quantity: diaryRow?.actual_quantity ?? batchResult.data?.planned_quantity ?? "",
      process_notes: diaryRow?.process_notes || "",
      quality_result: diaryRow?.quality_result || "good",
      issues_detected: diaryRow?.issues_detected || ""
    })
    setRecipes((recipesResult.data || []).filter((recipe) => ["panaderia", "reposteria"].includes(recipe.production_area_id)))
    setLoading(false)
  }, [])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  useEffect(() => {
    if (selectedBatchId) loadBatchDetail(selectedBatchId)
  }, [selectedBatchId, loadBatchDetail])

  const linkedRecipe = recipes.find((recipe) => recipe.id === batch?.recipe_id)

  async function handleSaveDiary(event) {
    event.preventDefault()
    if (!batch) return
    if (Number(diaryForm.actual_quantity) <= 0) {
      setError("Indica la cantidad real producida.")
      return
    }

    setSaving(true)
    setError("")
    const { error: saveError } = await saveBakeryDiaryEntry({
      batch_id: batch.id,
      start_time: diaryForm.start_time ? new Date(diaryForm.start_time).toISOString() : null,
      end_time: diaryForm.end_time ? new Date(diaryForm.end_time).toISOString() : null,
      ambient_temperature: diaryForm.ambient_temperature === "" ? null : Number(diaryForm.ambient_temperature),
      planned_quantity: batch.planned_quantity,
      actual_quantity: Number(diaryForm.actual_quantity),
      recipe_id: batch.recipe_id,
      process_notes: diaryForm.process_notes,
      quality_result: diaryForm.quality_result,
      issues_detected: diaryForm.issues_detected
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setMessage("Diario guardado.")
    loadBatchDetail(batch.id)
    loadBatches()
  }

  async function handleDeliver(event) {
    event.preventDefault()
    if (!batch) return
    if (!deliveryPhoto) {
      setError("La foto de entrega es obligatoria.")
      return
    }
    const qty = Number(deliveryQty)
    if (qty <= 0) {
      setError("Indica la cantidad entregada.")
      return
    }

    setSaving(true)
    setError("")
    const upload = await uploadBakeryPhoto(deliveryPhoto, `delivery/${batch.id}`)
    if (upload.error) {
      setSaving(false)
      setError(upload.error.message)
      return
    }

    const { error: deliverError } = await deliverBakeryBatch(
      batch.id,
      qty,
      deliveryQuality,
      upload.data.publicUrl,
      deliveryNotes
    )
    setSaving(false)
    if (deliverError) {
      setError(deliverError.message)
      return
    }
    setMessage("Lote entregado y documentado.")
    setShowDelivery(false)
    setDeliveryPhoto(null)
    onClearSelection?.()
    loadBatches()
    setBatch(null)
  }

  const qtyWarning = batch && Number(diaryForm.actual_quantity) > 0 && Number(diaryForm.actual_quantity) < Number(batch.planned_quantity)

  return (
    <div className="bakery-module">
      <div className="bakery-card">
        <h3>Lotes activos</h3>
        <div className="bakery-list">
          {batches.length === 0 && <p>No hay lotes en producción.</p>}
          {batches.map((entry) => (
            <div key={entry.id} className="bakery-list-item">
              <div>
                <strong>{entry.batch_code}</strong>
                <div>{entry.product_name}</div>
              </div>
              <button type="button" className="bakery-btn secondary" onClick={() => loadBatchDetail(entry.id)}>
                Trabajar lote
              </button>
            </div>
          ))}
        </div>
      </div>

      {batch && (
        <div className="bakery-card">
          <h3>Diario del panadero — {batch.batch_code}</h3>
          {loading ? (
            <p>Cargando lote...</p>
          ) : (
            <>
              <div className="bakery-grid">
                <div><span>Producto</span><strong>{batch.product_name}</strong></div>
                <div><span>Planificado</span><strong>{batch.planned_quantity} {batch.unit}</strong></div>
                <div><span>Inicio</span><strong>{formatDateTime(batch.started_at)}</strong></div>
                <div><span>Receta</span><strong>{linkedRecipe?.name || "Sin receta vinculada"}</strong></div>
              </div>

              {qtyWarning && (
                <div className="bakery-warning">
                  La cantidad real ({diaryForm.actual_quantity}) es menor que la planificada ({batch.planned_quantity}).
                </div>
              )}

              <form className="bakery-form-grid" onSubmit={handleSaveDiary}>
                <label>
                  Hora inicio
                  <input type="datetime-local" value={diaryForm.start_time} onChange={(e) => setDiaryForm((c) => ({ ...c, start_time: e.target.value }))} />
                </label>
                <label>
                  Hora final
                  <input type="datetime-local" value={diaryForm.end_time} onChange={(e) => setDiaryForm((c) => ({ ...c, end_time: e.target.value }))} />
                </label>
                <label>
                  Temperatura ambiente (°C)
                  <input type="number" step="0.1" value={diaryForm.ambient_temperature} onChange={(e) => setDiaryForm((c) => ({ ...c, ambient_temperature: e.target.value }))} />
                </label>
                <label>
                  Cantidad real *
                  <input type="number" min="0.01" step="0.01" required value={diaryForm.actual_quantity} onChange={(e) => setDiaryForm((c) => ({ ...c, actual_quantity: e.target.value }))} />
                </label>
                <label>
                  Resultado calidad
                  <select value={diaryForm.quality_result} onChange={(e) => setDiaryForm((c) => ({ ...c, quality_result: e.target.value }))}>
                    {BAKERY_QUALITY_OPTIONS.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Observaciones de proceso
                  <textarea rows={3} value={diaryForm.process_notes} onChange={(e) => setDiaryForm((c) => ({ ...c, process_notes: e.target.value }))} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Problemas detectados
                  <textarea rows={2} value={diaryForm.issues_detected} onChange={(e) => setDiaryForm((c) => ({ ...c, issues_detected: e.target.value }))} />
                </label>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" className="bakery-btn" disabled={saving}>Guardar diario</button>
                  <button type="button" className="bakery-btn" disabled={saving || !diary?.actual_quantity} onClick={() => setShowDelivery(true)}>
                    Entregar lote
                  </button>
                  <button type="button" className="bakery-btn secondary" onClick={() => { setBatch(null); onClearSelection?.() }}>Cerrar</button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {message && <div className="bakery-success">{message}</div>}
      {error && <div className="bakery-error">{error}</div>}

      {showDelivery && batch && (
        <div className="bakery-modal-backdrop">
          <form className="bakery-modal" onSubmit={handleDeliver}>
            <h3>Entregar lote {batch.batch_code}</h3>
            <label>
              Cantidad final entregada *
              <input type="number" min="0.01" step="0.01" required value={deliveryQty} onChange={(e) => setDeliveryQty(e.target.value)} />
            </label>
            <label>
              Resultado de calidad *
              <select value={deliveryQuality} onChange={(e) => setDeliveryQuality(e.target.value)}>
                {BAKERY_QUALITY_OPTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </label>
            <RequiredPhotoUpload label="Foto de producción final" onFileChange={setDeliveryPhoto} disabled={saving} />
            <label>
              Observación final
              <textarea rows={2} value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} />
            </label>
            <div className="bakery-modal-actions">
              <button type="button" className="bakery-btn secondary" onClick={() => setShowDelivery(false)}>Cancelar</button>
              <button type="submit" className="bakery-btn" disabled={saving}>Confirmar entrega</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
