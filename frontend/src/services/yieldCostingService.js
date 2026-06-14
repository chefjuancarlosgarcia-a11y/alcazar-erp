import { supabase } from "../lib/supabase"
import { getReportDateRange } from "./reportsService"

function mapYieldProfile(row) {
  if (!row) return row
  const item = row.inventory_item || {}
  return {
    ...row,
    itemId: row.inventory_item_id,
    itemName: item.name || "",
    baseUnit: item.base_unit || "",
    weightedAverageCost: Number(item.weighted_average_cost ?? item.cost_per_base_unit ?? 0),
    usableCost: Number(item.usable_cost ?? item.cost_per_base_unit ?? 0),
    totalQuantity: Number(item.totalQuantity ?? 0),
    expectedYieldPercent: Number(row.expected_yield_percent ?? 100),
    minimumAcceptableYieldPercent: Number(row.minimum_acceptable_yield_percent ?? 90),
    historicalAverageYieldPercent: row.historical_average_yield_percent == null
      ? null
      : Number(row.historical_average_yield_percent)
  }
}

function mapAudit(row) {
  if (!row) return row
  return {
    ...row,
    itemName: row.inventory_item?.name || "",
    employeeName: row.employee?.name || row.employee?.username || "",
    wasteReasonName: row.waste_reason?.name || "",
    yieldPercent: Number(row.yield_percent || 0),
    variancePercent: row.variance_percent == null ? null : Number(row.variance_percent),
    initialWeight: Number(row.initial_weight || 0),
    usableWeight: Number(row.usable_weight || 0),
    wasteWeight: Number(row.waste_weight || 0)
  }
}

export function computeUsableStock(physicalStock, yieldPercent = 100) {
  const pct = Number(yieldPercent || 100) / 100
  const physical = Number(physicalStock || 0)
  const usable = physical * pct
  return {
    physical,
    usable: Number(usable.toFixed(4)),
    expectedWaste: Number((physical - usable).toFixed(4))
  }
}

export function computeCur(cpp, yieldPercent = 100) {
  const pct = Number(yieldPercent || 100) / 100
  if (!pct || !Number(cpp)) return 0
  return Number((Number(cpp) / pct).toFixed(4))
}

const profileSelect = `
  *,
  inventory_item:inventory_items(
    id, name, base_unit, category, cost_per_base_unit,
    weighted_average_cost, usable_cost, active,
    area_inventory(quantity)
  )
`

const auditSelect = `
  *,
  inventory_item:inventory_items(id, name, base_unit),
  employee:profiles!yield_audits_employee_id_fkey(id, name, username),
  waste_reason:yield_waste_reasons(id, name)
`

export async function getYieldProfiles() {
  const { data, error } = await supabase
    .from("inventory_yield_profiles")
    .select(profileSelect)
    .order("updated_at", { ascending: false })
  const mapped = (data || []).map((row) => {
    const stocks = row.inventory_item?.area_inventory || []
    const totalQuantity = stocks.reduce((sum, stock) => sum + Number(stock.quantity || 0), 0)
    return mapYieldProfile({ ...row, inventory_item: { ...row.inventory_item, totalQuantity } })
  })
  return { data: mapped, error }
}

export async function getYieldProfileByItemId(itemId) {
  const { data, error } = await supabase
    .from("inventory_yield_profiles")
    .select(profileSelect)
    .eq("inventory_item_id", itemId)
    .maybeSingle()
  if (error || !data) return { data: data ? mapYieldProfile(data) : null, error }
  const stocks = data.inventory_item?.area_inventory || []
  const totalQuantity = stocks.reduce((sum, stock) => sum + Number(stock.quantity || 0), 0)
  return { data: mapYieldProfile({ ...data, inventory_item: { ...data.inventory_item, totalQuantity } }), error: null }
}

export function upsertYieldProfile({ inventoryItemId, expectedYieldPercent, minimumAcceptableYieldPercent, notes, active = true }) {
  return supabase.rpc("upsert_inventory_yield_profile", {
    p_inventory_item_id: inventoryItemId,
    p_expected_yield_percent: Number(expectedYieldPercent),
    p_minimum_acceptable_yield_percent: Number(minimumAcceptableYieldPercent),
    p_notes: notes || null,
    p_active: active !== false
  })
}

