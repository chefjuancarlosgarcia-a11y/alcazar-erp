import { supabase } from "../lib/supabase"
import { cashSummary } from "./cashService"
import { runStationCashIdempotentRpc } from "./stationCashIdempotency"

function normalizeMovement(row) {
  if (!row) return row
  const creator = row.creator || {}
  return {
    ...row,
    creator: typeof creator === "object" ? creator : { full_name: creator }
  }
}

function unwrapRpcJson(data) {
  if (!data || typeof data !== "object") return data
  if (data.idempotency_status === "completed") {
    const copy = { ...data }
    delete copy.idempotency_status
    return copy
  }
  return data
}

export function createStationCashPort(operatorSessionToken, { onOperatorLocked, onContextLoaded } = {}) {
  const token = operatorSessionToken

  async function loadContext() {
    const { data, error } = await supabase.rpc("get_station_cash_context", {
      p_operator_session_token: token
    })
    if (error) return { error, data: null }
    const ctx = data
    if (ctx?.idle_expires_at) onContextLoaded?.(ctx.idle_expires_at)
    const movements = (ctx?.movements || []).map(normalizeMovement)
    const sessions = (ctx?.recent_closed_sessions || []).map((s) => ({
      ...s,
      register: s.register || { name: ctx?.register?.name }
    }))
    return {
      error: null,
      data: {
        stationName: ctx?.station_name,
        register: ctx?.register,
        registerId: ctx?.cash_register_id,
        operatorName: ctx?.operator_name,
        canSupervise: Boolean(ctx?.can_supervise),
        canCloseSession: Boolean(ctx?.can_close_session),
        session: ctx?.open_session || null,
        movements,
        sessions,
        idleExpiresAt: ctx?.idle_expires_at
      }
    }
  }

  return {
    mode: "station",
    async load() {
      return loadContext()
    },
    async openCashSession(registerId, openingAmount, notes) {
      void registerId
      const payload = {
        openingAmount: Number(openingAmount || 0),
        notes: notes || ""
      }
      const result = await runStationCashIdempotentRpc("open", payload, (idempotencyKey) =>
        supabase.rpc("open_station_cash_session", {
          p_operator_session_token: token,
          p_opening_amount: payload.openingAmount,
          p_notes: payload.notes || null,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return {
          data: null,
          error: result.error,
          idempotencyUnknown: Boolean(result.idempotencyUnknown)
        }
      }
      const body = unwrapRpcJson(result.data)
      return { data: body?.session, error: null }
    },
    async createCashMovement({ sessionId, movementType, amount, reason, reference, orderId }) {
      void sessionId
      const payload = {
        movementType,
        amount: Number(amount || 0),
        reason: reason || "",
        reference: reference || "",
        orderId: orderId || null
      }
      const result = await runStationCashIdempotentRpc("movement", payload, (idempotencyKey) =>
        supabase.rpc("create_station_cash_movement", {
          p_operator_session_token: token,
          p_movement_type: payload.movementType,
          p_amount: payload.amount,
          p_reason: payload.reason || null,
          p_reference: payload.reference || null,
          p_order_id: payload.orderId,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return {
          data: null,
          error: result.error,
          operatorLocked: false,
          idempotencyUnknown: Boolean(result.idempotencyUnknown)
        }
      }
      const body = unwrapRpcJson(result.data)
      if (movementType === "sale_cash" && body?.operator_locked) {
        onOperatorLocked?.("sale_complete")
      }
      return {
        data: body?.movement,
        error: null,
        operatorLocked: Boolean(body?.operator_locked)
      }
    },
    async closeCashSession(sessionId, countedCash, notes) {
      void sessionId
      const payload = {
        countedCash: Number(countedCash || 0),
        notes: notes || ""
      }
      const result = await runStationCashIdempotentRpc("close", payload, (idempotencyKey) =>
        supabase.rpc("close_station_cash_session", {
          p_operator_session_token: token,
          p_counted_cash: payload.countedCash,
          p_notes: payload.notes || null,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return {
          data: null,
          error: result.error,
          operatorLocked: false,
          idempotencyUnknown: Boolean(result.idempotencyUnknown)
        }
      }
      const body = unwrapRpcJson(result.data)
      if (body?.operator_locked) onOperatorLocked?.("shift_close")
      return {
        data: body?.session,
        error: null,
        operatorLocked: Boolean(body?.operator_locked)
      }
    },
    cashSummary,
    async recordCashSale(orderId, amount) {
      const payload = {
        orderId: orderId || null,
        amount: Number(amount || 0)
      }
      const result = await runStationCashIdempotentRpc("sale", payload, (idempotencyKey) =>
        supabase.rpc("record_station_cash_sale", {
          p_operator_session_token: token,
          p_order_id: payload.orderId,
          p_amount: payload.amount,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return {
          data: null,
          error: result.error,
          idempotencyUnknown: Boolean(result.idempotencyUnknown)
        }
      }
      const body = unwrapRpcJson(result.data)
      if (body?.operator_locked) onOperatorLocked?.("sale_complete")
      return { data: body?.movement, error: null }
    }
  }
}
