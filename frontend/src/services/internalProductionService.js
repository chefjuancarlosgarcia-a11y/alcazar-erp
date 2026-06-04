import { supabase } from "../lib/supabase"

const batchSelect = `
  *,
  inputs:production_batch_inputs(*),
  outputs:production_batch_outputs(*),
  recipe:standard_recipes(id, name, yield_quantity, yield_unit),
  output_item:inventory_items(id, name, base_unit),
  produced_by_profile:profiles!production_batches_produced_by_fkey(full_name, username),
  approved_by_profile:profiles!production_batches_approved_by_fkey(full_name, username)
`

function normalizeBatch(batch) {
  return batch ? {
    ...batch,
    inputs: batch.inputs || [],
    outputs: batch.outputs || [],
    totalCost: Number(batch.total_cost || 0),
    unitCost: Number(batch.unit_cost || 0)
  } : batch
}

export async function getProductionBatches() {
  const { data, error } = await supabase
    .from("production_batches")
    .select(batchSelect)
    .order("created_at", { ascending: false })
  return { data: (data || []).map(normalizeBatch), error }
}

export async function createProductionBatch(batch, inputs, outputs = []) {
  const result = await supabase.rpc("create_internal_production_batch", {
    p_batch: {
      production_area_id: batch.productionAreaId,
      recipe_id: batch.recipeId || null,
      output_inventory_item_id: batch.outputInventoryItemId,
      batch_multiplier: Number(batch.batchMultiplier || 1),
      output_quantity: Number(batch.actualOutputQuantity || batch.outputQuantity || 0),
      actual_output_quantity: Number(batch.actualOutputQuantity || batch.outputQuantity || 0),
      expected_quantity: batch.expectedOutputQuantity === "" || batch.expectedOutputQuantity == null ? null : Number(batch.expectedOutputQuantity),
      yield_quantity: batch.yieldQuantity === "" || batch.yieldQuantity == null ? null : Number(batch.yieldQuantity),
      notes: batch.notes || null
    },
    p_inputs: inputs.map((item) => ({
      inventory_item_id: item.inventoryItemId,
      quantity: Number(item.quantity || 0)
    })),
    p_outputs: outputs.length ? outputs.map((item) => ({
      inventory_item_id: item.inventoryItemId || batch.outputInventoryItemId,
      quantity: Number(item.quantity || batch.actualOutputQuantity || batch.outputQuantity || 0)
    })) : []
  })
  return result
}

export function completeProductionBatch(id) {
  return supabase.rpc("complete_internal_production_batch", { p_batch_id: id })
}

export function cancelProductionBatch(id, notes = "") {
  return supabase.rpc("cancel_internal_production_batch", { p_batch_id: id, p_notes: notes || null })
}

export function createProductionOutputItem(recipeId) {
  return supabase.rpc("create_internal_production_output_item", { p_recipe_id: recipeId })
}