export async function getYieldAuditsForItem(itemId, limit = 20) {
  const { data, error } = await supabase
    .from("yield_audits")
    .select(auditSelect)
    .eq("inventory_item_id", itemId)
    .order("audit_date", { ascending: false })
    .limit(limit)
  return { data: (data || []).map(mapAudit), error }
}

export async function getWasteReasons() {
  const { data, error } = await supabase
    .from("yield_waste_reasons")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
  return { data: data || [], error }
}

export async function getYieldAuditCampaigns() {
  const { data, error } = await supabase
    .from("yield_audit_campaigns")
    .select(`
      *,
      items:yield_audit_campaign_items(
        id, required, active,
        inventory_item:inventory_items(id, name, base_unit)
      )
    `)
    .order("created_at", { ascending: false })
  return { data: data || [], error }
}

export async function createYieldAuditCampaign(campaign) {
  const { data, error } = await supabase
    .from("yield_audit_campaigns")
    .insert({
      name: campaign.name?.trim(),
      description: campaign.description?.trim() || null,
      start_date: campaign.startDate || campaign.start_date,
      end_date: campaign.endDate || campaign.end_date || null,
      status: campaign.status || "draft",
      created_by: campaign.createdBy || null
    })
    .select("*")
    .single()
  return { data, error }
}

export async function updateYieldAuditCampaign(id, updates) {
  const { data, error } = await supabase
    .from("yield_audit_campaigns")
    .update({
      name: updates.name?.trim(),
      description: updates.description?.trim() || null,
      start_date: updates.startDate || updates.start_date,
      end_date: updates.endDate || updates.end_date || null,
      status: updates.status
    })
    .eq("id", id)
    .select("*")
    .single()
  return { data, error }
}

export async function setCampaignItems(campaignId, itemIds = []) {
  await supabase.from("yield_audit_campaign_items").delete().eq("campaign_id", campaignId)
  if (!itemIds.length) return { data: [], error: null }
  const rows = itemIds.map((itemId) => ({
    campaign_id: campaignId,
    inventory_item_id: itemId,
    required: true,
    active: true
  }))
  return supabase.from("yield_audit_campaign_items").insert(rows).select("*")
}

export async function getActiveCampaignRequiredItems() {
  const { data, error } = await supabase
    .from("yield_audit_campaigns")
    .select(`
      id, name, status, start_date, end_date,
      items:yield_audit_campaign_items(
        id, required, active,
        inventory_item:inventory_items(id, name, base_unit)
      )
    `)
    .eq("status", "active")
  const items = (data || []).flatMap((campaign) =>
    (campaign.items || [])
      .filter((row) => row.active && row.required)
      .map((row) => ({
        campaignId: campaign.id,
        campaignName: campaign.name,
        itemId: row.inventory_item?.id,
        itemName: row.inventory_item?.name,
        baseUnit: row.inventory_item?.base_unit
      }))
  )
  return { data: items, error }
}

export function submitYieldAudit(payload) {
  return supabase.rpc("submit_yield_audit", {
    p_campaign_id: payload.campaignId || null,
    p_inventory_item_id: payload.inventoryItemId,
    p_task_id: payload.taskId || null,
    p_production_area_id: payload.productionAreaId || null,
    p_employee_id: payload.employeeId || null,
    p_supervisor_id: payload.supervisorId || null,
    p_audit_date: payload.auditDate || new Date().toISOString().slice(0, 10),
    p_initial_weight: Number(payload.initialWeight),
    p_usable_weight: Number(payload.usableWeight),
    p_waste_reason_id: payload.wasteReasonId || null,
    p_notes: payload.notes || null,
    p_photo_urls: payload.photoUrls || []
  })
}

export async function hasYieldAuditForTask(taskId, itemId) {
  if (!taskId) return { data: false, error: null }
  const { data, error } = await supabase
    .from("yield_audits")
    .select("id")
    .eq("task_id", taskId)
    .eq("inventory_item_id", itemId)
    .maybeSingle()
  return { data: Boolean(data?.id), error }
}

export async function getRecipeCostHistory(recipeId, limit = 90) {
  const { data, error } = await supabase
    .from("recipe_cost_history")
    .select("*")
    .eq("recipe_id", recipeId)
    .order("recorded_at", { ascending: false })
    .limit(limit)
  return { data: data || [], error }
}

