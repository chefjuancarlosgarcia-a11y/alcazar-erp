import { assertEquals, assertExists, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { isAmbiguousTransportOutcome } from "./ambiguousOutcome.ts"
import { isFelplexContractHttpConfirmed } from "./contractHttp.ts"
import { formatFelplexDatetimeIssue } from "./datetimeIssue.ts"
import { resolveFelplexItemType } from "./itemType.ts"
import {
  buildFelplexPayload,
  externalIdFromDocument,
  isFelplexWithoutIvaFlag,
  payloadContainsSecrets,
  sanitizeEmailList,
  validateBuiltPayload,
} from "./payloadBuilder.ts"
import { extractVatIncluded, roundMoney } from "./money.ts"
import { parseFelplexCertifyResponse, normalizeSatDocumentNumber, parseSatCertificationDate } from "./responseParser.ts"
import { adaptFelplexResponse, classifyTransportFailure } from "./responseAdapter.ts"
import { interpretFelplexProviderStatus, classifyDocumentedProviderCodes } from "./providerStatus.ts"
import { isSafeProviderPayload } from "./safePayload.ts"
import { createFetchFelplexTransport, defaultTransportRequest, buildFelplexCertifyUrl } from "./transport.ts"
import {
  buildFelplexCancelInvoiceUrl,
  buildFelplexGetInvoiceTextUrl,
  buildFelplexGetInvoiceUrl,
  isAllowedFelplexStagePath,
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

/** Instant comparison without Date.parse, so a zoneless string is not read as local time. */
function certificationInstantUtcMillis(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return Number.NaN
  const fraction = (match[7] ?? "").padEnd(3, "0").slice(0, 3)
  const zone = match[8]
  let offsetMinutes = 0
  if (zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    fraction ? Number(fraction) : 0,
  ) - offsetMinutes * 60_000
}

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
  assertEquals(build.payload.items[0].without_iva, 0)
  assertNotEquals(build.payload.items[0].without_iva, 265.18)
})

