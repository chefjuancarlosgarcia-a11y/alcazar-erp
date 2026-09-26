import { useSearchParams } from "react-router-dom"
import FinanceGeneralJournalTab from "./FinanceGeneralJournalTab"
import { GENERAL_JOURNAL_COMING_SOON_REPORTS } from "../../utils/financeGeneralJournalConstants"
import "./Finance.css"

const REPORTS = [
  { key: "libro-diario", label: "Libro Diario", available: true },
  ...GENERAL_JOURNAL_COMING_SOON_REPORTS.map((item) => ({ ...item, available: false }))
]

export default function FinanceAccountingReportsTab({ user, notify }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const report = searchParams.get("report") || "libro-diario"

  function setReport(nextReport) {
    setSearchParams({ tab: "reportes", report: nextReport })
  }

  return (
    <div className="finance-reports">
      <nav className="finance-reports-nav" aria-label="Reportes contables">
        {REPORTS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={[
              report === item.key ? "active" : "",
              item.available ? "" : "is-soon"
            ].filter(Boolean).join(" ")}
            onClick={() => item.available && setReport(item.key)}
            disabled={!item.available}
            aria-disabled={!item.available}
          >
            {item.label}
            {!item.available ? <span className="finance-reports-soon">Próximamente</span> : null}
          </button>
        ))}
      </nav>

      {report === "libro-diario" ? (
        <FinanceGeneralJournalTab user={user} notify={notify} />
      ) : (
        <article className="finance-panel">
          <p className="tasks-muted">Este reporte estará disponible en una fase posterior.</p>
        </article>
      )}
    </div>
  )
}
