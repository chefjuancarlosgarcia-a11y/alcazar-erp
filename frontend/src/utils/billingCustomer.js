export const DEFAULT_BILLING_CUSTOMER = {
  nit: "CF",
  name: "Consumidor Final",
  phone: "",
  email: "",
  address: "",
  customerId: "",
  addressId: "",
  linked: false
}

export function parseNitFromCustomerNotes(notes = "") {
  const match = String(notes || "").match(/NIT:\s*([^\n]+)/i)
  return match ? match[1].trim() : ""
}

export function normalizeBillingCustomer(value = {}) {
  const nit = String(value.nit ?? value.taxId ?? "CF").trim() || "CF"
  const name = String(value.name ?? value.full_name ?? value.fullName ?? "").trim() || "Consumidor Final"
  return {
    nit: nit.toUpperCase() === "C/F" ? "CF" : nit,
    name,
    phone: String(value.phone ?? "").trim(),
    email: String(value.email ?? "").trim(),
    address: String(value.address ?? "").trim(),
    customerId: String(value.customerId ?? value.customer_id ?? "").trim(),
    addressId: String(value.addressId ?? value.address_id ?? "").trim(),
    linked: Boolean(value.linked || value.customerId || value.customer_id)
  }
}

export function billingCustomerFromDelivery(delivery = {}) {
  return normalizeBillingCustomer({
    nit: delivery.nit || parseNitFromCustomerNotes(delivery.notes) || "CF",
    name: delivery.customerName || delivery.cliente || "Consumidor Final",
    phone: delivery.phone || delivery.whatsapp || delivery.telefono || "",
    email: delivery.email || delivery.correo || "",
    address: delivery.address || delivery.direccion1 || "",
    linked: false
  })
}

export function billingCustomerFromSupabase(customer, address = null) {
  if (!customer) return { ...DEFAULT_BILLING_CUSTOMER }
  const resolvedAddress = address
    || (Array.isArray(customer.addresses) ? customer.addresses.find((entry) => entry.is_default) || customer.addresses[0] : null)
  return normalizeBillingCustomer({
    nit: parseNitFromCustomerNotes(customer.notes) || "CF",
    name: customer.full_name,
    phone: customer.phone || "",
    email: customer.email || "",
    address: resolvedAddress?.address || "",
    customerId: customer.id,
    addressId: resolvedAddress?.id || "",
    linked: true
  })
}

export function billingCustomerFromSearchResult(customer) {
  return billingCustomerFromSupabase(customer, customer?.addresses?.[0] || null)
}

export function orderWithBillingCustomer(order, billingCustomer) {
  const billing = normalizeBillingCustomer(billingCustomer)
  const delivery = order?.delivery || {}
  return {
    ...order,
    billingCustomer: billing,
    delivery: {
      ...delivery,
      customerName: billing.name,
      phone: billing.phone,
      address: billing.address,
      nit: billing.nit
    }
  }
}
