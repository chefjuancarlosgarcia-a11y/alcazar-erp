import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { certifyInvoice } from "./certifyService.ts"
import { buildFelplexPayload } from "./payloadBuilder.ts"
import { createFetchFelplexTransport } from "./transport.ts"
import { InMemoryFelRepository } from "./repository.ts"
import {
  FELPLEX_DATETIME_ISSUE_PATTERN,
  FELPLEX_GUATEMALA_TIME_ZONE,
  formatFelplexDatetimeIssue,
} from "./datetimeIssue.ts"
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
import { evaluateCertificationGates } from "./gates.ts"
import { FEL_SALES_CHANNEL_NOT_SUPPORTED } from "./salesChannel.ts"

Deno.test("DT-01 UTC instant converts to Guatemala civil time", () => {
  assertEquals(formatFelplexDatetimeIssue("2026-09-10T21:55:16.000Z"), "2026-09-10T15:55:16")
})

Deno.test("DT-02 UTC day boundary rolls Guatemala calendar date back", () => {
  assertEquals(formatFelplexDatetimeIssue("2026-09-11T03:30:00.000Z"), "2026-09-10T21:30:00")
})

Deno.test("DT-03 UTC year boundary rolls Guatemala calendar year back", () => {
  assertEquals(formatFelplexDatetimeIssue("2027-01-01T02:00:00.000Z"), "2026-12-31T20:00:00")
})

Deno.test("DT-04 output has no Z offset or milliseconds", () => {
  const out = formatFelplexDatetimeIssue("2026-09-10T21:55:16.000Z")
  assertEquals(out?.includes("Z"), false)
  assertEquals(out?.includes("."), false)
  assertEquals(out?.match(/[+-]\d{2}:\d{2}/), null)
})

Deno.test("DT-05 output matches exact regex", () => {
  const out = formatFelplexDatetimeIssue("2026-09-10T21:55:16.000Z")
  assertMatch(out!, FELPLEX_DATETIME_ISSUE_PATTERN)
})

Deno.test("DT-06 invalid input rejected fail-closed", () => {
  assertEquals(formatFelplexDatetimeIssue(""), null)
  assertEquals(formatFelplexDatetimeIssue("invalid"), null)
  assertEquals(formatFelplexDatetimeIssue("2026-02-30T12:00:00"), null)
  assertEquals(formatFelplexDatetimeIssue("2026-09-10T21:55:16.000"), null)
})

Deno.test("DT-07 conversion independent of process TZ env", () => {
  const instant = "2026-09-10T21:55:16.000Z"
  const expected = "2026-09-10T15:55:16"
  const previous = Deno.env.get("TZ")
  try {
    Deno.env.set("TZ", "Pacific/Auckland")
    assertEquals(formatFelplexDatetimeIssue(instant), expected)
    Deno.env.set("TZ", "UTC")
    assertEquals(formatFelplexDatetimeIssue(instant), expected)
  } finally {
    if (previous === undefined) Deno.env.delete("TZ")
    else Deno.env.set("TZ", previous)
  }
})

Deno.test("DT-08 payload uses converted datetime_issue", () => {
  const build = buildFelplexPayload(makeQ297Document(), {
    datetimeIssue: "2026-09-10T21:55:16.000Z",
  })
  assertEquals(build.ok, true)
  if (build.ok) {
    assertEquals(build.payload.datetime_issue, "2026-09-10T15:55:16")
  }
})

Deno.test("DT-09 civil injection without zone is normalized not re-zoned", () => {
  assertEquals(formatFelplexDatetimeIssue(FIXED_DATETIME), FIXED_DATETIME)
  assertEquals(formatFelplexDatetimeIssue("2026-08-08"), "2026-08-08T00:00:00")
})

Deno.test("DT-10 offset instant converts via America/Guatemala", () => {
  assertEquals(formatFelplexDatetimeIssue("2026-09-10T15:55:16+00:00"), "2026-09-10T09:55:16")
})

Deno.test("DT-11 timezone constant is America/Guatemala", () => {
  assertEquals(FELPLEX_GUATEMALA_TIME_ZONE, "America/Guatemala")
})

