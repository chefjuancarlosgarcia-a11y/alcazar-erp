import { supabase } from "../lib/supabase"
import { formatSupabaseError, withTimeout } from "./productionTicketsService"

const customerSelect = "*, addresses:customer_addresses(*)"

export async function searchPOSCustomers(term = "") {
  const query = String(term || "").trim()
  if (!query) return { data: [], error: null, message: "" }
  const { data, error } = await withTimeout(
    supabase
      .from("customers")
      .select(customerSelect)
      .eq("status", "active")
      .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
      .order("full_name", { ascending: true })
      .limit(8),
    10000,
    "buscar clientes POS"
  )
  return { data: data || [], error, message: error ? formatSupabaseError(error) : "" }
}

export async function getPOSCustomerById(customerId) {
  if (!customerId) return { data: null, error: null, message: "" }
  const { data, error } = await withTimeout(
    supabase.from("customers").select(customerSelect).eq("id", customerId).maybeSingle(),
    10000,
    "cargar cliente POS"
  )
  return { data, error, message: error ? formatSupabaseError(error) : "" }
}

export async function savePOSCustomerFromDelivery(form) {
  const fullName = String(form.cliente || "").trim()
  if (!fullName) return { data: null, error: new Error("Nombre del cliente obligatorio."), message: "Nombre del cliente obligatorio." }

  const phone = String(form.telefono || form.whatsapp || "").trim()
  const customerPayload = {
    full_name: fullName,
    phone: phone || null,
    email: String(form.correo || "").trim() || null,
    notes: String(form.nit || "").trim() ? `NIT: ${String(form.nit).trim()}` : null,
    source: "pos",
    status: "active"
  }

  let customer = null
  if (phone) {
    const existing = await withTimeout(
      supabase.from("customers").select(customerSelect).eq("phone", phone).eq("status", "active").maybeSingle(),
      10000,
      "buscar cliente por telefono"
    )
    if (existing.error) return { data: null, error: existing.error, message: formatSupabaseError(existing.error) }
    customer = existing.data
  }

  if (customer?.id) {
    const { data, error } = await withTimeout(
      supabase.from("customers").update(customerPayload).eq("id", customer.id).select(customerSelect).single(),
      10000,
      "actualizar cliente POS"
    )
    if (error) return { data: null, error, message: formatSupabaseError(error) }
    customer = data
  } else {
    const { data, error } = await withTimeout(
      supabase.from("customers").insert(customerPayload).select(customerSelect).single(),
      10000,
      "crear cliente POS"
    )
    if (error) return { data: null, error, message: formatSupabaseError(error) }
    customer = data
  }

  let address = null
  const addressText = String(form.direccion1 || "").trim()
  if (form.tipoOrden === "Domicilio" && addressText) {
    const addressPayload = {
      customer_id: customer.id,
      label: "Principal",
      address: addressText,
      reference: String(form.referencias || "").trim() || null,
      google_maps_url: String(form.mapsLink || "").trim() || null,
      notes: [form.direccion2, form.repartidor && `Repartidor: ${form.repartidor}`, form.notasEntrega].filter(Boolean).join("\n") || null,
      is_default: true
    }
    const { data, error } = await withTimeout(
      supabase.from("customer_addresses").insert(addressPayload).select().single(),
      10000,
      "guardar direccion POS"
    )
    if (error) return { data: { customer, address: null }, error, message: formatSupabaseError(error) }
    address = data
  }

  return { data: { customer, address }, error: null, message: "" }
}
