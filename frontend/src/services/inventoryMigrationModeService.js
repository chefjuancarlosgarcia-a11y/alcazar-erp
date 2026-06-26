import { supabase } from "../lib/supabase"

const MIGRATION_HINT = "Aplica la migración 131_inventory_migration_mode.sql en Supabase."

function message(error) {
  return typeof error === "string" ? error : error?.message || "Error en Modo Migración."
}

function migrationHint(error) {
  const text = message(error)
  if (/does not exist|Could not find the function|schema cache/i.test(text)) {
    return `${text} ${MIGRATION_HINT}`
  }
  return text
}

export async function getInventoryMigrationMode() {
  const { data, error } = await supabase.rpc("get_inventory_migration_mode")
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function setInventoryMigrationMode(enabled, notes = null) {
  const { data, error } = await supabase.rpc("set_inventory_migration_mode", {
    p_enabled: Boolean(enabled),
    p_notes: notes || null
  })
  return { data: data || null, error: error ? migrationHint(error) : "" }
}
