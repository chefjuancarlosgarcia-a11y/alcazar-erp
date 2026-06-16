import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import { getExpedientesReport } from "./expedientesService"

export default function ExpedientesReports({ onClose }) {
  async function exportReport(type, format) {
    const result = await getExpedientesReport(type)
    if (result.error) {
      window.alert(result.error)
      return
    }
    const rows = Array.isArray(result.data) ? result.data : []
    if (!rows.length) {
      window.alert("No hay datos para exportar.")
      return
    }

    if (format === "xlsx") {
      const worksheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Expedientes")
      XLSX.writeFile(workbook, `expedientes-${type}.xlsx`)
      return
    }

    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text(`Reporte expedientes - ${type}`, 14, 16)
    autoTable(doc, {
      startY: 22,
      head: [Object.keys(rows[0])],
      body: rows.map((row) => Object.values(row))
    })
    doc.save(`expedientes-${type}.pdf`)
  }

  return (
    <div className="expediente-report-panel">
      <div className="expediente-report-panel__head">
        <h3>Reportes RRHH</h3>
        <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
      </div>
      <div className="expediente-report-grid">
        {[
          { type: "complete", label: "Expedientes completos" },
          { type: "expired", label: "Documentos vencidos" },
          { type: "expiring", label: "Documentos por vencer" }
        ].map((item) => (
          <article key={item.type} className="expediente-report-card">
            <h4>{item.label}</h4>
            <div className="expediente-actions">
              <button type="button" className="ghost" onClick={() => exportReport(item.type, "xlsx")}>Excel</button>
              <button type="button" className="primary" onClick={() => exportReport(item.type, "pdf")}>PDF</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
