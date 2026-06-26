import { Link } from "react-router-dom"
import { buildFinanceOriginUrl, FINANCE_SOURCE_LABELS } from "../modules/finance/financeUtils"

export default function FinanceOriginLink({ sourceModule, sourceId, className = "finance-origin-link" }) {
  if (!sourceModule || sourceModule === "manual") {
    return <span className={className}>Creado manualmente</span>
  }

  const href = buildFinanceOriginUrl(sourceModule, sourceId)
  const label = FINANCE_SOURCE_LABELS[sourceModule] || "Ver origen"

  if (!href) {
    return <span className={className}>{label}</span>
  }

  return (
    <Link to={href} className={className}>
      Ver origen
    </Link>
  )
}
