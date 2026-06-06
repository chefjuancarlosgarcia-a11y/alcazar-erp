import { supabase } from "../lib/supabase"

const CASH_REGISTER_SELECT = "*"
const CASH_SESSION_SELECT = "*, register:cash_registers(name, location), opener:profiles!cash_sessions_opened_by_fkey(full_name, username), closer:profiles!cash_sessions_closed_by_fkey(full_name, username)"
const CASH_MOVEMENT_SELECT = "*, creator:profiles!cash_movements_created_by_fkey(full_name, username), authorizer:profiles!cash_movements_authorized_by_fkey(full_name, username)"

export function getCashRegisters() {
  return supabase
    .from("cash_registers")
    .select(CASH_REGISTER_SELECT)
    .eq("status", "active")
    .order("name")
}

export function getOpenCashSession(cashRegisterId) {
  let query = supabase
    .from("cash_sessions")
    .select(CASH_SESSION_SELECT)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
  if (cashRegisterId) query = query.eq("cash_register_id", cashRegisterId)
  return query.maybeSingle()
}

export function getCashSessions(limit = 20) {
  return supabase
    .from("cash_sessions")
    .select(CASH_SESSION_SELECT)
    .order("opened_at", { ascending: false })
    .limit(limit)
}

export function getCashMovements(sessionId) {
  if (!sessionId) return Promise.resolve({ data: [], error: null })
  return supabase
    .from("cash_movements")
    .select(CASH_MOVEMENT_SELECT)
    .eq("cash_session_id", sessionId)
    .order("created_at", { ascending: false })
}

export function openCashSession(cashRegisterId, openingAmount, notes) {
  return supabase.rpc("open_cash_session", {
    p_cash_register_id: cashRegisterId,
    p_opening_amount: Number(openingAmount || 0),
    p_notes: notes || null
  })
}

export function createCashMovement({ sessionId, movementType, amount, reason, reference, orderId }) {
  return supabase.rpc("create_cash_movement", {
    p_cash_session_id: sessionId,
    p_movement_type: movementType,
    p_amount: Number(amount || 0),
    p_reason: reason || null,
    p_reference: reference || null,
    p_order_id: orderId || null
  })
}

export function closeCashSession(sessionId, countedCash, notes) {
  return supabase.rpc("close_cash_session", {
    p_cash_session_id: sessionId,
    p_counted_cash: Number(countedCash || 0),
    p_notes: notes || null
  })
}

export function recordCashSale(orderId, amount) {
  return supabase.rpc("record_cash_sale", {
    p_order_id: orderId,
    p_amount: Number(amount || 0)
  })
}

export function cashSummary(session, movements = []) {
  const totals = movements.reduce((result, movement) => {
    const amount = Number(movement.amount || 0)
    if (movement.movement_type === "sale_cash") result.sales += amount
    if (movement.movement_type === "deposit") result.deposits += amount
    if (movement.movement_type === "withdrawal") result.withdrawals += amount
    if (movement.movement_type === "refund") result.refunds += amount
    if (movement.movement_type === "adjustment") result.adjustments += amount
    return result
  }, { sales: 0, deposits: 0, withdrawals: 0, refunds: 0, adjustments: 0 })

  const opening = Number(session?.opening_amount || 0)
  const expected = opening + totals.sales + totals.deposits - totals.withdrawals - totals.refunds + totals.adjustments
  return { opening, expected, ...totals }
}
