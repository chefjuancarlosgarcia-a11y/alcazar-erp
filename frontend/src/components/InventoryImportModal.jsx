import { useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { importInventoryRows } from "../services/inventoryService"

const IMPORT_FIELDS = [
  { id: "name", label: "Producto", aliases: ["name", "nombre", "producto"] },
  { id: "sku", label: "SKU", aliases: ["sku", "codigo", "código"] },
  { id: "category", label: "Categoría", aliases: ["category", "categoria", "categoría"] },
  { id: "purchase_unit", label: "Unidad de compra", aliases: ["purchase_unit", "unidad_compra", "unidad compra", "unidadCompra"] },
  { id: "base_unit", label: "Unidad base", aliases: ["base_unit", "unidad_base", "unidad base", "unidadCompra"] },
  { id: "conversion_factor", label: "Factor conversión", aliases: ["conversion_factor", "factor_conversion", "factor conversión", "unidadesPorEmpaque"] },
  { id: "cost_per_base_unit", label: "Costo base", aliases: ["cost_per_base_unit", "costo_base", "costo base", "costoUnitario"] },
  { id: "supplier", label: "Proveedor", aliases: ["supplier", "proveedor"] },
  { id: "quantity", label: "Cantidad", aliases: ["quantity", "stock", "cantidad", "cantidadComprada", "stockActual"] },
  { id: "area_id", label: "Área", aliases: ["area", "area_id", "área", "ubicacion", "ubicación"] },
  { id: "minimum_quantity", label: "Mínimo", aliases: ["minimum_quantity", "minimo", "mínimo", "puntoMinimo"] },
  { id: "image_url", label: "URL de imagen", aliases: ["image_url", "imagen", "image"] }
]

function InventoryImportModal({ areas, existingItems, onClose, onImported }) {
  const [fileName, setFileName] = useState("")
  const [columns, setColumns] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [nameActions, setNameActions] = useState({})
  const [parseError, setParseError] = useState("")
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState("")
  const [result, setResult] = useState(null)

  async function readFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setParseError("")
    setImportStatus("")
    setResult(null)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array" })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
      const headers = rows.length ? Object.keys(rows[0]) : []
      if (!headers.length || !rows.length) {
        setParseError("El archivo no contiene filas para importar.")
        setColumns([])
        setRawRows([])
        return
      }
      setFileName(file.name)
      setColumns(headers)
      setRawRows(rows)
      setMapping(autoMap(headers))
      setNameActions({})
    } catch {
      setParseError("No se pudo leer el archivo. Usa formato Excel o CSV válido.")
      setColumns([])
      setRawRows([])
    }
  }

  const preview = useMemo(() => rawRows.map((row, index) => validateRow(
    extractRow(row, mapping),
    index,
    areas,
    existingItems,
    nameActions
  )), [areas, existingItems, mapping, nameActions, rawRows])
  const validRows = preview.filter((row) => row.status !== "error" && row.ready)
  const errorCount = preview.filter((row) => row.status === "error").length
  const pendingCount = preview.filter((row) => row.status === "warning" && !row.ready).length

  async function importRows() {
    if (!validRows.length || pendingCount > 0) return
    setImporting(true)
    setParseError("")
    setResult(null)
    setImportStatus(`Procesando ${validRows.length} filas en Supabase...`)
    const rows = validRows.map((row) => {
      const matched = findMatch(row.data, existingItems, nameActions[row.index])
      return {
        ...row.data,
        matched_item_id: matched?.id || null
      }
    })
    try {
      const { data, error } = await importInventoryRows(rows)
      if (error) {
        setImportStatus("")
        setParseError(`No se pudo importar: ${error.message}. Si acabas de agregar la importación masiva, ejecuta nuevamente 004_inventory.sql en Supabase.`)
        return
      }
      const summary = {
        created: Number(data?.created || 0),
        updated: Number(data?.updated || 0),
        stocks: Number(data?.stocks || 0),
        movements: Number(data?.movements || 0),
        omitted: errorCount,
        runtimeErrors: []
      }
      setResult(summary)
      setImportStatus("Importación finalizada.")
      await onImported(summary)
    } catch (error) {
      setImportStatus("")
      setParseError(`No se pudo importar: ${error.message || "Error inesperado."}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="inventory-modal-backdrop">
      <section className="inventory-modal import">
        <header>
          <div><p className="inventory-base-eyebrow">Carga masiva</p><h2>Importar Excel/CSV</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>

        <label className="inventory-import-file">
          <span>Archivo `.xlsx`, `.xls` o `.csv`</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={readFile} />
          {fileName && <small>Archivo: {fileName}</small>}
        </label>
        {parseError && <div className="inventory-base-error">{parseError}</div>}
        {importStatus && <div className="inventory-base-success">{importStatus}</div>}

        {columns.length > 0 && (
          <>
            <div>
              <h3>Columnas detectadas</h3>
              <div className="inventory-import-columns">{columns.map((column) => <span key={column}>{column}</span>)}</div>
            </div>
            <div>
              <h3>Mapeo de columnas</h3>
              <div className="inventory-import-mapping">
                {IMPORT_FIELDS.map((field) => (
                  <label className="inventory-field" key={field.id}>
                    <span>{field.label}{["name", "base_unit"].includes(field.id) ? " *" : ""}</span>
                    <select value={mapping[field.id] || ""} onChange={(event) => setMapping((current) => ({ ...current, [field.id]: event.target.value }))}>
                      <option value="">Sin columna</option>
                      {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="inventory-import-summary">
              <span>Filas: <strong>{preview.length}</strong></span>
              <span>Listas: <strong>{validRows.length}</strong></span>
              <span>Errores: <strong>{errorCount}</strong></span>
              <span>Por resolver: <strong>{pendingCount}</strong></span>
            </div>
            {!validRows.length && (
              <div className="inventory-base-error">
                No hay filas listas para importar. Revisa el mapeo de columnas obligatorias: Producto y Unidad base.
              </div>
            )}
            {pendingCount > 0 && (
              <div className="inventory-base-warning">
                Resuelve las coincidencias por nombre antes de importar.
              </div>
            )}

            <div className="inventory-import-preview">
              <div className="inventory-import-head"><span>Producto</span><span>SKU / categoría</span><span>Unidad / área</span><span>Stock / mínimo</span><span>Estado</span></div>
              {preview.slice(0, 100).map((row) => (
                <article key={row.index}>
                  <span>{row.data.name || "Sin nombre"}</span>
                  <span>{row.data.sku || "Sin SKU"} · {row.data.category || "Sin categoría"}</span>
                  <span>{row.data.base_unit || "-"} · {row.areaName || row.data.area_id}</span>
                  <span>{row.data.quantity} / {row.data.minimum_quantity}</span>
                  <div>
                    <strong className={`inventory-import-state ${row.status}`}>{row.status === "error" ? "Error" : row.ready ? "Listo" : "Advertencia"}</strong>
                    <small>{row.messages.join(" ")}</small>
                    {row.needsNameDecision && (
                      <select value={nameActions[row.index] || ""} onChange={(event) => setNameActions((current) => ({ ...current, [row.index]: event.target.value }))}>
                        <option value="">Elegir acción...</option>
                        <option value="update">Actualizar existente</option>
                        <option value="create">Crear nuevo</option>
                      </select>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="inventory-modal-actions">
              <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                className="primary"
                title={!validRows.length ? "No existen filas válidas. Revisa el mapeo." : pendingCount > 0 ? "Resuelve las advertencias pendientes." : ""}
                disabled={importing || !validRows.length || pendingCount > 0}
                onClick={importRows}
              >
                {importing ? "Importando..." : "Importar filas válidas"}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="inventory-import-result">
            <h3>Resultado de importación</h3>
            <p>Productos creados: <strong>{result.created}</strong> · Actualizados: <strong>{result.updated}</strong> · Stocks actualizados: <strong>{result.stocks}</strong> · Movimientos: <strong>{result.movements}</strong> · Errores omitidos: <strong>{result.omitted}</strong></p>
            {result.runtimeErrors.map((message) => <small key={message}>{message}</small>)}
          </div>
        )}
      </section>
    </div>
  )
}

function extractRow(row, mapping) {
  const result = {}
  IMPORT_FIELDS.forEach((field) => {
    result[field.id] = mapping[field.id] ? String(row[mapping[field.id]] ?? "").trim() : ""
  })
  return result
}

function validateRow(source, index, areas, existingItems, nameActions) {
  const messages = []
  const data = {
    ...source,
    area_id: source.area_id || "almacen",
    quantity: numberOrDefault(source.quantity, 0),
    minimum_quantity: numberOrDefault(source.minimum_quantity, 0),
    conversion_factor: numberOrDefault(source.conversion_factor, 1),
    cost_per_base_unit: numberOrDefault(source.cost_per_base_unit, 0)
  }
  if (!source.name) messages.push("Falta nombre.")
  if (!source.base_unit) messages.push("Falta unidad base.")
  if (!validNumber(source.quantity, 0)) messages.push("Cantidad inválida.")
  if (!validNumber(source.minimum_quantity, 0)) messages.push("Mínimo inválido.")
  if (!validNumber(source.cost_per_base_unit, 0)) messages.push("Costo inválido.")
  if (!validNumber(source.conversion_factor, 0.0000001)) messages.push("Factor inválido.")
  const area = areas.find((entry) => normalize(entry.id) === normalize(data.area_id) || normalize(entry.name) === normalize(data.area_id))
  if (!area) messages.push("Área no existe.")
  else data.area_id = area.id
  const existingByName = !data.sku && existingItems.find((item) => normalize(item.name) === normalize(data.name))
  const needsNameDecision = Boolean(existingByName)
  if (needsNameDecision && !nameActions[index]) messages.push("Ya existe un producto con este nombre y sin SKU.")
  const hardError = messages.some((message) => !message.startsWith("Ya existe"))
  return {
    index,
    data,
    areaName: area?.name || "",
    messages: messages.length ? messages : ["Validación correcta."],
    needsNameDecision,
    status: hardError ? "error" : needsNameDecision && !nameActions[index] ? "warning" : "ready",
    ready: !hardError && (!needsNameDecision || Boolean(nameActions[index]))
  }
}

function findMatch(data, items, nameAction) {
  if (data.sku) return items.find((item) => normalize(item.sku) === normalize(data.sku))
  if (nameAction === "update") return items.find((item) => normalize(item.name) === normalize(data.name))
  return null
}

function autoMap(columns) {
  return Object.fromEntries(IMPORT_FIELDS.map((field) => [
    field.id,
    columns.find((column) => field.aliases.map(canonicalKey).includes(canonicalKey(column))) || ""
  ]))
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_")
}

function canonicalKey(value) {
  return normalize(value).replace(/[^a-z0-9]/g, "")
}

function numberOrDefault(value, fallback) {
  return String(value || "").trim() === "" ? fallback : Number(String(value).replace(",", "."))
}

function validNumber(value, minimum) {
  if (String(value || "").trim() === "") return true
  const number = numberOrDefault(value, minimum)
  return Number.isFinite(number) && number >= minimum
}

export default InventoryImportModal
