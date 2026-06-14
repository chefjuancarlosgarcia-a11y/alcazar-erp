import { useNavigate } from "react-router-dom"

export default function ProductionBackButton({ to = "/production", label = "Regresar a Producción" }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="production-back-btn" onClick={() => navigate(to)}>
      ← {label}
    </button>
  )
}
