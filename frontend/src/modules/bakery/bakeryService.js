import { supabase } from "../../lib/supabase"

const EVIDENCE_BUCKET = "bakery-evidence"

export async function uploadBakeryPhoto(file, folder = "general") {
  if (!file) return { data: null, error: new Error("Selecciona una foto.") }

  const allowed = ["image/jpeg", "image/png", "image/webp"]
  if (!allowed.includes(file.type)) {
    return { data: null, error: new Error("Formato no permitido. Usa JPG, PNG o WebP.") }
  }
  if (file.size > 10 * 1024 * 1024) {
    return { data: null, error: new Error("La foto no puede superar 10 MB.") }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const path = `${folder}/${Date.now()}-${safeName}`

  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false })

  if (error) return { data: null, error }

  const { data: urlData } = supabase.storage.from(EVIDENCE_BUCKET).getPublicUrl(path)
  return { data: { path, publicUrl: urlData.publicUrl }, error: null }
}

export function listBakeryPlanItems(filters = {}) {
  let query = supabase
    .from("bakery_production_plan_items")
    .select("*")
    .order("required_date", { ascending: true })
    .order("priority", { ascending: false })

  if (filters.fromDate) query = query.gte("required_date", filters.fromDate)
  if (filters.toDate) query = query.lte("required_date", filters.toDate)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo)
  if (filters.destinationAreaId) query = query.eq("destination_area_id", filters.destinationAreaId)

  return query
}

export function createBakeryPlanItem(payload) {
  return supabase.from("bakery_production_plan_items").insert(payload).select("*").single()
}

export function updateBakeryPlanItem(id, payload) {
  return supabase.from("bakery_production_plan_items").update(payload).eq("id", id).select("*").single()
}

export function listBakeryBatches(filters = {}) {
  let query = supabase
    .from("bakery_production_batches")
    .select("*")
    .order("created_at", { ascending: false })

  if (filters.status) query = query.eq("status", filters.status)
  if (filters.planItemId) query = query.eq("plan_item_id", filters.planItemId)

  return query
}

export function getBakeryBatch(id) {
  return supabase.from("bakery_production_batches").select("*").eq("id", id).single()
}

export function startBakeryProductionFromPlan(planItemId) {
  return supabase.rpc("start_bakery_production_from_plan", { p_plan_item_id: planItemId })
}

export function getBakeryDiaryEntry(batchId) {
  return supabase.from("bakery_production_diary_entries").select("*").eq("batch_id", batchId).maybeSingle()
}

export function saveBakeryDiaryEntry(payload) {
  return supabase.rpc("save_bakery_diary_entry", { p_payload: payload })
}

export function deliverBakeryBatch(batchId, deliveredQuantity, qualityResult, photoUrl, notes = null) {
  return supabase.rpc("deliver_bakery_production_batch", {
    p_batch_id: batchId,
    p_delivered_quantity: deliveredQuantity,
    p_quality_result: qualityResult,
    p_photo_url: photoUrl,
    p_notes: notes
  })
}

export function listBakeryDoughBatches() {
  return supabase
    .from("bakery_dough_batches")
    .select("*")
    .order("created_at", { ascending: false })
}

export function createBakeryDoughBatch(payload) {
  return supabase.rpc("create_bakery_dough_batch", { p_payload: payload })
}

export function updateBakeryDoughStatus(doughBatchId, status, notes = null) {
  return supabase.rpc("update_bakery_dough_batch_status", {
    p_dough_batch_id: doughBatchId,
    p_status: status,
    p_notes: notes
  })
}

export function registerBakeryWaste(payload) {
  return supabase.rpc("register_bakery_waste", { p_payload: payload })
}

export function listBakeryWasteRecords(limit = 50) {
  return supabase
    .from("bakery_waste_records")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
}

export function getBakerySupervisorDashboard() {
  return supabase.rpc("get_bakery_supervisor_dashboard")
}

export function listBakeryBatchPhotos(batchId) {
  return supabase
    .from("bakery_production_batch_photos")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: false })
}
