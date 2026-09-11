import { useMemo, useState } from "react"
import * as XLSX from "xlsx"
import {
  importFinanceChartAccounts,
  previewFinanceChartAccountsImport
} from "../../services/financeChartAccountsService"
import { normalizeImportRow, validateChartAccountImportRows } from "../../utils/financeChartAccountsValidation"

const STEPS = ["Archivo", "Validación", "Confirmación"]

function mapRowsForServer(rows) {
  return rows.map((rawRow) => {
    const row = normalizeImportRow(rawRow)
    return {
      codigo: row.codigo ?? "",
      nombre: row.nombre ?? "",
      codigo_padre: row.codigo_padre ?? "",
      tipo_financiero: row.tipo_financiero ?? "",
      naturaleza: row.naturaleza ?? "",
      tipo_cuenta: row.tipo_cuenta ?? "",
      acepta_movimientos: row.acepta_movimientos ?? "",
      descripcion: row.descripcion ?? ""
    }
  })
}

export default function FinanceChartAccountsImportModal({ existingCodes, onClose, onImported, notify }) {
  const [step, setStep] = useState(0)
  const [fileName, setFileName] = useState("")
  const [rawRows, setRawRows] = useState([])
  const [parseError, setParseError] = useState("")
  const [serverPreview, setServerPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const clientPreview = useMemo(
    () => validateChartAccountImportRows(rawRows, existingCodes),
    [existingCodes, rawRows]
  )

  async function readFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setParseError("")
    setServerPreview(null)
    setImportResult(null)
    setStep(0)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array", raw: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
      if (!rows.length) {
        setParseError("El archivo no contiene filas para importar.")
        setRawRows([])
        return
      }
      setFileName(file.name)
      setRawRows(rows)
    } catch {
      setParseError("No se pudo leer el archivo. Usa CSV o Excel válido.")
      setRawRows([])
    }
  }

  async function runServerPreview() {
    if (!rawRows.length) return notify("Selecciona un archivo con filas.", "error")
    setPreviewLoading(true)
    setParseError("")
    const payload = mapRowsForServer(rawRows)
    const result = await previewFinanceChartAccountsImport(payload)
    setPreviewLoading(false)
    if (result.error) {
      setParseError(result.error)
      return
    }
    setServerPreview(result.data)
    setStep(1)
  }

  async function confirmImport() {
    const preview = serverPreview || clientPreview
    if (preview.blocking_errors) {
      return notify("Corrige los errores bloqueantes antes de importar.", "error")
    }
    setImporting(true)
    setParseError("")
    const payload = mapRowsForServer(rawRows)
    const result = await importFinanceChartAccounts(payload)
    setImporting(false)
    if (result.error) {
      setParseError(result.error)
      return
    }
    setImportResult(result.data)
    setStep(2)
  }

  const activePreview = serverPreview || clientPreview

  return (
    <div className="finance-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="finance-modal finance-chart-import-modal"
        role="dialog"
        aria-labelledby="chart-import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="chart-import-title">Importar catálogo contable</h2>
            <p className="tasks-muted">CSV o Excel (.xlsx). La importación es atómica: si hay errores, no se guarda ninguna fila.</p>
          </div>
          <button type="button" className="tasks-link" onClick={onClose}>Cerrar</button>
        </header>

        <nav className="finance-chart-import-steps" aria-label="Pasos de importación">
          {STEPS.map((label, index) => (
            <span key={label} className={step >= index ? "active" : ""}>
              {index + 1}. {label}
            </span>
          ))}
        </nav>

        {step === 0 ? (
          <div className="finance-chart-import-body">
            <label className="finance-field finance-field--full">
              <span>Archivo</span>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={readFile} />
            </label>
            {fileName ? <p className="tasks-muted">Archivo: {fileName} · {rawRows.length} filas leídas</p> : null}
            {parseError ? <p className="finance-message error">{parseError}</p> : null}
            <div className="finance-actions">
              <button type="button" className="tasks-primary" disabled={!rawRows.length || previewLoading} onClick={runServerPreview}>
                {previewLoading ? "Validando..." : "Continuar a validación"}
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="finance-chart-import-body">
            <div className="finance-kpi-grid finance-chart-import-kpis">
              <article className="finance-kpi-card"><span>Filas leídas</span><strong>{activePreview.rows_read}</strong></article>
              <article className="finance-kpi-card"><span>Válidas</span><strong>{activePreview.valid_rows}</strong></article>
              <article className="finance-kpi-card"><span>Con errores</span><strong>{activePreview.error_rows}</strong></article>
              <article className="finance-kpi-card"><span>Nuevas cuentas</span><strong>{activePreview.new_accounts}</strong></article>
              <article className="finance-kpi-card"><span>Duplicados</span><strong>{activePreview.duplicates}</strong></article>
            </div>

            {activePreview.errors?.length ? (
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr><th>Fila</th><th>Campo</th><th>Error</th></tr>
                  </thead>
                  <tbody>
                    {activePreview.errors.map((entry, index) => (
                      <tr key={`${entry.row_number}-${entry.field}-${index}`}>
                        <td>{entry.row_number}</td>
                        <td>{entry.field}</td>
                        <td>{entry.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="finance-message success">Todas las filas pasaron la validación.</p>
            )}

            {parseError ? <p className="finance-message error">{parseError}</p> : null}

            <div className="finance-actions">
              <button type="button" className="tasks-secondary" onClick={() => setStep(0)}>Volver</button>
              <button
                type="button"
                className="tasks-primary"
                disabled={activePreview.blocking_errors || importing}
                onClick={confirmImport}
              >
                {importing ? "Importando..." : "Confirmar importación"}
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="finance-chart-import-body">
            <p className="finance-message success">
              Importación completada: {importResult?.imported ?? 0} cuentas creadas.
            </p>
            <div className="finance-actions">
              <button type="button" className="tasks-primary" onClick={onImported}>Cerrar y actualizar</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