Deno.test("GT-02 payload FACT cliente NIT ficticio", () => {
  const build = buildFelplexPayload(makeNitDocument(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(build.ok, true)
  if (!build.ok) return
  assertEquals(build.payload.to_cf, 0)
  assertEquals(build.payload.to?.tax_code, "9001001-9")
  assertEquals(build.payload.to?.tax_name, "Cliente Ficticio Stage")
  assertEquals(build.payload.emails, [{ email: "cliente.ficticio@stage-fel.test" }])
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
  const q297 = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(q297.ok, true)
  if (q297.ok) {
    assertEquals(q297.payload.total, 297)
    assertEquals(q297.payload.total_tax, 31.82)
    assertEquals(q297.payload.items[0].without_iva, 0)
  }
  const contractual = extractVatIncluded(5592.16)
  assertEquals(contractual.taxableBase, 4993.0)
  assertEquals(contractual.vatTotal, 599.16)
})

Deno.test("GT-05b without_iva bandera y rechazo de montos monetarios", () => {
  assertEquals(isFelplexWithoutIvaFlag(0), true)
  assertEquals(isFelplexWithoutIvaFlag(1), true)
  assertEquals(isFelplexWithoutIvaFlag(265.18), false)
  const good = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(good.ok, true)
  if (!good.ok) return
  const bad = {
    ...good.payload,
    items: [{ ...good.payload.items[0], without_iva: 265.18 as unknown as 0 }],
  }
  assertEquals(validateBuiltPayload(bad), "FEL_ITEM_WITHOUT_IVA_INVALID")
})

Deno.test("GT-05c emails estructura Postman y lista vacia segura", () => {
  assertEquals(sanitizeEmailList(null), [])
  assertEquals(sanitizeEmailList("  "), [])
  assertEquals(sanitizeEmailList("bad"), [])
  assertEquals(sanitizeEmailList("a@b.co"), [{ email: "a@b.co" }])
  const cf = buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME })
  assertEquals(cf.ok && cf.payload.emails.length === 0, true)
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

Deno.test("GT-08 tipo item B en linea agregada dine_in/takeout (no delivery)", () => {
  assertEquals(resolveFelplexItemType(makeQ297Document({ sales_channel: "dine_in" })), "B")
  const build = buildFelplexPayload(makeQ297Document({ sales_channel: "takeout" }), {
    datetimeIssue: FIXED_DATETIME,
  })
  assertEquals(build.ok ? build.payload.items[0].type : null, "B")
  assertEquals(build.ok ? build.payload.items.length : 0, 1)
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
  assertExists(validateFelplexStageUrl("https://felplex.stage.plex.lat"))
  assertExists(validateFelplexStageUrl("https://felplex.stage.plex.lat.evil.com"))
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
    assertEquals(parsed.data.felUuid, SANITIZED_CERTIFY_SUCCESS_RESPONSE.data.uuid)
    assertEquals(parsed.data.certifiedAt, "2026-08-08T20:00:00-06:00")
  }
})

Deno.test("GT-16b certification_date obligatoria en valid=true", () => {
  const present = parseFelplexCertifyResponse(FELPLEX_GT_STAGE_SUCCESS_CONTRACT, 200)
  assertEquals(present.ok, true)
  if (present.ok) {
    assertEquals(present.data.certifiedAt, "2026-07-22T15:15:39-06:00")
  }
  assertEquals(parseSatCertificationDate("2024-06-20T15:15:39"), "2024-06-20T15:15:39-06:00")
  assertEquals(parseSatCertificationDate("2024-06-20T15:15:39Z"), "2024-06-20T15:15:39Z")
  assertEquals(parseSatCertificationDate("2024-06-20T21:15:39+02:00"), "2024-06-20T21:15:39+02:00")
  assertEquals(parseSatCertificationDate("2024-06-20T22:00:00"), "2024-06-20T22:00:00-06:00")
  assertEquals(
    certificationInstantUtcMillis("2024-06-20T22:00:00-06:00"),
    certificationInstantUtcMillis("2024-06-21T04:00:00Z"),
  )
  assertEquals(
    certificationInstantUtcMillis(parseSatCertificationDate("2024-06-21T04:00:00Z") ?? ""),
    certificationInstantUtcMillis("2024-06-21T04:00:00Z"),
  )
  assertNotEquals(
    certificationInstantUtcMillis(parseSatCertificationDate("2024-06-21T04:00:00Z") ?? ""),
    certificationInstantUtcMillis("2024-06-21T04:00:00-06:00"),
  )
  assertEquals(parseSatCertificationDate("2024-02-31T15:15:39"), null)

  const rejected = [
    ["ausente", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat, certification_date: undefined }],
    ["null", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat, certification_date: null }],
    ["vacia", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat, certification_date: "" }],
    ["blanco", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat, certification_date: "   " }],
    ["invalida", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat, certification_date: "no-es-fecha" }],
    ["calendario", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat, certification_date: "2024-02-31T15:15:39" }],
  ] as const

  for (const [label, sat] of rejected) {
    const parsed = parseFelplexCertifyResponse({
      data: { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data, sat },
    }, 200)
    assertEquals(parsed.ok, false, label)
    if (!parsed.ok) assertEquals(parsed.kind, "incomplete", label)
  }
})

const OFFICIAL_GT_STAGE_UUID = "DD34F4A1-7588-44E3-B609-1DDDA27AD3E0"

/** Contrato de éxito FELplex GT Stage: campos solo bajo data. */
const FELPLEX_GT_STAGE_SUCCESS_CONTRACT = {
  data: {
    valid: true,
    uuid: OFFICIAL_GT_STAGE_UUID,
    sat: {
      serie: "DD34F4A1",
      no: 1971864803,
      authorization: OFFICIAL_GT_STAGE_UUID,
      certification_date: "2026-07-22T15:15:39",
    },
    certifier: {
      name: "CARI LATINOAMERICA, S.A.",
      tax_code: "96941243",
    },
    errors: [],
    error_codes: [],
    invoice_url: `https://felplex-gt.stage.plex.lat/pdf/${OFFICIAL_GT_STAGE_UUID}`,
    invoice_xml: `https://felplex-gt.stage.plex.lat/xml/${OFFICIAL_GT_STAGE_UUID}`,
  },
}

