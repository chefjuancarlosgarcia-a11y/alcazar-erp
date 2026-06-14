export default function ProductionToast({ message, tone = "info" }) {
  if (!message) return null
  return (
    <div className={`production-toast production-toast--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {message}
    </div>
  )
}
