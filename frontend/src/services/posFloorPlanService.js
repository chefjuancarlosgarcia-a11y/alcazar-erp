import { supabase } from "../lib/supabase"
import { formatSupabaseError, withTimeout } from "./productionTicketsService"

const DEFAULT_SETTINGS = { snapToGrid: true, gridSize: 24, zoom: 1 }
const MANUAL_TABLE_STATUSES = new Set(["disponible", "ocupada", "reservada", "limpieza", "inactiva"])

export function sanitizeManualTableStatus(status) {
  const value = String(status || "").trim()
  if (MANUAL_TABLE_STATUSES.has(value)) return value
  if (["pagada", "pago_en_proceso", "esperando_cuenta"].includes(value)) return "disponible"
  if (["en_servicio", "nuevos_sin_enviar", "en_produccion", "lista_para_servir", "problema"].includes(value)) return "ocupada"
  return "disponible"
}

function mapSettings(raw) {
  if (!raw) return { ...DEFAULT_SETTINGS }
  return {
    snapToGrid: raw.snapToGrid ?? raw.snap_to_grid ?? true,
    gridSize: Number(raw.gridSize ?? raw.grid_size ?? 24),
    zoom: Number(raw.zoom ?? 1)
  }
}

function mapLayout(data) {
  if (!data) return { areas: [], tables: [], settings: { ...DEFAULT_SETTINGS } }
  return {
    areas: Array.isArray(data.areas) ? data.areas : [],
    tables: Array.isArray(data.tables) ? data.tables : [],
    settings: mapSettings(data.settings)
  }
}

async function callRpc(functionName, args, label) {
  const { data, error } = await withTimeout(
    supabase.rpc(functionName, args),
    15000,
    label
  )
  return {
    data: data || null,
    error,
    message: error ? formatSupabaseError(error) : ""
  }
}

export async function getPosFloorLayout() {
  const result = await callRpc("get_pos_floor_layout", {}, "cargar plano POS")
  return { ...result, data: result.data ? mapLayout(result.data) : null }
}

export async function savePosFloorLayout(layout) {
  const result = await callRpc("save_pos_floor_layout", { p_layout: layout }, "guardar plano POS")
  return { ...result, data: result.data ? mapLayout(result.data) : null }
}

export async function upsertPosFloorZone(zone) {
  return callRpc("upsert_pos_floor_zone", {
    p_id: zone.id,
    p_name: zone.name || zone.nombre,
    p_description: zone.description || "",
    p_sort_order: Number(zone.sortOrder ?? zone.sort_order ?? 0),
    p_active: zone.active !== false,
    p_width: Number(zone.width || 900),
    p_height: Number(zone.height || 520)
  }, "guardar zona del plano")
}

export async function upsertPosFloorTable(table) {
  return callRpc("upsert_pos_floor_table", {
    p_id: table.id,
    p_zone_id: table.areaId || table.zone_id,
    p_name: table.name,
    p_capacity: Number(table.capacity ?? table.capacidad ?? 4),
    p_shape: table.shape || "square",
    p_x: Number(table.x ?? 50),
    p_y: Number(table.y ?? 50),
    p_manual_status: sanitizeManualTableStatus(table.manual_status || table.status || table.estado || "disponible"),
    p_sort_order: Number(table.sortOrder ?? table.sort_order ?? 0),
    p_active: table.active !== false
  }, "guardar mesa del plano")
}

export async function deletePosFloorZone(id) {
  return callRpc("delete_pos_floor_zone", { p_id: id }, "eliminar zona del plano")
}

export async function deletePosFloorTable(id) {
  return callRpc("delete_pos_floor_table", { p_id: id }, "eliminar mesa del plano")
}

export async function migrateLocalFloorLayout(layout) {
  const result = await callRpc("migrate_local_floor_layout", { p_layout: layout }, "migrar plano local")
  return { ...result, data: result.data ? mapLayout(result.data) : null }
}

export { DEFAULT_SETTINGS as DEFAULT_FLOOR_SETTINGS, mapLayout as mapPosFloorLayout }