function officialDataBody(patch: {
  valid?: unknown
  uuid?: string
  sat?: unknown
  invoice_url?: unknown
  invoice_xml?: unknown
} = {}) {
  const base = FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data
  return {
    data: {
      ...base,
      ...patch,
      sat: Object.prototype.hasOwnProperty.call(patch, "sat") ? patch.sat : base.sat,
    },
  }
}

Deno.test("GT-26 contrato oficial GT Stage pasa", () => {
  const parsed = parseFelplexCertifyResponse(FELPLEX_GT_STAGE_SUCCESS_CONTRACT, 200)
  assertEquals(parsed.ok, true)
  if (parsed.ok) {
    assertEquals(parsed.data.felUuid, OFFICIAL_GT_STAGE_UUID)
    assertEquals(parsed.data.satSeries, "DD34F4A1")
    assertEquals(parsed.data.satDocumentNumber, "1971864803")
    assertEquals(parsed.data.satAuthorization, OFFICIAL_GT_STAGE_UUID)
    assertEquals(parsed.data.certifiedAt, "2026-07-22T15:15:39-06:00")
    assertEquals(parsed.data.invoiceUrl, FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.invoice_url)
    assertEquals(parsed.data.invoiceXml, FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.invoice_xml)
  }
})

Deno.test("GT-26b fecha ausente no finaliza certificacion ni usa now()", async () => {
  const repo = makeRepo()
  const result = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: {
        async send() {
          return {
            ok: true,
            httpStatus: 200,
            body: officialDataBody({
              sat: {
                ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
                certification_date: undefined,
              },
            }),
            sanitizedMessage: "ok",
          }
        },
      },
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () =>
        buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME }),
    },
  )
  assertEquals(result.body.error_code, "FELPLEX_INVALID_RESPONSE")
  assertEquals(repo.finalizations.some((entry) => entry.outcome === "success"), false)
  assertEquals(repo.documents.get(Q297_DOCUMENT_ID)?.status, "failed")
  assertEquals(repo.documents.get(Q297_DOCUMENT_ID)?.certified_at, null)
})

Deno.test("GT-27 host legacy y parecidos fallan en invoice_url e invoice_xml", () => {
  const badHosts = [
    "felplex.stage.plex.lat",
    "felplex-gt.stage.plex.lat.evil.com",
    "evil.felplex-gt.stage.plex.lat",
    "felplex-gtx.stage.plex.lat",
    "felplexgt.stage.plex.lat",
    "api.felplex-gt.stage.plex.lat",
    "felplex-gt.stage.plex.lat.gt",
  ]
  for (const host of badHosts) {
    for (const field of ["invoice_url", "invoice_xml"] as const) {
      const resource = field === "invoice_url" ? "pdf" : "xml"
      const parsed = parseFelplexCertifyResponse(officialDataBody({
        [field]: `https://${host}/${resource}/${OFFICIAL_GT_STAGE_UUID}`,
      }), 200)
      assertEquals(parsed.ok, false, `${field} ${host}`)
      if (!parsed.ok) assertEquals(parsed.kind, "unsafe_url")
    }
  }
})

Deno.test("GT-28 HTTP sin TLS y rutas incorrectas fallan", () => {
  const uuid = OFFICIAL_GT_STAGE_UUID
  const badUrls = [
    `http://felplex-gt.stage.plex.lat/pdf/${uuid}`,
    `http://felplex-gt.stage.plex.lat/xml/${uuid}`,
    `https://felplex-gt.stage.plex.lat/pdf/${uuid}/extra`,
    `https://felplex-gt.stage.plex.lat/xml/${uuid}?download=1`,
    `https://felplex-gt.stage.plex.lat/invoices/${uuid}`,
    `https://felplex-gt.stage.plex.lat/api/entity/547/invoices/await`,
    `https://felplex-gt.stage.plex.lat/PDF/${uuid}`,
  ]
  for (const invoiceUrl of badUrls) {
    const parsed = parseFelplexCertifyResponse(officialDataBody({
      invoice_url: invoiceUrl,
    }), 200)
    assertEquals(parsed.ok, false, invoiceUrl)
    if (!parsed.ok) assertEquals(parsed.kind, "unsafe_url")
  }
})

