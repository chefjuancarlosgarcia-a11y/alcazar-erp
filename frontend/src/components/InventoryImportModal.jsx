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
    nameActions,
    rawRows.map((candidate) => extractRow(candidate, mapping))
  )), [areas, existingItems, mapping, nameActions, rawRows])
  const importableRows = preview.filter((row) => !row.critical)
  const validRows = importableRows.filter((row) => row.ready)
  const errorCount = preview.filter((row) => row.critical).length
  const pendingCount = preview.filter((row) => row.status === "warning" && !row.ready).length
  const correctedCount = importableRows.filter((row) => row.corrected).length

  async function importRows(ignoreMinorErrors = false) {
    const rowsToImport = ignoreMinorErrors ? importableRows : validRows
    if (!rowsToImport.length || (!ignoreMinorErrors && pendingCount > 0)) return
    setImporting(true)
    setParseError("")
    setResult(null)
    setImportStatus(`Procesando ${rowsToImport.length} filas en Supabase...`)
    const rows = rowsToImport.map((row) => {
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
        imported: rowsToImport.length,
        created: Number(data?.created || 0),
        updated: Number(data?.updated || 0),
        stocks: Number(data?.stocks || 0),
        movements: Number(data?.movements || 0),
        corrected: rowsToImport.filter((row) => row.corrected || (!row.ready && ignoreMinorErrors)).length,
        omitted: preview.length - rowsToImport.length,
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
                    <span>{field.label}{["name", "category"].includes(field.id) ? " *" : ""}</span>
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
              <span>Importables: <strong>{importableRows.length}</strong></span>
              <span>Corregidas automáticamente: <strong>{correctedCount}</strong></span>
              <span>Críticas omitidas: <strong>{errorCount}</strong></span>
            </div>
            {!importableRows.length && (
              <div className="inventory-base-error">
                No hay filas importables. Revisa los campos obligatorios: Producto y Categoría, y los códigos duplicados.
              </div>
            )}
            {pendingCount > 0 && (
              <div className="inventory-base-warning">
                Existen advertencias menores. Puedes resolverlas o importarlas aplicando correcciones automáticas.
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
                    <strong className={`inventory-import-state ${row.status}`}>{row.critical ? "Error crítico" : row.corrected ? "Corregido" : row.ready ? "Listo" : "Advertencia"}</strong>
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
                className="secondary"
                disabled={importing || !importableRows.length}
                onClick={() => importRows(true)}
              >
                {importing ? "Importando..." : "Importar ignorando errores menores"}
              </button>
              <button
                type="button"
                className="primary"
                title={!validRows.length ? "No existen filas válidas. Revisa el mapeo." : pendingCount > 0 ? "Resuelve las advertencias pendientes." : ""}
                disabled={importing || !validRows.length || pendingCount > 0}
                onClick={() => importRows(false)}
              >
                {importing ? "Importando..." : "Importar filas válidas"}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="inventory-import-result">
            <h3>Resultado de importación</h3>
            <p>Importados: <strong>{result.imported}</strong> · Corregidos automáticamente: <strong>{result.corrected}</strong> · Omitidos: <strong>{result.omitted}</strong></p>
            <p>Productos creados: <strong>{result.created}</strong> · Actualizados: <strong>{result.updated}</strong> · Stocks actualizados: <strong>{result.stocks}</strong> · Movimientos: <strong>{result.movements}</strong></p>
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

function validateRow(source, index, areas, existingItems, nameActions, sourceRows) {
  const criticalErrors = []
  const corrections = []
  const warehouseArea = areas.find((entry) => normalize(entry.id) === "almacen") || areas[0]
  const purchaseUnit = source.purchase_unit || "Unidad/Pieza"
  const baseUnit = source.base_unit || purchaseUnit
  const quantity = normalizedNumber(source.quantity, 1, 0)
  const minimumQuantity = normalizedNumber(source.minimum_quantity, 0, 0)
  const conversionFactor = normalizedNumber(source.conversion_factor, 1, 0.0000001)
  const cost = normalizedNumber(source.cost_per_base_unit, 0, 0, true)
  const data = {
    ...source,
    purchase_unit: purchaseUnit,
    base_unit: baseUnit,
    area_id: warehouseArea?.id || "almacen",
    quantity: quantity.value,
    minimum_quantity: minimumQuantity.value,
    conversion_factor: conversionFactor.value,
    cost_per_base_unit: cost.value
  }
  if (!source.name) criticalErrors.push("Nombre vacío.")
  if (!source.category) criticalErrors.push("Categoría vacía.")
  if (!source.purchase_unit) corrections.push('Unidad de compra definida como "Unidad/Pieza".')
  if (!source.base_unit) corrections.push(`Unidad base definida como "${baseUnit}".`)
  if (!source.quantity || quantity.corrected) corrections.push("Cantidad definida automáticamente.")
  if (minimumQuantity.corrected) corrections.push("Punto mínimo corregido a 0.")
  if (conversionFactor.corrected) corrections.push("Unidades por empaque corregidas a 1.")
  if (cost.corrected) corrections.push(`Costo normalizado a ${cost.value}.`)
  if (source.area_id && normalize(source.area_id) !== "almacen" && normalize(source.area_id) !== normalize(warehouseArea?.name)) {
    corrections.push(`El inventario inicial se cargará en ${warehouseArea?.name || "Almacén"}.`)
  }
  const duplicateSkuInFile = data.sku && sourceRows.some((row, rowIndex) => (
    rowIndex !== index && normalize(row.sku) === normalize(data.sku)
  ))
  const existingBySku = data.sku && existingItems.find((item) => normalize(item.sku) === normalize(data.sku))
  if (duplicateSkuInFile || existingBySku) criticalErrors.push(`Código duplicado: ${data.sku}.`)
  const existingByName = !data.sku && existingItems.find((item) => normalize(item.name) === normalize(data.name))
  const needsNameDecision = Boolean(existingByName)
  if (needsNameDecision && !nameActions[index]) corrections.push("Ya existe un producto con este nombre y sin SKU; se creará nuevo al ignorar errores menores.")
  const messages = [...criticalErrors, ...corrections]
  return {
    index,
    data,
    areaName: warehouseArea?.name || "Almacén",
    messages: messages.length ? messages : ["Validación correcta."],
    needsNameDecision,
    critical: criticalErrors.length > 0,
    corrected: corrections.length > 0,
    status: criticalErrors.length ? "error" : needsNameDecision && !nameActions[index] ? "warning" : corrections.length ? "warning" : "ready",
    ready: !criticalErrors.length && (!needsNameDecision || Boolean(nameActions[index]))
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

function normalizedNumber(value, fallback, minimum, currency = false) {
  const original = String(value || "").trim()
  if (!original) return { value: fallback, corrected: true }
  let cleaned = original
  if (currency) cleaned = cleaned.replace(/[Qq]/g, "").replace(/\s+/g, "")
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const decimalMark = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : "."
    cleaned = decimalMark === "," ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "")
  } else {
    cleaned = cleaned.replace(",", ".")
  }
  const number = Number(cleaned)
  if (!Number.isFinite(number) || number < minimum) return { value: fallback, corrected: true }
  return { value: number, corrected: currency && cleaned !== original }
}

export default InventoryImportModal
