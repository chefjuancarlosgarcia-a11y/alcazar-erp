import { formatMinutes, getSlaState, slaClass } from "./cateringUtils"

export default function CateringSlaBadge({ request }) {
  const sla = getSlaState(request)
  if (sla.level === "responded") {
    return <span className={slaClass("green")}>Atendido</span>
  }
  return (
    <span className={slaClass(sla.level)} title="Tiempo sin atender">
      {sla.label}
    </span>
  )
}

export function CateringResponseTime({ minutes }) {
  return <span className="catering-response-time">{formatMinutes(minutes)}</span>
}
