import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { cashierAmountsFromOrder, mergePendingPreBills, preBillFromSupabaseOrder, reconcileStoredPreBills } from "./cashierPendingBills.js"

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
  assert.equal(merged[0].delivery.paymentMethod, "Sin especificar")
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

test("a delivery payment method stored in the order notes reaches the other device", () => {
  const remote = {
    ...deliveryOrder,
    total: 65,
    subtotal: 65,
    delivery_notes: "Canal: Domicilio\nNombre: Shelby Urizar\nForma de pago: Transferencia\nNotas: puerta gris"
  }
  const merged = mergePendingPreBills([], [remote], { remoteAvailable: true })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].delivery.paymentMethod, "Transferencia")
  assert.equal(merged[0].status, "sent_to_cashier")
  assert.notEqual(merged[0].status, "paid")
})

test("both tablets show the supabase payment method when it is concrete", () => {
  const remote = {
    ...deliveryOrder,
    delivery_notes: "Canal: Domicilio\nForma de pago: Transferencia"
  }
  const tabletA = [{
    id: "prebill-a",
    orderId: "order-delivery",
    status: "sent_to_cashier",
    source: "supabase_pos",
    delivery: { customerName: "Shelby Urizar", paymentMethod: "Efectivo" }
  }]
  const onA = mergePendingPreBills(tabletA, [remote], { remoteAvailable: true })
  const onB = mergePendingPreBills([], [remote], { remoteAvailable: true })
  assert.equal(onA.length, 1)
  assert.equal(onB.length, 1)
  assert.equal(onA[0].orderId, onB[0].orderId)
  assert.equal(onA[0].delivery.paymentMethod, "Transferencia")
  assert.equal(onB[0].delivery.paymentMethod, "Transferencia")
  assert.equal(onA[0].status, "sent_to_cashier")
  assert.equal(onB[0].status, "sent_to_cashier")
})

test("Sin especificar is treated as missing and an old local method is kept", () => {
  const withRemoteMethod = {
    ...deliveryOrder,
    delivery_notes: "Forma de pago: Transferencia"
  }
  const unspecifiedLocal = [{
    id: "prebill-unspecified",
    orderId: "order-delivery",
    status: "sent_to_cashier",
    source: "supabase_pos",
    delivery: { paymentMethod: "Sin especificar" }
  }]
  const replaced = mergePendingPreBills(unspecifiedLocal, [withRemoteMethod], { remoteAvailable: true })
  assert.equal(replaced[0].delivery.paymentMethod, "Transferencia")
  assert.equal(replaced[0].status, "sent_to_cashier")

  const onlyLocal = [{
    id: "prebill-old",
    orderId: "order-delivery",
    status: "sent_to_cashier",
    source: "supabase_pos",
    delivery: { paymentMethod: "Efectivo" }
  }]
  const kept = mergePendingPreBills(onlyLocal, [deliveryOrder], { remoteAvailable: true })
  assert.equal(kept[0].delivery.paymentMethod, "Efectivo")
  assert.equal(kept[0].status, "sent_to_cashier")

  const neither = mergePendingPreBills(unspecifiedLocal, [deliveryOrder], { remoteAvailable: true })
  assert.equal(neither[0].delivery.paymentMethod, "Sin especificar")
})

test("an older delivery without a payment line shows Sin especificar", () => {
  const bill = preBillFromSupabaseOrder({ ...deliveryOrder, delivery_notes: "puerta gris", notes: "" })
  assert.equal(bill.delivery.paymentMethod, "Sin especificar")
  assert.equal(bill.status, "sent_to_cashier")
})

test("the tray uses the official order total and does not apply a discount twice", () => {
  const discounted = {
    ...deliveryOrder,
    id: "order-discount",
    subtotal: 100,
    total: 90,
    items: [
      { id: "line-d", product_name: "Pepperoni", quantity: 1, unit_price: 100, status: "sent", quantity_paid: 0 }
    ]
  }
  const local = [{
    id: "prebill-discount",
    orderId: "order-discount",
    status: "sent_to_cashier",
    source: "supabase_pos",
    subtotal: 100,
    total: 90,
    discounts: 10,
    balanceDue: 80,
    delivery: { paymentMethod: "Transferencia" }
  }]
  const merged = mergePendingPreBills(local, [discounted], { remoteAvailable: true })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].total, 90)
  assert.equal(merged[0].balanceDue, 90)
  assert.equal(merged[0].discounts, 0)
  assert.equal(merged[0].delivery.paymentMethod, "Transferencia")
})

test("a partial payment uses the official remaining balance once", () => {
  const partial = {
    ...tableOrder,
    id: "order-partial-official",
    status: "partially_paid",
    subtotal: 140,
    total: 140,
    items: [
      { id: "line-a", product_name: "Caprichosa", quantity: 2, unit_price: 70, status: "served", quantity_paid: 1 }
    ]
  }
  const amounts = cashierAmountsFromOrder(partial, [
    { precio: 70, cantidad: 2, quantity_paid: 1 }
  ])
  assert.equal(amounts.total, 140)
  assert.equal(amounts.paid, 70)
  assert.equal(amounts.balanceDue, 70)
  const local = [{
    id: "prebill-partial-official",
    orderId: "order-partial-official",
    status: "partially_paid",
    source: "supabase_pos",
    total: 140,
    discounts: 10,
    balanceDue: 60
  }]
  const merged = mergePendingPreBills(local, [partial], { remoteAvailable: true })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].balanceDue, 70)
  assert.equal(merged[0].total, 140)
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
  const statusStart = sql.indexOf("function public.get_pos_order_payment_status")
  const statusBlock = sql.slice(statusStart, sql.indexOf("$$;", statusStart))
  assert.match(statusBlock, /order_row\.total - coalesce\(\(result ->> 'amount_paid'\)::numeric, 0\)/)
})