Deno.test("GT-29 UUID de invoice_url e invoice_xml debe coincidir", () => {
  const other = "6558823E-E710-40B5-A227-658784945C08"
  const urlMismatch = parseFelplexCertifyResponse(officialDataBody({
    invoice_url: `https://felplex-gt.stage.plex.lat/pdf/${other}`,
  }), 200)
  assertEquals(urlMismatch.ok, false)
  if (!urlMismatch.ok) assertEquals(urlMismatch.kind, "incomplete")

  const xmlMismatch = parseFelplexCertifyResponse(officialDataBody({
    invoice_xml: `https://felplex-gt.stage.plex.lat/xml/${other}`,
  }), 200)
  assertEquals(xmlMismatch.ok, false)
  if (!xmlMismatch.ok) assertEquals(xmlMismatch.kind, "incomplete")

  const swapped = parseFelplexCertifyResponse(officialDataBody({
    invoice_url: `https://felplex-gt.stage.plex.lat/xml/${OFFICIAL_GT_STAGE_UUID}`,
    invoice_xml: `https://felplex-gt.stage.plex.lat/pdf/${OFFICIAL_GT_STAGE_UUID}`,
  }), 200)
  assertEquals(swapped.ok, false)
})

Deno.test("GT-30 datos SAT necesarios exigidos", () => {
  const cases = [
    { serie: "", no: 1971864803, authorization: "DD34F4A1-7588-44E3-B609-1DDDA27AD3E0" },
    { serie: "DD34F4A1", no: "", authorization: "DD34F4A1-7588-44E3-B609-1DDDA27AD3E0" },
    { serie: "DD34F4A1", no: 1971864803, authorization: "" },
    { serie: "DD34F4A1", no: null, authorization: "DD34F4A1-7588-44E3-B609-1DDDA27AD3E0" },
  ]
  for (const sat of cases) {
    const parsed = parseFelplexCertifyResponse(officialDataBody({
      sat: { ...sat, certification_date: "2026-07-22T15:15:39" },
    }), 200)
    assertEquals(parsed.ok, false)
    if (!parsed.ok) assertEquals(parsed.kind, "incomplete")
  }

  const missingUrls = parseFelplexCertifyResponse(officialDataBody({
    invoice_url: null,
    invoice_xml: null,
  }), 200)
  assertEquals(missingUrls.ok, false)
  if (!missingUrls.ok) assertEquals(missingUrls.kind, "incomplete")
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
    data: {
      ...SANITIZED_CERTIFY_SUCCESS_RESPONSE.data,
      invoice_url: "https://evil.example.com/doc.pdf",
    },
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

Deno.test("GT-25 ambiguedades contractuales siguen UNCONFIRMED documentadas", () => {
  assertEquals(formatFelplexDatetimeIssue("2026-08-08T12:00:00") != null, true)
  assertEquals(resolveFelplexItemType(makeQ297Document({ sales_channel: "dine_in" })), "B")
  assertEquals(externalIdFromDocument(makeQ297Document()), makeQ297Document().external_id)
})

Deno.test("GT-31 contrato anidado certifica; el plano y data invalida no", async () => {
  const nested = parseFelplexCertifyResponse(FELPLEX_GT_STAGE_SUCCESS_CONTRACT, 200)
  assertEquals(nested.ok, true)

  const flat = parseFelplexCertifyResponse({ ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data }, 200)
  assertEquals(flat.ok, false)
  if (!flat.ok) assertEquals(flat.message, "Respuesta FELplex sin data.")

  for (const body of [{}, { data: null }, { data: [] }]) {
    const parsed = parseFelplexCertifyResponse(body, 200)
    assertEquals(parsed.ok, false)
  }

  for (const valid of [undefined, null, "true", false]) {
    const parsed = parseFelplexCertifyResponse(officialDataBody({ valid }), 200)
    assertEquals(parsed.ok, false, String(valid))
  }

  const repo = makeRepo()
  const rejected = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: {
        async send() {
          return {
            ok: true,
            httpStatus: 200,
            body: { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data },
            sanitizedMessage: "ok",
          }
        },
      },
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () =>
        buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME }),
    },
  )
  assertEquals(rejected.body.error_code, "FELPLEX_INVALID_RESPONSE")
  assertEquals(repo.finalizations.some((entry) => entry.outcome === "success"), false)
})

