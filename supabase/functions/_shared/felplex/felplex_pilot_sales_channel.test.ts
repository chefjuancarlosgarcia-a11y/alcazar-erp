import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { formatFelplexDatetimeIssue } from "./datetimeIssue.ts"
import { evaluateCertificationGates } from "./gates.ts"
import { certifyInvoice } from "./certifyService.ts"
import { buildFelplexPayload, externalIdFromDocument } from "./payloadBuilder.ts"
import { createFetchFelplexTransport } from "./transport.ts"
import { InMemoryFelRepository } from "./repository.ts"
import {
  evaluatePilotSalesChannelGate,
  parseSalesChannelFromOrderSnapshot,
  FEL_SALES_CHANNEL_NOT_SUPPORTED,
} from "./salesChannel.ts"
import {
  envGetter,
  FIXED_DATETIME,
  makeCashActor,
  makeHttpTestEnv,
  makePaidReconciliation,
  makeQ297Document,
  makeStageEmissionConfig,
  Q297_DOCUMENT_ID,
} from "./fixtures.ts"
import { FELPLEX_STAGE_BASE_URL } from "./constants.ts"
import type { BuildPayloadResult, FelplexTransportResult } from "./types.ts"

function gateCtx(doc = makeQ297Document(), emissionEnabled = true) {
  return {
    projectRef: "tgrqarxfmpwgrkntvgma",
    supabaseUrl: "https://tgrqarxfmpwgrkntvgma.supabase.co",
    emissionConfig: makeStageEmissionConfig({ emission_enabled: emissionEnabled }),
    providerConfig: {
      id: "44444444-4444-4444-8444-444444444444",
      provider_code: "felplex_gt",
      entity_id: "547",
      environment: "stage" as const,
      secret_env_var: "FELPLEX_GT_STAGE_API_KEY",
      base_url: FELPLEX_STAGE_BASE_URL,
      is_active: true,
      is_default: true,
    },
    document: doc,
    reconciliation: makePaidReconciliation(),
    httpEnabled: true,
    apiKeyPresent: true,
    discountTotal: 0,
  }
}

function makeRepo(doc = makeQ297Document()) {
  const repo = new InMemoryFelRepository()
  repo.emissionConfig = makeStageEmissionConfig({ emission_enabled: true })
  repo.providerConfig = gateCtx().providerConfig
  repo.documents.set(doc.id, doc)
  repo.reconciliations.set(doc.order_id, makePaidReconciliation())
  return repo
}

function mockTransport(handler: () => Promise<FelplexTransportResult>) {
  let calls = 0
  return {
    getCalls: () => calls,
    async send() {
      calls += 1
      return handler()
    },
  }
}

function unblockedPayload(): BuildPayloadResult {
  const build = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  if (!build.ok) throw new Error("fixture build failed")
  return build
}

Deno.test("SC-01 parseSalesChannelFromOrderSnapshot reads sales_channel only", () => {
  assertEquals(parseSalesChannelFromOrderSnapshot(null), null)
  assertEquals(parseSalesChannelFromOrderSnapshot({}), null)
  assertEquals(parseSalesChannelFromOrderSnapshot({ sales_channel: "dine_in" }), "dine_in")
  assertEquals(parseSalesChannelFromOrderSnapshot({ sales_channel: "  takeout  " }), "takeout")
  assertEquals(parseSalesChannelFromOrderSnapshot({ sales_channel: "" }), null)
  assertEquals(parseSalesChannelFromOrderSnapshot({ sales_channel: 1 }), null)
})

Deno.test("SC-02 emission_disabled wins before sales channel block", async () => {
  const doc = makeQ297Document({ sales_channel: "delivery" })
  const failure = evaluateCertificationGates(gateCtx(doc, false))
  assertEquals(failure?.code, "FEL_EMISSION_DISABLED")

  const repo = makeRepo(doc)
  repo.emissionConfig = makeStageEmissionConfig({ emission_enabled: false })
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await certifyInvoice(
    { document_id: doc.id },
    {
      repository: repo,
      transport,
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () => unblockedPayload(),
    },
  )
  assertEquals(result.body.error_code, "FEL_EMISSION_DISABLED")
  assertEquals(repo.claims.length, 0)
  assertEquals(transport.getCalls(), 0)
})

