export default function CompletenessBar({ completeness }) {
  const percent = Number(completeness?.percent ?? 0)
  const filled = completeness?.filled_count ?? 0
  const required = completeness?.required_count ?? 0

  return (
    <div className="expediente-progress">
      <div className="expediente-progress__meta">
        <strong>{percent}%</strong>
        <span>{filled} de {required} documentos</span>
      </div>
      <div className="expediente-progress__track" aria-hidden="true">
        <span className="expediente-progress__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  )
}
