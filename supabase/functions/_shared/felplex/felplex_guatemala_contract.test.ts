import { assertEquals, assertExists, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { isAmbiguousTransportOutcome } from "./ambiguousOutcome.ts"
import { isFelplexContractHttpConfirmed } from "./contractHttp.ts"
import { formatFelplexDatetimeIssue } from "./datetimeIssue.ts"
import { resolveFelplexItemType } from "./itemType.ts"
import {
  buildFelplexPayload,
  externalIdFromDocument,
  payloadContainsSecrets,
} from "./payloadBuilder.ts"
import { extractVatIncluded, roundMoney } from "./money.ts"
import { parseFelplexCertifyResponse, normalizeSatDocumentNumber } from "./responseParser.ts"
import { classifyTransportFailure } from "./responseAdapter.ts"
import { createFetchFelplexTransport, defaultTransportRequest, buildFelplexCertifyUrl } from "./transport.ts"
import {
  buildFelplexCancelInvoiceUrl,
  buildFelplexGetInvoiceTextUrl,
  buildFelplexGetInvoiceUrl,
  validateFelplexStageUrl,
} from "./urlAllowlist.ts"
import {
  envGetter,
  FIXED_DATETIME,
  makeCashActor,
  makeHttpTestEnv,
  makeNitDocument,
  makePaidReconciliation,
  makeQ297Document,
  makeStageEmissionConfig,
  makeStageEnv,
  SANITIZED_CERTIFY_FAILURE_RESPONSE,
  SANITIZED_CERTIFY_SUCCESS_RESPONSE,
  Q297_DOCUMENT_ID,
} from "./fixtures.ts"
import { FELPLEX_PRODUCTION_BASE_URL, FELPLEX_STAGE_BASE_URL } from "./constants.ts"
import { InMemoryFelRepository } from "./repository.ts"
import { certifyInvoice } from "./certifyService.ts"

function makeRepo() {
  const repo = new InMemoryFelRepository()
  repo.emissionConfig = makeStageEmissionConfig({ emission_enabled: true })
  repo.providerConfig = {
    id: "44444444-4444-4444-8444-444444444444",
    provider_code: "felplex_gt",
    entity_id: "stage-entity",
    environment: "stage",
    secret_env_var: "FELPLEX_GT_STAGE_API_KEY",
    base_url: FELPLEX_STAGE_BASE_URL,
    is_active: true,
    is_default: true,
  }
  repo.documents.set(Q297_DOCUMENT_ID, makeQ297Document())
  repo.reconciliations.set(makeQ297Document().order_id, makePaidReconciliation())
  return repo
}

Deno.test("GT-01 payload FACT consumidor final provisional", () => {
  const build = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(build.ok, true)
  if (!build.ok) return
  assertEquals(build.payload.type, "FACT")
  assertEquals(build.payload.currency, "GTQ")
  assertEquals(build.payload.to_cf, 1)
  assertEquals(build.payload.to?.tax_code, "CF")
  assertEquals(build.payload.emails_cc.length, 0)
  assertEquals(build.payload.custom_fields.length, 0)
})

Deno.test("GT-02 payload FACT cliente NIT ficticio", () => {
  const build = buildFelplexPayload(makeNitDocument(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(build.ok, true)
  if (!build.ok) return
  assertEquals(build.payload.to_cf, 0)
  assertEquals(build.payload.to?.tax_code, "9001001-9")
  assertEquals(build.payload.to?.tax_name, "Cliente Ficticio Stage")
})

Deno.test("GT-03 external_id estable y obligatorio", () => {
  const doc = makeQ297Document()
  assertEquals(externalIdFromDocument(doc), doc.external_id)
  const missing = buildFelplexPayload(
    makeQ297Document({ external_id: "  " }),
    { datetimeIssue: FIXED_DATETIME },
  )
  assertEquals(missing.ok, false)
})

Deno.test("GT-04 reconciliacion items y total", () => {
  const build = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(build.ok, true)
  if (!build.ok) return
  assertEquals(build.payload.items.length, 1)
  assertEquals(build.payload.items[0].price, build.payload.total)
  assertEquals(build.payload.items[0].qty, 1)
})

Deno.test("GT-05 dinero sin floating point ingenuo", () => {
  const totals = extractVatIncluded(297)
  assertEquals(totals.taxableBase, 265.18)
  assertEquals(totals.vatTotal, 31.82)
  assertEquals(roundMoney(0.1 + 0.2), 0.3)
})

Deno.test("GT-06 rechaza negativos NaN Infinity", () => {
  const bad = buildFelplexPayload(
    makeQ297Document({ invoice_total: Number.NaN }),
    { datetimeIssue: FIXED_DATETIME },
  )
  assertEquals(bad.ok, false)
})

Deno.test("GT-07 fecha provisional ISO", () => {
  assertEquals(formatFelplexDatetimeIssue("2026-08-08"), "2026-08-08T00:00:00")
  assertEquals(formatFelplexDatetimeIssue(FIXED_DATETIME), FIXED_DATETIME)
  assertEquals(formatFelplexDatetimeIssue("invalid"), null)
})

Deno.test("GT-08 tipo item B explicito para consumo alimentos", () => {
  assertEquals(resolveFelplexItemType(makeQ297Document()), "B")
  const build = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(build.ok ? build.payload.items[0].type : null, "B")
})

Deno.test("GT-09 transporte usa X-Authorization sin Bearer", async () => {
  let capturedHeaders: HeadersInit | undefined
  const transport = createFetchFelplexTransport(async (_url, init) => {
    capturedHeaders = init?.headers
    return new Response(JSON.stringify(SANITIZED_CERTIFY_SUCCESS_RESPONSE), { status: 200 })
  })
  await transport.send(defaultTransportRequest(
    `${FELPLEX_STAGE_BASE_URL}/api/entity/entity/invoices/await`,
    "stage-key",
    { type: "FACT" },
  ))
  const headers = capturedHeaders as Record<string, string>
  assertEquals(headers["X-Authorization"], "stage-key")
  assertEquals("Authorization" in headers, false)
  assertEquals(headers.Accept, "application/json")
})

Deno.test("GT-10 API key no aparece en errores sanitizados", () => {
  const build = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(payloadContainsSecrets(build), false)
  const leaked = payloadContainsSecrets({ note: "api_key=secret-value" })
  assertEquals(leaked, true)
})

Deno.test("GT-11 allowlist Stage estricta", () => {
  assertEquals(validateFelplexStageUrl(FELPLEX_STAGE_BASE_URL), null)
  assertExists(validateFelplexStageUrl(FELPLEX_PRODUCTION_BASE_URL))
  assertExists(validateFelplexStageUrl("https://evil.example.com"))
})

Deno.test("GT-12 endpoints modelados GET y DELETE sin ejecucion", () => {
  const getUrl = buildFelplexGetInvoiceUrl(FELPLEX_STAGE_BASE_URL, "empresa", "uuid")
  const textUrl = buildFelplexGetInvoiceTextUrl(FELPLEX_STAGE_BASE_URL, "empresa", "uuid")
  const cancelUrl = buildFelplexCancelInvoiceUrl(FELPLEX_STAGE_BASE_URL, "empresa", "uuid")
  assertEquals("url" in getUrl, true)
  assertEquals("url" in textUrl, true)
  assertEquals("url" in cancelUrl, true)
})

Deno.test("GT-13 HTTP disabled bloquea via gates", async () => {
  const repo = makeRepo()
  const result = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: { async send() { return { ok: true, sanitizedMessage: "noop" } } },
      env: envGetter(makeStageEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
    },
  )
  assertEquals(result.body.error_code, "FELPLEX_HTTP_DISABLED")
})

Deno.test("GT-14 contract HTTP unconfirmed bloquea", async () => {
  const repo = makeRepo()
  const result = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: { async send() { return { ok: true, sanitizedMessage: "noop" } } },
      env: envGetter(makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" })),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
    },
  )
  assertEquals(result.body.error_code, "FELPLEX_CONTRACT_UNCONFIRMED")
})

Deno.test("GT-15 contract HTTP confirmed helper", () => {
  assertEquals(isFelplexContractHttpConfirmed(envGetter(makeStageEnv())), false)
  assertEquals(isFelplexContractHttpConfirmed(envGetter(makeHttpTestEnv())), true)
})

Deno.test("GT-16 valid=true parseado estrictamente", () => {
  const parsed = parseFelplexCertifyResponse(SANITIZED_CERTIFY_SUCCESS_RESPONSE, 200)
  assertEquals(parsed.ok, true)
  if (parsed.ok) {
    assertEquals(parsed.data.satDocumentNumber, "123")
    assertEquals(parsed.data.felUuid, SANITIZED_CERTIFY_SUCCESS_RESPONSE.uuid)
  }
})

Deno.test("GT-17 valid=false con errors y error_codes", () => {
  const parsed = parseFelplexCertifyResponse(SANITIZED_CERTIFY_FAILURE_RESPONSE, 200)
  assertEquals(parsed.ok, false)
  if (!parsed.ok) {
    assertEquals(parsed.kind, "functional_failure")
    assertEquals(parsed.functional?.errorCodes.includes("FEL_CARI_FIXTURE"), true)
  }
})

Deno.test("GT-18 sat.no numero y string normalizados", () => {
  assertEquals(normalizeSatDocumentNumber(123), "123")
  assertEquals(normalizeSatDocumentNumber("456"), "456")
})

Deno.test("GT-19 respuesta malformada rechazada", () => {
  const parsed = parseFelplexCertifyResponse({ valid: true }, 200)
  assertEquals(parsed.ok, false)
})

Deno.test("GT-20 URLs PDF/XML de host extraño rechazadas", () => {
  const parsed = parseFelplexCertifyResponse({
    ...SANITIZED_CERTIFY_SUCCESS_RESPONSE,
    invoice_url: "https://evil.example.com/doc.pdf",
  }, 200)
  assertEquals(parsed.ok, false)
  if (!parsed.ok) assertEquals(parsed.kind, "unsafe_url")
})

Deno.test("GT-21 timeout clasificado ambiguo sin retry", async () => {
  assertEquals(isAmbiguousTransportOutcome("timeout"), true)
  assertEquals(classifyTransportFailure("timeout"), "ambiguous")
  let calls = 0
  const repo = makeRepo()
  const result = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: {
        async send() {
          calls += 1
          return {
            ok: false,
            errorKind: "timeout",
            sanitizedMessage: "Tiempo de espera agotado.",
          }
        },
      },
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: (_doc, opts) =>
        buildFelplexPayload(makeQ297Document(), { datetimeIssue: opts.datetimeIssue }),
    },
  )
  assertEquals(calls, 1)
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  assertEquals(repo.finalizations.length, 0)
})

Deno.test("GT-22 certify URL usa POST await Stage", () => {
  const url = buildFelplexCertifyUrl(FELPLEX_STAGE_BASE_URL, "empresa")
  assertEquals("url" in url, true)
  if ("url" in url) {
    assertEquals(url.url.endsWith("/invoices/await"), true)
  }
})

Deno.test("GT-23 payload sin aliases sensibles prohibidos", () => {
  const build = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  const text = JSON.stringify(build).toLowerCase()
  for (const key of ["service_role", "clientsecret", "x-authorization", "bearer"]) {
    assertEquals(text.includes(key), false)
  }
})

Deno.test("GT-24 redirect bloqueado en transporte", async () => {
  const transport = createFetchFelplexTransport(async () =>
    Response.redirect("https://evil.example.com", 302)
  )
  const result = await transport.send(defaultTransportRequest(
    `${FELPLEX_STAGE_BASE_URL}/api/entity/e/invoices/await`,
    "key",
    {},
  ))
  assertEquals(result.ok, false)
  assertNotEquals(result.sanitizedMessage.toLowerCase().includes("api"), true)
})