Deno.test("SC-03 dine_in allowed at gate", () => {
  assertEquals(evaluatePilotSalesChannelGate("dine_in"), null)
  assertEquals(evaluateCertificationGates(gateCtx(makeQ297Document({ sales_channel: "dine_in" }))), null)
})

Deno.test("SC-04 takeout allowed at gate", () => {
  assertEquals(evaluatePilotSalesChannelGate("takeout"), null)
  assertEquals(evaluateCertificationGates(gateCtx(makeQ297Document({ sales_channel: "takeout" }))), null)
})

Deno.test("SC-05 delivery blocked", async () => {
  const doc = makeQ297Document({ sales_channel: "delivery" })
  assertEquals(evaluatePilotSalesChannelGate("delivery")?.code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
  const repo = makeRepo(doc)
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await certifyInvoice(
    { document_id: doc.id },
    {
      repository: repo,
      transport,
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () => unblockedPayload(),
    },
  )
  assertEquals(result.status, 409)
  assertEquals(result.body.error_code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
  assertEquals(repo.claims.length, 0)
  assertEquals(transport.getCalls(), 0)
})

Deno.test("SC-06 online blocked", async () => {
  const doc = makeQ297Document({ sales_channel: "online" })
  const repo = makeRepo(doc)
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await certifyInvoice(
    { document_id: doc.id },
    {
      repository: repo,
      transport,
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () => unblockedPayload(),
    },
  )
  assertEquals(result.body.error_code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
  assertEquals(repo.claims.length, 0)
  assertEquals(transport.getCalls(), 0)
})

Deno.test("SC-07 null or absent channel blocked", async () => {
  assertEquals(evaluatePilotSalesChannelGate(null)?.code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
  const doc = makeQ297Document({ sales_channel: null })
  const repo = makeRepo(doc)
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await certifyInvoice(
    { document_id: doc.id },
    {
      repository: repo,
      transport,
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () => unblockedPayload(),
    },
  )
  assertEquals(result.body.error_code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
  assertEquals(repo.claims.length, 0)
  assertEquals(transport.getCalls(), 0)
})

Deno.test("SC-08 unknown channel blocked", () => {
  assertEquals(evaluatePilotSalesChannelGate("wix")?.code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
})

Deno.test("SC-09 allowed channels build single B line without_iva 0", () => {
  for (const channel of ["dine_in", "takeout"] as const) {
    const build = buildFelplexPayload(
      makeQ297Document({ sales_channel: channel }),
      { datetimeIssue: FIXED_DATETIME },
    )
    assertEquals(build.ok, true)
    if (build.ok) {
      assertEquals(build.payload.items.length, 1)
      assertEquals(build.payload.items[0].type, "B")
      assertEquals(build.payload.items[0].without_iva, 0)
    }
  }
})

Deno.test("SC-10 datetime Guatemala format without Z", () => {
  const formatted = formatFelplexDatetimeIssue(FIXED_DATETIME)
  assertEquals(formatted, "2026-08-08T20:00:00")
  assertEquals(formatted?.includes("Z"), false)
})

Deno.test("SC-11 external_id stable", () => {
  const doc = makeQ297Document()
  assertEquals(externalIdFromDocument(doc), doc.external_id)
})

Deno.test("SC-12 timeout performs single transport call without retry", async () => {
  const repo = makeRepo()
  const transport = createFetchFelplexTransport(async () => {
    throw new DOMException("Aborted", "AbortError")
  })
  let calls = 0
  const countingTransport = {
    async send() {
      calls += 1
      return transport.send({
        url: `${FELPLEX_STAGE_BASE_URL}/api/entity/547/invoices/await`,
        apiKey: "k",
        body: {},
        timeoutMs: 1,
      })
    },
  }
  await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: countingTransport,
      env: envGetter(makeHttpTestEnv({ FELPLEX_CONTRACT_HTTP_CONFIRMED: "true" })),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () => unblockedPayload(),
    },
  )
  assertEquals(calls, 1)
})
