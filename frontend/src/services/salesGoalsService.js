import { supabase } from "../lib/supabase"

function message(error) {
  return typeof error === "string" ? error : error?.message || "No fue posible consultar metas de ventas."
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

function monthDate(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) return `${value}-01`
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10)
}

export function currentGoalMonth() {
  return monthDate()
}

export async function getPublicMonthlyGoalProgress(month = currentGoalMonth()) {
  const { data, error } = await supabase.rpc("get_public_monthly_goal_progress", { p_month: monthDate(month) })
  return result(data, error)
}

export async function getMonthlyGoalReport(month = currentGoalMonth()) {
  const { data, error } = await supabase.rpc("get_monthly_goal_report", { p_month: monthDate(month) })
  return result(data, error)
}

export async function getWaiterSalesRanking(month = currentGoalMonth(), publicMode = false) {
  const { data, error } = await supabase.rpc("get_waiter_sales_ranking", {
    p_month: monthDate(month),
    p_public: publicMode
  })
  return result(Array.isArray(data) ? data : [], error)
}

export async function listSalesGoals() {
  const { data, error } = await supabase
    .from("sales_goals")
    .select("*")
    .order("goal_month", { ascending: false })
    .order("created_at", { ascending: false })
  return result(Array.isArray(data) ? data : [], error)
}

export async function saveSalesGoal(payload) {
  const { data, error } = await supabase.rpc("save_sales_goal", {
    p_data: {
      ...payload,
      goal_month: monthDate(payload.goal_month || payload.month || currentGoalMonth()),
      description: payload.description ?? payload.notes ?? ""
    }
  })
  return result(data, error)
}
