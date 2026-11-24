import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { mergePendingPreBills, preBillFromSupabaseOrder, reconcileStoredPreBills } from "./cashierPendingBills.js"

const deliveryOrder = {
  id: "order-delivery",
  status: "sent_to_cashier",
  sales_channel: "delivery",
  table_id: "sales-channel-delivery-1",
  table_name: "Delivery",
  waiter_name: "Emy Velásquez",
  waiter_id: "emy",
  created_at: "2026-11-24T18:00:00.000Z",
  updated_at: "2026-11-24T18:05:00.000Z",
  delivery_notes: "puerta gris",
  customer: { full_name: "Shelby Urizar", phone: "56228377" },
  customer_address: { address: "diagonal 10", reference: "porton gris" },
  items: [
    { id: "line-1", product_name: "Pepperoni", quantity: 1, unit_price: 65, status: "sent", quantity_paid: 0 }
  ]
}

const tableOrder = {
  id: "order-table",
  status: "sent_to_cashier",
  sales_channel: "dine_in",
  table_name: "Mesa 4",
  table_id: "mesa-4",
  waiter_name: "Ana",
  created_at: "2026-11-24T17:00:00.000Z",
  items: [
    { id: "line-2", product_name: "Caprichosa", quantity: 1, unit_price: 70, status: "served", quantity_paid: 0 }
  ]
}

test("a remote delivery pending bill is visible without a local prebill", () => {
  const merged = mergePendingPreBills([], [deliveryOrder], { remoteAvailable: true })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].orderId, "order-delivery")
  assert.equal(merged[0].tableName, "Delivery - Shelby Urizar")
  assert.equal(merged[0].total, 65)
  assert.equal(merged[0].delivery.phone, "56228377")
  assert.equal(merged[0].source, "supabase_pos")
})

test("the same order in supabase and local storage is shown once", () => {
  const local = [{
    id: "prebill-local",
    orderId: "order-delivery",
    status: "sent_to_cashier",
    source: "supabase_pos",
    total: 65,
    subtotal: 65,
    billingCustomer: { customerId: "cust-1", name: "Shelby Urizar" },
    delivery: { customerName: "Shelby Urizar", phone: "56228377", paymentMethod: "POS", address: "diagonal 10" },
    peopleCount: "1"
  }]
  const merged = mergePendingPreBills(local, [deliveryOrder], { remoteAvailable: true })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, "prebill-local")
  assert.equal(merged[0].orderId, "order-delivery")
  assert.equal(merged[0].billingCustomer.customerId, "cust-1")
  assert.equal(merged[0].delivery.paymentMethod, "POS")
  assert.equal(merged[0].total, 65)
})

test("an order already sent to cashier before this change is included", () => {
  const bill = preBillFromSupabaseOrder(tableOrder)
  assert.equal(bill.status, "sent_to_cashier")
  assert.equal(bill.tableName, "Mesa 4")
  assert.equal(bill.salesChannel, "dine_in")
})

test("a paid supabase order disappears from the other device", () => {
  const local = [{
    id: "prebill-local",
    orderId: "order-delivery",
    status: "sent_to_cashier",
    source: "supabase_pos",
    total: 65
  }]
  const merged = mergePendingPreBills(local, [], { remoteAvailable: true })
  assert.equal(merged.length, 0)
  const stored = reconcileStoredPreBills([
    ...local,
    { id: "paid-old", orderId: "old", status: "paid", source: "supabase_pos" }
  ], merged)
  assert.equal(stored.some((bill) => bill.orderId === "order-delivery"), false)
  assert.equal(stored.some((bill) => bill.status === "paid"), true)
})

test("offline contingency keeps the local pending bill", () => {
  const local = [{
    id: "prebill-local",
    orderId: "order-delivery",
    status: "sent_to_cashier",
    source: "supabase_pos",
    total: 65
  }]
  const merged = mergePendingPreBills(local, [], { remoteAvailable: false })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, "prebill-local")
})

test("a partial payment keeps the remaining balance and one row", () => {
  const partial = {
    ...tableOrder,
    id: "order-partial",
    status: "partially_paid",
    items: [
      { id: "line-a", product_name: "Caprichosa", quantity: 2, unit_price: 70, status: "served", quantity_paid: 1 }
    ]
  }
  const local = [{
    id: "prebill-partial",
    orderId: "order-partial",
    status: "partially_paid",
    source: "supabase_pos",
    total: 140,
    balanceDue: 140
  }]
  const merged = mergePendingPreBills(local, [partial], { remoteAvailable: true })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].total, 140)
  assert.equal(merged[0].balanceDue, 70)
  assert.equal(merged[0].status, "partially_paid")
})

test("the server payment function rejects a second charge of the same balance", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const sql = readFileSync(resolve(root, "supabase/schema/064_pos_split_payments.sql"), "utf8")
  const start = sql.indexOf("function public.create_pos_split_payment")
  const block = sql.slice(start, sql.indexOf("$$;", start))
  assert.match(block, /for update/)
  assert.match(block, /quantity - item_row\.quantity_paid/)
  assert.match(block, /No puedes cobrar mas unidades/)
  assert.match(block, /status not in \('awaiting_bill', 'sent_to_cashier', 'partially_paid'\)/)
})
