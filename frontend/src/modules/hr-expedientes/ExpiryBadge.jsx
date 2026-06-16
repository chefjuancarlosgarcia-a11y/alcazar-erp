import { EXPIRY_STATUS, expiryClass } from "./expedientesUtils"

export default function ExpiryBadge({ status }) {
  const meta = EXPIRY_STATUS[status] || EXPIRY_STATUS.none
  return <span className={expiryClass(status)}>{meta.label}</span>
}