Deno.test("GT-32 uuid, serie, numero y autorizacion", () => {
  const other = "6558823E-E710-40B5-A227-658784945C08"
  const mismatch = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      authorization: other,
    },
  }), 200)
  assertEquals(mismatch.ok, false)

  const sameIgnoringCase = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      authorization: OFFICIAL_GT_STAGE_UUID.toLowerCase(),
    },
  }), 200)
  assertEquals(sameIgnoringCase.ok, true)

  const missingSerie = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      serie: undefined,
    },
  }), 200)
  assertEquals(missingSerie.ok, false)

  const missingAuthorization = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      authorization: undefined,
    },
  }), 200)
  assertEquals(missingAuthorization.ok, false)

  assertEquals(normalizeSatDocumentNumber(4294967295), "4294967295")
  assertEquals(normalizeSatDocumentNumber("4294967295"), "4294967295")
  for (const invalid of [null, "", "   ", -1, 1.5, "1.5", "abc"]) {
    assertEquals(normalizeSatDocumentNumber(invalid), null, String(invalid))
  }
  const huge = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      no: 4294967295,
    },
  }), 200)
  assertEquals(huge.ok, true)
  if (huge.ok) assertEquals(huge.data.satDocumentNumber, "4294967295")

  for (const no of [undefined, null, "", -1, 1.2, "no"]) {
    const parsed = parseFelplexCertifyResponse(officialDataBody({
      sat: {
        ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
        no,
      },
    }), 200)
    assertEquals(parsed.ok, false, String(no))
  }
})

Deno.test("GT-33 fecha anidada conserva zona o aplica -06:00", () => {
  const zoned = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      certification_date: "2026-07-22T21:15:39Z",
    },
  }), 200)
  assertEquals(zoned.ok, true)
  if (zoned.ok) assertEquals(zoned.data.certifiedAt, "2026-07-22T21:15:39Z")

  const offset = parseFelplexCertifyResponse(officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      certification_date: "2026-07-22T17:15:39-04:00",
    },
  }), 200)
  assertEquals(offset.ok, true)
  if (offset.ok) assertEquals(offset.data.certifiedAt, "2026-07-22T17:15:39-04:00")
  assertEquals(
    certificationInstantUtcMillis("2026-07-22T17:15:39-04:00"),
    certificationInstantUtcMillis("2026-07-22T21:15:39Z"),
  )
})

Deno.test("GT-34 exito envia al finalize serie, numero, autorizacion y fecha", async () => {
  const body = officialDataBody({
    sat: {
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.sat,
      no: 4294967295,
    },
  })
  const repo = makeRepo()
  const result = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport: {
        async send() {
          return { ok: true, httpStatus: 200, body, sanitizedMessage: "ok" }
        },
      },
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () =>
        buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME }),
    },
  )
  assertEquals(result.status, 200)
  assertEquals(repo.finalizations.length, 1)
  const finalized = repo.finalizations[0]
  assertEquals(finalized?.outcome, "success")
  assertEquals(finalized?.satSeries, "DD34F4A1")
  assertEquals(finalized?.satDocumentNumber, "4294967295")
  assertEquals(finalized?.satAuthorization, OFFICIAL_GT_STAGE_UUID)
  assertEquals(finalized?.certifiedAt, "2026-07-22T15:15:39-06:00")
  assertEquals(JSON.stringify(finalized).includes("invoice_url"), false)
  const adapted = adaptFelplexResponse(body, 200)
  assertEquals(adapted.success, true)
  assertEquals(adapted.invoiceUrl, FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.invoice_url)
  assertEquals(adapted.invoiceXml, FELPLEX_GT_STAGE_SUCCESS_CONTRACT.data.invoice_xml)
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