Deno.test("DT-12 emission_disabled still wins over datetime path", async () => {
  const doc = makeQ297Document({ sales_channel: "delivery" })
  const failure = evaluateCertificationGates({
    projectRef: "tgrqarxfmpwgrkntvgma",
    supabaseUrl: "https://tgrqarxfmpwgrkntvgma.supabase.co",
    emissionConfig: makeStageEmissionConfig({ emission_enabled: false }),
    providerConfig: {
      id: "44444444-4444-4444-8444-444444444444",
      provider_code: "felplex_gt",
      entity_id: "547",
      environment: "stage",
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
  })
  assertEquals(failure?.code, "FEL_EMISSION_DISABLED")
})

Deno.test("DT-13 delivery guard still blocks before claim with UTC nowIso", async () => {
  const doc = makeQ297Document({ sales_channel: "delivery" })
  const repo = new InMemoryFelRepository()
  repo.emissionConfig = makeStageEmissionConfig({ emission_enabled: true })
  repo.providerConfig = {
    id: "44444444-4444-4444-8444-444444444444",
    provider_code: "felplex_gt",
    entity_id: "547",
    environment: "stage",
    secret_env_var: "FELPLEX_GT_STAGE_API_KEY",
    base_url: FELPLEX_STAGE_BASE_URL,
    is_active: true,
    is_default: true,
  }
  repo.documents.set(doc.id, doc)
  repo.reconciliations.set(doc.order_id, makePaidReconciliation())
  let transportCalls = 0
  const result = await certifyInvoice(
    { document_id: doc.id },
    {
      repository: repo,
      transport: {
        async send() {
          transportCalls += 1
          return { ok: true, sanitizedMessage: "noop" }
        },
      },
      env: envGetter(makeHttpTestEnv()),
      nowIso: "2026-09-10T21:55:16.000Z",
      actor: makeCashActor(),
      buildPayloadOverride: () => {
        const build = buildFelplexPayload(doc, { datetimeIssue: "2026-09-10T21:55:16.000Z" })
        if (!build.ok) throw new Error("build failed")
        return build
      },
    },
  )
  assertEquals(result.body.error_code, FEL_SALES_CHANNEL_NOT_SUPPORTED)
  assertEquals(repo.claims.length, 0)
  assertEquals(transportCalls, 0)
})

Deno.test("DT-14 timeout still single transport call with UTC nowIso", async () => {
  const doc = makeQ297Document()
  const repo = new InMemoryFelRepository()
  repo.emissionConfig = makeStageEmissionConfig({ emission_enabled: true })
  repo.providerConfig = {
    id: "44444444-4444-4444-8444-444444444444",
    provider_code: "felplex_gt",
    entity_id: "547",
    environment: "stage",
    secret_env_var: "FELPLEX_GT_STAGE_API_KEY",
    base_url: FELPLEX_STAGE_BASE_URL,
    is_active: true,
    is_default: true,
  }
  repo.documents.set(doc.id, doc)
  repo.reconciliations.set(doc.order_id, makePaidReconciliation())
  const transport = createFetchFelplexTransport(async () => {
    throw new DOMException("Aborted", "AbortError")
  })
  let calls = 0
  await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: {
        async send(args) {
          calls += 1
          return transport.send(args)
        },
      },
      env: envGetter(makeHttpTestEnv({ FELPLEX_CONTRACT_HTTP_CONFIRMED: "true" })),
      nowIso: "2026-09-10T21:55:16.000Z",
      actor: makeCashActor(),
      buildPayloadOverride: (document, opts) =>
        buildFelplexPayload(document, { datetimeIssue: opts.datetimeIssue }),
    },
  )
  assertEquals(calls, 1)
})

Deno.test("DT-15 external_id stable when datetime is UTC instant", () => {
  const doc = makeQ297Document()
  const build = buildFelplexPayload(doc, { datetimeIssue: "2026-09-10T21:55:16.000Z" })
  assertEquals(build.ok ? build.payload.external_id : null, doc.external_id)
})
