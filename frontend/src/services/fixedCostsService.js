import { supabase } from "../lib/supabase"

export const FIXED_COST_CATEGORIES = [
  ["renta", "Renta"],
  ["servicios_basicos", "Servicios basicos"],
  ["internet_telefono", "Internet / telefono"],
  ["planilla_administrativa", "Planilla administrativa"],
  ["software_suscripciones", "Software / suscripciones"],
  ["mantenimiento", "Mantenimiento"],
  ["seguros", "Seguros"],
  ["impuestos", "Impuestos"],
  ["financiamiento", "Financiamiento / prestamos"],
  ["otros", "Otros"]
]

export const FIXED_COST_FREQUENCIES = [
  ["monthly", "Mensual"],
  ["quarterly", "Trimestral"],
  ["annual", "Anual"]
]

export const FIXED_COST_PAYMENT_STATUSES = [
  ["pending", "Pendiente"],
  ["paid", "Pagado"],
  ["overdue", "Vencido"],
  ["cancelled", "Cancelado"]
]

export function fixedCostCategoryLabel(value) {
  return FIXED_COST_CATEGORIES.find(([key]) => key === value)?.[1] || value || "-"
}

export function fixedCostFrequencyLabel(value) {
  return FIXED_COST_FREQUENCIES.find(([key]) => key === value)?.[1] || value || "-"
}

export function fixedCostPaymentStatusLabel(value) {
  return FIXED_COST_PAYMENT_STATUSES.find(([key]) => key === value)?.[1] || value || "-"
}

export function monthInputToCostMonth(monthValue) {
  if (!monthValue) return new Date().toISOString().slice(0, 7) + "-01"
  return `${monthValue}-01`
}

export function emptyFixedCostForm(monthValue = "") {
  const month = monthValue || new Date().toISOString().slice(0, 7)
  return {
    id: "",
    name: "",
    category: "renta",
    amount: "",
    frequency: "monthly",
    cost_month: monthInputToCostMonth(month),
    due_day: "",
    payment_status: "pending",
    notes: "",
    is_active: true
  }
}

function normalizeReportPayload(data) {
  if (!data || typeof data !== "object") {
    return { costs: [], summary: {}, cost_month: null }
  }
  return {
    cost_month: data.cost_month || null,
    costs: Array.isArray(data.costs) ? data.costs : [],
    summary: data.summary && typeof data.summary === "object" ? data.summary : {}
  }
}

export async function getFixedCostsByMonth(monthValue) {
  const costMonth = monthInputToCostMonth(monthValue)
  const { data, error } = await supabase.rpc("get_fixed_costs_by_month", { p_month: costMonth })
  if (error) return { data: null, error: error.message || "No se pudieron cargar los costos fijos." }
  return { data: normalizeReportPayload(data), error: "" }
}

export async function upsertFixedCost(cost) {
  const payload = {
    id: cost.id || null,
    name: cost.name?.trim(),
    category: cost.category,
    amount: Number(cost.amount || 0),
    frequency: cost.frequency || "monthly",
    cost_month: cost.cost_month || monthInputToCostMonth(),
    due_day: cost.due_day === "" || cost.due_day == null ? null : Number(cost.due_day),
    payment_status: cost.payment_status || "pending",
    notes: cost.notes?.trim() || null,
    is_active: cost.is_active !== false
  }
  const { data, error } = await supabase.rpc("upsert_fixed_cost", { p_data: payload })
  return { data, error: error ? { message: error.message } : null }
}

export async function deactivateFixedCost(id) {
  const { data, error } = await supabase.rpc("deactivate_fixed_cost", { p_id: id })
  return { data, error: error ? { message: error.message } : null }
}

export async function markFixedCostPaid(cost) {
  return upsertFixedCost({
    ...cost,
    payment_status: "paid"
  })
}

export async function copyFixedCostsFromPreviousMonth(monthValue) {
  const { data, error } = await supabase.rpc("copy_fixed_costs_from_previous_month", {
    p_target_month: monthInputToCostMonth(monthValue)
  })
  return { data, error: error ? { message: error.message } : null }
}

export async function generateMonthlyFixedCostReviewNotifications(monthValue) {
  const { data, error } = await supabase.rpc("generate_monthly_fixed_cost_review_notifications", {
    p_month: monthInputToCostMonth(monthValue)
  })
  return { data, error: error ? { message: error.message } : null }
}
