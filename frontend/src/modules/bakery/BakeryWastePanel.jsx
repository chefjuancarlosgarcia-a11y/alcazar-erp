import { useEffect, useState } from "react"
import { getActiveInventoryItems } from "../../services/inventoryService"
import { BAKERY_WASTE_REASONS } from "./bakeryPermissions"
import RequiredPhotoUpload from "./components/RequiredPhotoUpload"
import { listBakeryBatches, listBakeryDoughBatches, listBakeryWasteRecords, registerBakeryWaste, uploadBakeryPhoto } from "./bakeryService"

const EMPTY_FORM = {
  related_batch_id: "",
  related_dough_batch_id: "",
  inventory_item_id: "",
  product_name: "",
  quantity: "",
  unit: "Unidad",
  waste_reason: "other",
  notes: ""
}

export default function BakeryWastePanel({ presetBatchId = "", presetDoughBatchId = "" }) {
  const [records, setRecords] = useState([])
  const [batches, setBatches] = useState([])
  const [doughBatches, setDoughBatches] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    related_batch_id: presetBatchId,
    related_dough_batch_id: presetDoughBatchId
  })
  const [photoFile, setPhotoFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [wasteResult, batchResult, doughResult, itemsResult] = await Promise.all([
        listBakeryWasteRecords(),
        listBakeryBatches(),
        listBakeryDoughBatches(),
        getActiveInventoryItems()
      ])
      setRecords(wasteResult.data || [])
      setBatches(batchResult.data || [])
      setDoughBatches(doughResult.data || [])
      setInventoryItems(itemsResult.data || [])
      setLoading(false)
    }
    load()
  }, [])

  function selectInventoryItem(itemId) {
    const item = inventoryItems.find((entry) => entry.id === itemId)
    setForm((current) => ({
      ...current,
      inventory_item_id: itemId,
      product_name: item?.name || current.product_name,
      unit: item?.base_unit || current.unit
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.product_name.trim()) {
      setError("Indica el producto afectado.")
      return
    }
    if (!form.waste_reason) {
      setError("Indica el motivo de merma.")
      return
    }
    if (!photoFile) {
      setError("La foto es obligatoria para registrar merma.")
      return
    }
    if (Number(form.quantity) <= 0) {
      setError("La cantidad debe ser mayor que cero.")
      return
    }

    setSaving(true)
    setError("")
    const upload = await uploadBakeryPhoto(photoFile, "waste")
    if (upload.error) {
      setSaving(false)
      setError(upload.error.message)
      return
    }

    const { error: saveError } = await registerBakeryWaste({
      related_batch_id: form.related_batch_id || null,
      related_dough_batch_id: form.related_dough_batch_id || null,
      inventory_item_id: form.inventory_item_id || null,
      product_name: form.product_name.trim(),
      quantity: Number(form.quantity),
      unit: form.unit,
      waste_reason: form.waste_reason,
      notes: form.notes || null,
      photo_url: upload.data.publicUrl
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setMessage("Merma registrada.")
    setForm(EMPTY_FORM)
    setPhotoFile(null)
    const { data } = await listBakeryWasteRecords()
    setRecords(data || [])
  }

  return (
    <div className="bakery-module">
      <div className="bakery-card">
        <h3>Registrar merma</h3>
        <form onSubmit={handleSubmit} className="bakery-form-grid">
          <label>
            Lote de producción
            <select value={form.related_batch_id} onChange={(e) => setForm((c) => ({ ...c, related_batch_id: e.target.value }))}>
              <option value="">—</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.batch_code} · {batch.product_name}</option>
              ))}
            </select>
          </label>
          <label>
            Lote de masa
            <select value={form.related_dough_batch_id} onChange={(e) => setForm((c) => ({ ...c, related_dough_batch_id: e.target.value }))}>
              <option value="">—</option>
              {doughBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.batch_code} · {batch.dough_type}</option>
              ))}
            </select>
          </label>
          <label>
            Producto inventario
            <select value={form.inventory_item_id} onChange={(e) => selectInventoryItem(e.target.value)}>
              <option value="">Manual</option>
              {inventoryItems.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Nombre producto *
            <input required value={form.product_name} onChange={(e) => setForm((c) => ({ ...c, product_name: e.target.value }))} />
          </label>
          <label>
            Cantidad *
            <input type="number" min="0.01" step="0.01" required value={form.quantity} onChange={(e) => setForm((c) => ({ ...c, quantity: e.target.value }))} />
          </label>
          <label>
            Unidad
            <input value={form.unit} onChange={(e) => setForm((c) => ({ ...c, unit: e.target.value }))} />
          </label>
          <label>
            Motivo *
            <select required value={form.waste_reason} onChange={(e) => setForm((c) => ({ ...c, waste_reason: e.target.value }))}>
              {BAKERY_WASTE_REASONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notas
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <RequiredPhotoUpload label="Foto de merma" onFileChange={setPhotoFile} disabled={saving} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="bakery-btn" disabled={saving}>Guardar merma</button>
          </div>
        </form>
        {message && <div className="bakery-success">{message}</div>}
        {error && <div className="bakery-error">{error}</div>}
      </div>

      <div className="bakery-card">
        <h3>Mermas recientes</h3>
        {loading ? (
          <p>Cargando...</p>
        ) : (
          <div className="bakery-list">
            {records.map((record) => (
              <div key={record.id} className="bakery-list-item">
                <div>
                  <strong>{record.product_name}</strong>
                  <div>{record.quantity} {record.unit} · {record.waste_reason}</div>
                  <div>{new Date(record.created_at).toLocaleString("es-GT")}</div>
                </div>
                {record.photo_url && (
                  <img src={record.photo_url} alt="Merma" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