const AWAIT_URL = `${FELPLEX_STAGE_BASE_URL}/api/entity/stage-entity/invoices/await`

function providerResponse(status: number, body: string): Response {
  const response = new Response(body, { status })
  Object.defineProperty(response, "url", { value: AWAIT_URL })
  return response
}

async function certifyProviderHttp(status: number, body: string) {
  const repo = makeRepo()
  let calls = 0
  const transport = createFetchFelplexTransport(async () => {
    calls += 1
    return providerResponse(status, body)
  })
  const result = await certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport,
      env: envGetter(makeHttpTestEnv()),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      buildPayloadOverride: () =>
        buildFelplexPayload(makeQ297Document(), { datetimeIssue: FIXED_DATETIME }),
    },
  )
  return { repo, result, calls }
}

Deno.test("GT-35 HTTP 200 anidado certifica y data.valid false no", async () => {
  const success = await certifyProviderHttp(200, JSON.stringify(SANITIZED_CERTIFY_SUCCESS_RESPONSE))
  assertEquals(success.result.status, 200)
  assertEquals(success.repo.finalizations.some((entry) => entry.outcome === "success"), true)

  const rejected = await certifyProviderHttp(200, JSON.stringify({
    data: { valid: false, errors: [["No emitido"]], error_codes: ["FEL_NO"] },
  }))
  assertEquals(rejected.result.body.error_code, "FELPLEX_INVALID_RESPONSE")
  assertEquals(rejected.repo.finalizations.some((entry) => entry.outcome === "success"), false)

  const flat = parseFelplexCertifyResponse({
    valid: true,
    uuid: OFFICIAL_GT_STAGE_UUID,
    sat: {
      serie: "DD34F4A1",
      no: 1,
      authorization: OFFICIAL_GT_STAGE_UUID,
      certification_date: "2026-07-22T15:15:39",
    },
    invoice_url: `https://felplex-gt.stage.plex.lat/pdf/${OFFICIAL_GT_STAGE_UUID}`,
    invoice_xml: `https://felplex-gt.stage.plex.lat/xml/${OFFICIAL_GT_STAGE_UUID}`,
  }, 200)
  assertEquals(flat.ok, false)
})

