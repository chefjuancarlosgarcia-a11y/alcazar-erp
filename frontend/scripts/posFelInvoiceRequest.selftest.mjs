/**
 * Static + pure-function regression for POS FEL invoice request (Phase 1A.3 UI).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertFelInvoiceCandidateRowSanitized,
  buildConsumerFinalFelRpcParams,
  FEL_PILOT_ORDER_ID,
  felDocumentPendingUiLabel,
  felDocumentStatusLabel,
  isFelInvoiceRequestEligible,
  mapFelInvoiceRequestError,
  partitionPosFelInvoiceCandidates,
  shouldAutoOpenFelInvoiceModalAfterPayment,
} from "../src/services/posFelInvoiceRequestPure.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8")

const paidBase = {
  isSupabaseOrder: true,
  orderStatus: "paid",
  isFullyPaid: null,
  balanceDue: 0,
}

const felService = read("frontend/src/services/posFelInvoiceService.js")
const felModal = read("frontend/src/components/FelInvoiceRequestModal.jsx")
const cashier = read("frontend/src/pages/Cashier.jsx")

const tests = [
  {
    name: "FEL-UI-01-paid-takeout-eligible",
    run() {
      if (!isFelInvoiceRequestEligible({ ...paidBase, salesChannel: "takeout" })) {
        throw new Error("takeout paid should be eligible")
      }
    },
  },
  {
    name: "FEL-UI-02-paid-dine-in-eligible",
    run() {
      if (!isFelInvoiceRequestEligible({ ...paidBase, salesChannel: "dine_in" })) {
        throw new Error("dine_in paid should be eligible")
      }
    },
  },
  {
    name: "FEL-UI-03-delivery-blocked",
    run() {
      if (isFelInvoiceRequestEligible({ ...paidBase, salesChannel: "delivery" })) {
        throw new Error("delivery must not be eligible")
      }
    },
  },
  {
    name: "FEL-UI-04-online-blocked",
    run() {
      if (isFelInvoiceRequestEligible({ ...paidBase, salesChannel: "online" })) {
        throw new Error("online must not be eligible")
      }
    },
  },
  {
    name: "FEL-UI-05-unpaid-blocked",
    run() {
      if (isFelInvoiceRequestEligible({ ...paidBase, orderStatus: "open", salesChannel: "takeout" })) {
        throw new Error("unpaid must not be eligible")
      }
    },
  },
  {
    name: "FEL-UI-06-cf-rpc-params",
    run() {
      const orderId = "ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45"
      const params = buildConsumerFinalFelRpcParams(orderId)
      if (params.p_order_id !== orderId) throw new Error("order id")
      if (params.p_receiver_nit !== "CF") throw new Error("nit CF")
      if (params.p_discount_total !== 0) throw new Error("discount 0")
      if (!felService.includes('supabase.rpc("request_pos_fel_certification"')) {
        throw new Error("RPC name in service")
      }
    },
  },
  {
    name: "FEL-UI-07-cf-no-pii",
    run() {
      const params = buildConsumerFinalFelRpcParams("00000000-0000-4000-8000-000000000001")
      for (const key of ["p_receiver_name", "p_receiver_address", "p_receiver_email"]) {
        if (params[key] != null) throw new Error(`${key} must be null for CF`)
      }
    },
  },
  {
    name: "FEL-UI-08-double-submit-lock",
    run() {
      if (!/submitLockRef/.test(felModal)) throw new Error("submit lock ref")
      if (!/submitLockRef\.current/.test(felModal)) throw new Error("lock usage")
      if (!/disabled=\{submitting/.test(felModal)) throw new Error("submitting disabled")
    },
  },
  {
    name: "FEL-UI-09-idempotent-ui",
    run() {
      if (!/idempotent/.test(felModal)) throw new Error("idempotent feedback")
      if (!/Documento existente reutilizado/.test(felModal)) throw new Error("reuse copy")
    },
  },
  {
    name: "FEL-UI-10-pending-label",
    run() {
      if (felDocumentPendingUiLabel("pending_certification") !== "Pendiente de certificación") {
        throw new Error("pending ui label")
      }
      if (felDocumentStatusLabel("pending_certification") !== "Factura solicitada — pendiente") {
        throw new Error("status label")
      }
    },
  },
  {
    name: "FEL-UI-11-sanitized-error",
    run() {
      const msg = mapFelInvoiceRequestError({ message: "FEL_EMISSION_DISABLED: fel_emission_config row" })
      if (/pos_fel|postgres|sql/i.test(msg)) throw new Error("raw leak")
      if (!/deshabilitada/i.test(msg)) throw new Error("user message")
      const generic = mapFelInvoiceRequestError({ message: "unexpected PGRST123" })
      if (/PGRST|supabase/i.test(generic)) throw new Error("vendor leak")
    },
  },
  {
    name: "FEL-UI-12-no-certify-edge",
    run() {
      const scan = [
        "frontend/src/services/posFelInvoiceService.js",
        "frontend/src/components/FelInvoiceRequestModal.jsx",
        "frontend/src/components/FelInvoiceRequestButton.jsx",
        "frontend/src/pages/Cashier.jsx",
      ].map(read).join("\n")
      if (/felplex-certify-invoice|functions\.invoke/.test(scan)) {
        throw new Error("must not invoke certify edge")
      }
    },
  },
  {
    name: "FEL-UI-13-no-felplex-http",
    run() {
      if (/felplex\.|FELPLEX_HTTP|api\.felplex/i.test(felService)) {
        throw new Error("no direct FELplex HTTP in service")
      }
    },
  },
  {
    name: "FEL-UI-14-nit-disabled",
    run() {
      if (!/Próximamente/.test(felModal)) throw new Error("NIT coming soon")
      if (!/disabled.*nit|value="nit" disabled/.test(felModal)) throw new Error("NIT radio disabled")
      if (!/nitChoice !== "cf"/.test(felModal)) throw new Error("confirm CF only")
    },
  },
  {
    name: "FEL-UI-15-receipt-print-intact",
    run() {
      if (!/showReceipt\(payment\)/.test(cashier)) throw new Error("receipt button")
      if (!/queueReceiptPrintJob|printFinalCheck/.test(cashier)) throw new Error("print flow")
    },
  },
  {
    name: "FEL-UI-16-last-payments-fel-action",
    run() {
      if (!/FelInvoiceRequestButton/.test(cashier)) throw new Error("FEL button wired")
      if (!/onRequestFelInvoice/.test(cashier)) throw new Error("dashboard handler")
      if (!/FelInvoiceRequestModal/.test(cashier)) throw new Error("modal wired")
    },
  },
  {
    name: "FEL-UI-17-auto-modal-delivery-blocked",
    run() {
      const ctx = {
        orderId: "ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45",
        salesChannel: "delivery",
        orderStatus: "paid",
      }
      if (shouldAutoOpenFelInvoiceModalAfterPayment(ctx)) throw new Error("delivery auto-open blocked")
      if (!/shouldAutoOpenFelInvoiceModalAfterPayment/.test(cashier)) throw new Error("cashier guard")
    },
  },
  {
    name: "FEL-UI-18-auto-modal-online-blocked",
    run() {
      if (shouldAutoOpenFelInvoiceModalAfterPayment({
        orderId: "ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45",
        salesChannel: "online",
        orderStatus: "paid",
      })) throw new Error("online auto-open blocked")
    },
  },
  {
    name: "FEL-UI-19-auto-modal-missing-channel-fail-closed",
    run() {
      if (shouldAutoOpenFelInvoiceModalAfterPayment({
        orderId: "ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45",
        orderStatus: "paid",
      })) throw new Error("missing channel fail-closed")
    },
  },
  {
    name: "FEL-UI-20-auto-modal-takeout-dine-in",
    run() {
      for (const salesChannel of ["takeout", "dine_in"]) {
        if (!shouldAutoOpenFelInvoiceModalAfterPayment({
          orderId: "ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45",
          salesChannel,
          orderStatus: "paid",
        })) throw new Error(`${salesChannel} should auto-open`)
      }
    },
  },
  {
    name: "FEL-UI-21-submit-prevalidate-before-rpc",
    run() {
      if (!/revalidateBeforeSubmit/.test(felModal)) throw new Error("prevalidate fn")
      if (!/isSupabasePosOrderId\(orderId\)/.test(felModal)) throw new Error("uuid check")
      if (!/nitChoice !== "cf"/.test(felModal)) throw new Error("nit cf check")
      if (!/requestPosFelCertificationConsumerFinal/.test(felModal)) throw new Error("rpc call")
      const submitBlock = felModal.match(/async function submitConsumerFinal\(\) \{[\s\S]*?\n  \}/)
      if (!submitBlock) throw new Error("submit block")
      if (!/await revalidateBeforeSubmit\(\)/.test(submitBlock[0])) throw new Error("prevalidate call")
      const pre = submitBlock[0].indexOf("revalidateBeforeSubmit")
      const rpc = submitBlock[0].indexOf("requestPosFelCertificationConsumerFinal")
      if (pre < 0 || rpc < 0 || pre > rpc) throw new Error("prevalidate before rpc in submit")
    },
  },
  {
    name: "FEL-UI-22-modal-async-generation-guard",
    run() {
      if (!/refreshGenerationRef/.test(felModal)) throw new Error("generation ref")
      if (!/mountedRef/.test(felModal)) throw new Error("mounted ref")
      if (!/applyIfCurrent/.test(felModal)) throw new Error("stale guard")
    },
  },
  {
    name: "FEL-UI-23-service-lf-no-crlf-trailing",
    run() {
      if (/\r/.test(felService)) throw new Error("CRLF in posFelInvoiceService.js")
      if (/[ \t]+$/m.test(felService)) throw new Error("trailing whitespace in service")
    },
  },
  {
    name: "FEL-UI-24-list-rpc-no-request-on-open",
    run() {
      if (!felService.includes('supabase.rpc("list_pos_fel_invoice_candidates"')) {
        throw new Error("list RPC in service")
      }
      const listFn = felService.match(/export async function fetchPosFelInvoiceCandidates[\s\S]*?\n\}/)
      if (!listFn) throw new Error("fetchPosFelInvoiceCandidates fn")
      if (/request_pos_fel_certification/.test(listFn[0])) {
        throw new Error("list fetch must not call request RPC")
      }
      if (!/onRequestFelInvoice\?\.\(\{[\s\S]*orderId: row\.order_id/.test(cashier)) {
        throw new Error("list row opens modal with order_id only")
      }
      if (/CashierFelInvoicePanels[\s\S]*requestPosFelCertification/.test(cashier)) {
        throw new Error("FEL list panel must not request certification")
      }
    },
  },
  {
    name: "FEL-UI-25-partition-available-vs-existing",
    run() {
      const sample = [
        {
          order_id: FEL_PILOT_ORDER_ID,
          sales_channel: "takeout",
          order_total: 148.5,
          paid_at: "2026-09-13T00:34:00Z",
          display_label: "Para llevar",
          fel_status: null,
          can_request: true,
        },
        {
          order_id: "00000000-0000-4000-8000-000000000002",
          sales_channel: "takeout",
          order_total: 10,
          paid_at: "2026-09-13T00:34:00Z",
          display_label: "Para llevar",
          fel_status: "failed",
          can_request: false,
        },
        {
          order_id: "00000000-0000-4000-8000-000000000004",
          sales_channel: "dine_in",
          order_total: 20,
          paid_at: "2026-09-13T00:34:00Z",
          display_label: "En mesa",
          fel_status: "pending_certification",
          can_request: false,
        },
        {
          order_id: "00000000-0000-4000-8000-000000000006",
          sales_channel: "takeout",
          order_total: 5,
          paid_at: "2026-09-13T00:34:00Z",
          display_label: "Para llevar",
          fel_status: "contingency_pending",
          can_request: false,
        },
      ]
      for (const row of sample) {
        if (!assertFelInvoiceCandidateRowSanitized(row)) throw new Error("sanitized row")
        if ("fel_document_id" in row) throw new Error("fel_document_id must not appear in list rows")
      }
      const { available, existing } = partitionPosFelInvoiceCandidates(sample)
      if (available.length !== 1 || available[0].order_id !== FEL_PILOT_ORDER_ID) {
        throw new Error("available partition")
      }
      if (existing.length !== 3) throw new Error("existing partition includes contingency")
      if (existing.some((row) => row.fel_status === "failed" && row.can_request !== false)) {
        throw new Error("failed must stay can_request=false")
      }
    },
  },
  {
    name: "FEL-UI-26-cashier-fel-sections",
    run() {
      if (!/Disponibles para solicitar/.test(cashier)) throw new Error("available section")
      if (!/Solicitudes FEL existentes/.test(cashier)) throw new Error("existing section")
      if (!/partitionPosFelInvoiceCandidates/.test(cashier)) throw new Error("partition in cashier")
    },
  },
  {
    name: "FEL-UI-27-failed-no-retry-modal",
    run() {
      if (/existingStatus === "failed"/.test(felModal) && /showRequestForm/.test(felModal)) {
        const block = felModal.match(/showRequestForm = [^\n]+/)
        if (block && /failed/.test(block[0])) throw new Error("failed must not enable form")
      }
      if (!/Reintento no disponible/.test(felModal)) throw new Error("failed copy")
      if (!/Solicitar factura/.test(felModal)) throw new Error("confirm label")
    },
  },
  {
    name: "FEL-UI-28-sales-channel-error-map",
    run() {
      const msg = mapFelInvoiceRequestError({ message: "FEL_SALES_CHANNEL_NOT_SUPPORTED: delivery" })
      if (!/canal/i.test(msg)) throw new Error("channel user message")
    },
  },
  {
    name: "FEL-UI-29-scoped-order-param",
    run() {
      if (!felService.includes("p_order_id: orderId")) throw new Error("scoped order id param")
    },
  },
  {
    name: "FEL-UI-30-list-param-errors-mapped",
    run() {
      const limitMsg = mapFelInvoiceRequestError({ message: "FEL_LIST_PARAM_LIMIT_OUT_OF_RANGE: 999" })
      const daysMsg = mapFelInvoiceRequestError({ message: "FEL_LIST_PARAM_DAYS_OUT_OF_RANGE: 0" })
      if (/999|0|FEL_LIST/.test(limitMsg + daysMsg)) throw new Error("sanitized list param errors")
    },
  },
  {
    name: "FEL-UI-31-migration-no-clamp-no-document-id",
    run() {
      const migration = read("supabase/migrations/20260809153000_pos_fel_invoice_candidates_and_channel_guard.sql")
      if (/'fel_document_id'/.test(migration)) throw new Error("no fel_document_id in list JSON")
      if (/table_name/.test(migration)) throw new Error("no table_name in list migration")
      if (/greatest\(1,\s*least\(/.test(migration)) throw new Error("no silent clamp")
      if (!/FEL_LIST_PARAM_LIMIT_OUT_OF_RANGE/.test(migration)) throw new Error("limit error code")
      if (!/when 'dine_in' then 'En mesa'/.test(migration)) throw new Error("En mesa label")
    },
  },
  {
    name: "FEL-UI-32-panel-generation-stale-guard",
    run() {
      if (!/listFetchGenerationRef/.test(cashier)) throw new Error("generation ref")
      if (!/generation !== listFetchGenerationRef\.current/.test(cashier)) throw new Error("stale list guard")
      if (!/openFelInvoiceRequest/.test(cashier)) throw new Error("dedupe open handler")
    },
  },
  {
    name: "FEL-UI-33-sql-test-inspects-assert-helper",
    run() {
      const sqlTest = read("supabase/schema/20260809153000_test_pos_fel_invoice_candidates.sql")
      if (!/fel_assert_pos_fel_pilot_sales_channel/.test(sqlTest)) throw new Error("assert in sql test")
      if (!/request_h1_assert_helper_and_call/.test(sqlTest)) throw new Error("h1 scenario name")
      if (!/NOT EXECUTED/.test(sqlTest)) throw new Error("runtime marked not executed")
    },
  },
]

let failed = 0
for (const t of tests) {
  try {
    t.run()
    console.log(`PASS ${t.name}`)
  } catch (e) {
    failed += 1
    console.error(`FAIL ${t.name}: ${e.message}`)
  }
}
if (failed) process.exit(1)
console.log(`posFelInvoiceRequest.selftest: ${tests.length} passed`)
