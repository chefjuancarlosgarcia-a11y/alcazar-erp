import { DOCUMENT_STATUS, expiryClass } from "./expedientesUtils"

export default function DocumentStatusBadge({ status }) {
  const meta = DOCUMENT_STATUS[status] || DOCUMENT_STATUS.empty
  return <span className={expiryClass(status)}>{meta.label}</span>
}