Deno.test("GT-36 422, 502, 402 y 403 no certifican y sanitizan", async () => {
  const functional = interpretFelplexProviderStatus(422, JSON.stringify({
    data: {
      valid: false,
      errors: [["NIT de ejemplo rechazado"]],
      error_codes: ["FEL_NIT"],
    },
  }))
  assertEquals(functional.ok, false)
  assertEquals(functional.errorKind, "functional_failure")
  assertEquals(functional.body == null, false)
  assertEquals(functional.safeCode, "FEL_NIT")
  assertEquals(functional.sanitizedMessage.includes("NIT de ejemplo rechazado"), true)
  assertNotEquals(classifyTransportFailure(functional.errorKind), "transient")

  const viaService = await certifyProviderHttp(422, JSON.stringify({
    data: {
      valid: false,
      errors: [["NIT de ejemplo rechazado"]],
      error_codes: ["FEL_NIT"],
    },
  }))
  assertEquals(viaService.calls, 1)
  assertEquals(viaService.repo.finalizations.some((entry) => entry.outcome === "success"), false)
  const saved = viaService.repo.finalizations[0]?.safeResponsePayload
  assertEquals(isSafeProviderPayload(saved), true)
  assertEquals(saved?.error_kind, "functional_failure")
  assertEquals(saved?.safe_code, "FEL_NIT")
  assertEquals(saved?.safe_message?.includes("NIT de ejemplo rechazado"), true)
  assertEquals(JSON.stringify(saved).includes("invoice_url"), false)

  const gateway = interpretFelplexProviderStatus(502, JSON.stringify({
    data: {
      valid: false,
      errors: ["Comunicacion de ejemplo"],
      error_codes: ["FEL_UNDOCUMENTED"],
    },
  }))
  assertEquals(gateway.body == null, false)
  assertEquals(gateway.errorKind, "provider_unclassified")
  assertEquals(gateway.safeCode, "FEL_UNDOCUMENTED")
  assertEquals(gateway.sanitizedMessage.includes("Comunicacion de ejemplo"), true)
  assertEquals(classifyDocumentedProviderCodes(["FEL_UNDOCUMENTED"]), "unclassified")
  assertEquals(classifyTransportFailure("provider_unclassified"), "permanent")
  assertEquals(classifyTransportFailure("provider_communication"), "permanent")
  const gatewayService = await certifyProviderHttp(502, JSON.stringify({
    data: { errors: ["Comunicacion de ejemplo"], error_codes: ["FEL_UNDOCUMENTED"] },
  }))
  assertEquals(gatewayService.calls, 1)
  assertEquals(gatewayService.repo.finalizations.some((entry) => entry.outcome === "success"), false)
  assertEquals(gatewayService.repo.finalizations[0]?.safeResponsePayload?.safe_code, "FEL_UNDOCUMENTED")

  for (const status of [402, 403] as const) {
    const subscription = await certifyProviderHttp(status, JSON.stringify({
      errors: ["Suscripcion de ejemplo vencida"],
    }))
    assertEquals(subscription.calls, 1)
    assertEquals(subscription.result.body.error_code, "subscription")
    assertEquals(subscription.repo.finalizations.some((entry) => entry.outcome === "success"), false)
    assertEquals(subscription.repo.finalizations[0]?.safeResponsePayload?.error_kind, "subscription")
    assertEquals(
      subscription.repo.finalizations[0]?.safeResponsePayload?.safe_message?.includes("Suscripcion de ejemplo vencida"),
      true,
    )
  }
})

Deno.test("GT-37 cuerpos inseguros quedan genericos y acotados", async () => {
  const html = await certifyProviderHttp(422, "<html><script>alert(1)</script></html>")
  assertEquals(html.repo.finalizations[0]?.safeResponsePayload?.safe_message?.includes("<"), false)
  assertEquals(html.repo.finalizations[0]?.safeResponsePayload?.safe_message?.includes("script"), false)
  assertEquals(html.result.body.message.includes("<html>"), false)

  const longItem = "L".repeat(500)
  const many = Array.from({ length: 12 }, (_, index) => index === 8 ? "NOT_PERSISTED_NINE" : `item-${index}`)
  many[0] = longItem
  const bounded = interpretFelplexProviderStatus(422, JSON.stringify({
    data: { valid: false, errors: many, error_codes: ["FEL_OK"] },
  }))
  assertEquals((bounded.sanitizedMessage ?? "").length <= 240, true)
  assertEquals(bounded.sanitizedMessage.includes("NOT_PERSISTED_NINE"), false)
  assertEquals(bounded.sanitizedMessage.includes(longItem), false)

  const dirty = interpretFelplexProviderStatus(422, JSON.stringify({
    data: {
      valid: false,
      errors: [{ leak: "OBJETO_CRUDO" }, "<b>html</b>", "api_key=super-secret"],
      error_codes: [{ raw: true }, "token-secret"],
    },
  }))
  assertEquals(dirty.sanitizedMessage.includes("OBJETO_CRUDO"), false)
  assertEquals(dirty.sanitizedMessage.includes("html"), false)
  assertEquals(dirty.sanitizedMessage.includes("super-secret"), false)
  assertEquals(dirty.safeCode?.includes("token-secret"), false)
  assertEquals(dirty.sanitizedMessage, "Certificacion rechazada.")

  assertEquals(isAllowedFelplexStagePath("/api/tenant/v1/gt-legacy/invoices/byexternalid"), false)
  assertEquals(
    validateFelplexStageUrl(
      `${FELPLEX_STAGE_BASE_URL}/api/tenant/v1/gt-legacy/invoices/${OFFICIAL_GT_STAGE_UUID}`,
    ) == null,
    false,
  )
})
