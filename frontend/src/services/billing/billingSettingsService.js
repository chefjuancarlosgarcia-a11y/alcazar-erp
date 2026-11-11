import { supabase } from "../../lib/supabase"
import { BILLING_MIGRATION_HINT } from "../../utils/billingConstants"

function migrationHint(error) {
  const text = typeof error === "string" ? error : error?.message || "Error en modulo de facturacion."
  if (/does not exist|Could not find the function|schema cache|billing_/i.test(text)) {
    return `${text} ${BILLING_MIGRATION_HINT}`
  }
  return text
}

export async function getBillingSettings() {
  const { data, error } = await supabase.rpc("get_billing_settings")
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function setBillingSettings(patch) {
  const { data, error } = await supabase.rpc("set_billing_settings", { p_patch: patch })
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function listBillingProviderConfigs() {
  const { data, error } = await supabase.rpc("list_billing_provider_configs")
  return { data: data || [], error: error ? migrationHint(error) : "" }
}

export async function upsertBillingProviderConfig(payload) {
  const { data, error } = await supabase.rpc("upsert_billing_provider_config", { p_data: payload })
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function getBillingMonitoringSummary(legalEntityId = null) {
  const { data, error } = await supabase.rpc("get_billing_monitoring_summary", {
    p_legal_entity_id: legalEntityId
  })
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function listBillingLegalEntities() {
  const { data, error } = await supabase.rpc("list_billing_legal_entities")
  return { data: data || [], error: error ? migrationHint(error) : "" }
}

export async function testBillingConnection({ providerCode, environment, legalEntityId } = {}) {
  if (!supabase) {
    return { data: null, error: "Supabase no configurado." }
  }
  const { data, error } = await supabase.functions.invoke("billing-test-connection", {
    body: {
      provider_code: providerCode,
      environment,
      legal_entity_id: legalEntityId || undefined
    }
  })
  if (error) {
    return { data: null, error: migrationHint(error.message || error) }
  }
  if (data && data.ok === false) {
    return { data, error: data.error || "Prueba de conexion fallida." }
  }
  return { data, error: "" }
}