export async function refreshItemCosting(itemId) {
  return supabase.rpc("refresh_inventory_item_costing", { p_item_id: itemId })
}

export async function getYieldDashboardMetrics(filters = {}) {
  const range = getReportDateRange(filters)
  const start = range.start.slice(0, 10)
  const end = range.end.slice(0, 10)

  const [auditsResult, profilesResult, campaignsResult] = await Promise.all([
    supabase
      .from("yield_audits")
      .select(`
        *,
        inventory_item:inventory_items(id, name, usable_cost, weighted_average_cost),
        employee:profiles!yield_audits_employee_id_fkey(id, name, username)
      `)
      .gte("audit_date", start)
      .lte("audit_date", end),
    supabase.from("inventory_yield_profiles").select("*, inventory_item:inventory_items(id, name, usable_cost)").eq("active", true),
    supabase.from("yield_audit_campaigns").select("id, name, status").eq("status", "active")
  ])

  const audits = (auditsResult.data || []).map(mapAudit)
  const profiles = profilesResult.data || []

  const financialImpact = audits.reduce((sum, audit) => {
    const cost = Number(audit.inventory_item?.usable_cost || audit.inventory_item?.weighted_average_cost || 0)
    return sum + (Number(audit.waste_weight || 0) * cost)
  }, 0)

  const byItem = new Map()
  audits.forEach((audit) => {
    const key = audit.inventory_item_id
    const row = byItem.get(key) || {
      itemId: key,
      itemName: audit.itemName || audit.inventory_item?.name || "Sin nombre",
      audits: 0,
      avgYield: 0,
      totalWaste: 0,
      financialLoss: 0,
      yieldSum: 0
    }
    row.audits += 1
    row.yieldSum += Number(audit.yield_percent || 0)
    row.avgYield = row.yieldSum / row.audits
    row.totalWaste += Number(audit.waste_weight || 0)
    const cost = Number(audit.inventory_item?.usable_cost || 0)
    row.financialLoss += Number(audit.waste_weight || 0) * cost
    byItem.set(key, row)
  })

  const byEmployee = new Map()
  audits.forEach((audit) => {
    const key = audit.employee_id || "unknown"
    const row = byEmployee.get(key) || {
      employeeId: key,
      employeeName: audit.employeeName || "Sin asignar",
      audits: 0,
      avgYield: 0,
      avgVariance: 0,
      yieldSum: 0,
      varianceSum: 0
    }
    row.audits += 1
    row.yieldSum += Number(audit.yield_percent || 0)
    row.varianceSum += Number(audit.variance_percent || 0)
    row.avgYield = row.yieldSum / row.audits
    row.avgVariance = row.varianceSum / row.audits
    byEmployee.set(key, row)
  })

  const belowMinimum = audits.filter((audit) => {
    const profile = profiles.find((row) => row.inventory_item_id === audit.inventory_item_id)
    if (!profile) return false
    return Number(audit.yield_percent) < Number(profile.minimum_acceptable_yield_percent)
  })

  const pendingCampaignItems = (campaignsResult.data || []).length

  return {
    data: {
      summary: {
        totalAudits: audits.length,
        financialImpact,
        belowMinimumCount: belowMinimum.length,
        activeCampaigns: pendingCampaignItems,
        averageYield: audits.length
          ? audits.reduce((sum, audit) => sum + Number(audit.yield_percent || 0), 0) / audits.length
          : 0
      },
      topLossItems: [...byItem.values()].sort((a, b) => b.financialLoss - a.financialLoss).slice(0, 10),
      topDeviationEmployees: [...byEmployee.values()]
        .sort((a, b) => a.avgVariance - b.avgVariance)
        .slice(0, 10),
      alerts: belowMinimum.slice(0, 10).map((audit) => ({
        type: "yield_below_minimum",
        message: `${audit.itemName} presenta rendimiento ${audit.yield_percent}% inferior al mínimo.`,
        auditId: audit.id
      })),
      employeeScorecard: [...byEmployee.values()].map((row) => ({
        ...row,
        score: Math.max(0, Math.min(100, Math.round(100 + row.avgVariance)))
      }))
    },
    error: auditsResult.error || profilesResult.error || campaignsResult.error
  }
}
