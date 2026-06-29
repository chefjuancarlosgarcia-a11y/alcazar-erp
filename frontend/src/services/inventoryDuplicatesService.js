import { supabase } from "../lib/supabase"

export async function listDuplicateIgnores() {
  const { data, error } = await supabase
    .from("inventory_duplicate_ignore")
    .select("item_a_id, item_b_id, reason, ignored_at")
    .order("ignored_at", { ascending: false })
  return { data: data || [], error }
}

export async function ignoreDuplicatePair(itemAId, itemBId, reason = "") {
  const { data, error } = await supabase.rpc("ignore_inventory_duplicate_pair", {
    p_item_a_id: itemAId,
    p_item_b_id: itemBId,
    p_reason: reason || null
  })
  return { data, error }
}

export async function getInventoryItemUsage(itemId) {
  const { data, error } = await supabase.rpc("get_inventory_item_usage", {
    p_item_id: itemId
  })
  return { data: data || {}, error }
}

export async function mergeInventoryItems(masterItemId, duplicateItemId, notes = "") {
  const { data, error } = await supabase.rpc("merge_inventory_items", {
    p_master_item_id: masterItemId,
    p_duplicate_item_id: duplicateItemId,
    p_notes: notes || null
  })
  if (error) return { data: null, error }
  if (!data?.ok) {
    return { data: null, error: { message: "La fusión no se completó correctamente." } }
  }
  return { data, error: null }
}

export async function listMergedItems() {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name, sku, barcode, merged_into_item_id, merged_at, merged_by")
    .not("merged_into_item_id", "is", null)
    .order("merged_at", { ascending: false })
    .limit(200)
  return { data: data || [], error }
}

export async function listMergeAudit(limit = 50) {
  const { data, error } = await supabase
    .from("inventory_item_merge_audit")
    .select("*")
    .order("merged_at", { ascending: false })
    .limit(limit)
  return { data: data || [], error }
}

export function mapMergeError(error) {
  const message = String(error?.message || error || "").trim()
  if (!message) return "No se pudo fusionar los productos."
  if (message.toLowerCase().includes("permiso")) return message
  if (message.startsWith("Merge fallido:")) return message.replace(/^Merge fallido:\s*/i, "")
  return message
}
