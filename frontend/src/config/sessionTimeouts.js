export const IDLE_WARNING_SECONDS = 60

export const SESSION_TIMEOUTS_BY_ROLE_MINUTES = {
  admin: 20,
  gerente_general: 20,
  rrhh: 20,
  recursos_humanos: 20,
  supervisor: 15,
  colaborador: 15,
  operativo: 15,
  caja: 45,
  cajero: 45,
  cocina: 45,
  cocinero: 45,
  pizzeria: 45,
  pizzero: 45,
  kds: 60,
  terminal: 45,
  default: 15
}

export const IDLE_ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click"
]

export function getSessionTimeoutMinutes(role) {
  return SESSION_TIMEOUTS_BY_ROLE_MINUTES[String(role || "").trim().toLowerCase()] || SESSION_TIMEOUTS_BY_ROLE_MINUTES.default
}
