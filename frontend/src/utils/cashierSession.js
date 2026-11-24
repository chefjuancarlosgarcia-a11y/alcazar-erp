export const UNVERIFIED_CASH_MESSAGE = "No se pudo verificar el estado de la caja"
export const LOCAL_RECONCILE_MESSAGE = "Esta apertura solo está en este dispositivo y requiere conciliación."
export const LOCAL_BESIDE_REMOTE_MESSAGE = "Este dispositivo también conserva una apertura local que no es la sesión del servidor."

const SERVER_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isServerSessionId(id) {
  return SERVER_SESSION_ID.test(String(id || ""))
}

export function preferredRegisterId(registers = [], selectedId = "") {
  const list = registers || []
  if (selectedId && list.some((item) => String(item.id) === String(selectedId))) return selectedId
  const principal = list.find((item) => String(item.name || "").trim().toLowerCase() === "caja principal")
  return principal?.id || list[0]?.id || ""
}

function openLocalSession(localSession) {
  if (!localSession || localSession.status !== "open" || isServerSessionId(localSession.id)) return null
  return localSession
}

function describeRemoteSession(remoteSession, register) {
  return {
    id: remoteSession.id,
    shared: true,
    registerId: remoteSession.cash_register_id || register?.id || "",
    registerName: register?.name || remoteSession.register?.name || "Caja",
    openerName: remoteSession.opener?.full_name || remoteSession.opener?.username || "Sin responsable",
    openerId: remoteSession.opened_by || "",
    openedAt: remoteSession.opened_at || "",
    openingAmount: Number(remoteSession.opening_amount || 0)
  }
}

function describeLocalSession(localSession, register) {
  return {
    id: localSession.id,
    shared: false,
    registerId: register?.id || "",
    registerName: register?.name || "Caja",
    openerName: localSession.cashierName || "Sin responsable",
    openerId: localSession.cashierId || "",
    openedAt: localSession.openedAt || "",
    openingAmount: Number(localSession.openingAmount || 0)
  }
}

function preservedLocal(localSession, message) {
  return {
    openingAmount: Number(localSession.openingAmount || 0),
    openedAt: localSession.openedAt || "",
    cashierName: localSession.cashierName || "Sin responsable",
    preserved: true,
    message
  }
}

export function resolveCashSessionView({ remoteAvailable = false, remoteSession = null, localSession = null, register = null } = {}) {
  const local = openLocalSession(localSession)
  if (!remoteAvailable) {
    return {
      status: "unverified",
      message: UNVERIFIED_CASH_MESSAGE,
      canOpen: false,
      canCharge: Boolean(local),
      showOpeningForm: false,
      session: local ? describeLocalSession(local, register) : null,
      reconciliation: local ? preservedLocal(local, UNVERIFIED_CASH_MESSAGE) : null
    }
  }

  if (remoteSession?.id && remoteSession.status !== "closed") {
    const beside = local && String(local.id) !== String(remoteSession.id)
    return {
      status: "open",
      message: "",
      canOpen: false,
      canCharge: true,
      showOpeningForm: false,
      session: describeRemoteSession(remoteSession, register),
      reconciliation: beside ? preservedLocal(local, LOCAL_BESIDE_REMOTE_MESSAGE) : null
    }
  }

  if (local) {
    return {
      status: "local_only",
      message: LOCAL_RECONCILE_MESSAGE,
      canOpen: false,
      canCharge: true,
      showOpeningForm: false,
      session: describeLocalSession(local, register),
      reconciliation: preservedLocal(local, LOCAL_RECONCILE_MESSAGE)
    }
  }

  return {
    status: "closed",
    message: "",
    canOpen: true,
    canCharge: false,
    showOpeningForm: true,
    session: null,
    reconciliation: null
  }
}

export function openingAmountToSubmit({ canOpen, typedAmount }) {
  if (!canOpen) return null
  if (String(typedAmount ?? "").trim() === "") return null
  const amount = Number(typedAmount)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount * 100) / 100
}

export function cashChargeTarget(sessions = [], requestedSessionId = "") {
  const requested = (sessions || []).find((item) => String(item.id) === String(requestedSessionId))
  if (!requested || requested.status !== "open") {
    return { ok: false, message: "No hay caja abierta para esta sesion." }
  }
  return { ok: true, cashSessionId: requested.id, registerId: requested.registerId || "" }
}

export function cashDrawerAmount(methods = [], billTotal = 0) {
  const active = (methods || []).filter((method) => Number(method.amount) > 0)
  const paid = active.reduce((sum, method) => sum + Number(method.amount), 0)
  const cash = active
    .filter((method) => method.method === "cash")
    .reduce((sum, method) => sum + Number(method.amount), 0)
  const total = Number(billTotal)
  if (!Number.isFinite(total) || total < 0 || paid + 0.001 < total) return null
  const change = Math.max(0, Math.round((paid - total) * 100) / 100)
  if (change > cash) return null
  return Math.round((cash - change) * 100) / 100
}

export function paymentBinding(session, actor) {
  if (!session?.id) return null
  return {
    cashSessionId: session.id,
    cashierId: actor?.id || actor?.username || "",
    cashierName: actor?.name || actor?.username || "",
    openerId: session.openerId || "",
    openerName: session.openerName || ""
  }
}

export function firstConfirmedOpening(attempts = []) {
  return (attempts || []).find((item) => item.confirmed) || null
}

export function applyAuthorizedAdjustment(session, movement) {
  if (!String(movement?.reason || "").trim() || !String(movement?.author || "").trim()) {
    return { ok: false, session, message: "El ajuste requiere motivo y autor." }
  }
  return {
    ok: true,
    session: {
      ...session,
      openingAmount: session.openingAmount,
      openerId: session.openerId,
      openedAt: session.openedAt,
      registerId: session.registerId,
      movements: [...(session.movements || []), { ...movement, type: "adjustment" }]
    }
  }
}

export function shiftAfterAuthorizedClose(closedSession, nextSession) {
  if (!closedSession || closedSession.status !== "closed") return { ok: false }
  if (!nextSession || nextSession.status !== "open") return { ok: false }
  if (String(nextSession.id) === String(closedSession.id)) return { ok: false }
  return {
    ok: true,
    openingAmount: Number(nextSession.openingAmount),
    previousOpeningAmount: Number(closedSession.openingAmount)
  }
}
