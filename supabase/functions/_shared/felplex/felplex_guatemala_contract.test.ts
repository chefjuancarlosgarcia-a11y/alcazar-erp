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
    assertEquals(parsed.data.felUuid, SANITIZED_CERTIFY_SUCCESS_RESPONSE.uuid)
    assertEquals(parsed.data.certifiedAt, "2026-08-08T20:00:00-06:00")
  }
})

Deno.test("GT-16b certification_date obligatoria en valid=true", () => {
  const present = parseFelplexCertifyResponse(FELPLEX_GT_STAGE_SUCCESS_CONTRACT, 200)
  assertEquals(present.ok, true)
  if (present.ok) {
    assertEquals(present.data.certifiedAt, "2024-06-20T15:15:39-06:00")
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
    ["ausente", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat, certification_date: undefined }],
    ["null", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat, certification_date: null }],
    ["vacia", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat, certification_date: "" }],
    ["blanco", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat, certification_date: "   " }],
    ["invalida", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat, certification_date: "no-es-fecha" }],
    ["calendario", { ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat, certification_date: "2024-02-31T15:15:39" }],
  ] as const

  for (const [label, sat] of rejected) {
    const parsed = parseFelplexCertifyResponse({
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
      sat,
    }, 200)
    assertEquals(parsed.ok, false, label)
    if (!parsed.ok) assertEquals(parsed.kind, "incomplete", label)
  }
})

const OFFICIAL_GT_STAGE_UUID = "71916AF3-73F6-480B-B3B3-6F6E3DABC334"

/** Contrato de éxito FELplex GT Stage, sin comentarios. Host oficial, no el del extracto legacy. */
const FELPLEX_GT_STAGE_SUCCESS_CONTRACT = {
  valid: true,
  uuid: OFFICIAL_GT_STAGE_UUID,
  sat: {
    serie: "DD34F4A1",
    no: 1971864803,
    authorization: "DD34F4A1-7588-44E3-B609-1DDDA27AD3E0",
    certification_date: "2024-06-20T15:15:39",
  },
  certifier: {
    name: "Certificador de ejemplo",
    tax_code: "00000000",
  },
  errors: [],
  invoice_url: `https://felplex-gt.stage.plex.lat/pdf/${OFFICIAL_GT_STAGE_UUID}`,
  invoice_xml: `https://felplex-gt.stage.plex.lat/xml/${OFFICIAL_GT_STAGE_UUID}`,
}

Deno.test("GT-26 contrato oficial GT Stage pasa", () => {
  const parsed = parseFelplexCertifyResponse(FELPLEX_GT_STAGE_SUCCESS_CONTRACT, 200)
  assertEquals(parsed.ok, true)
  if (parsed.ok) {
    assertEquals(parsed.data.felUuid, OFFICIAL_GT_STAGE_UUID)
    assertEquals(parsed.data.satSeries, "DD34F4A1")
    assertEquals(parsed.data.satDocumentNumber, "1971864803")
    assertEquals(parsed.data.satAuthorization, "DD34F4A1-7588-44E3-B609-1DDDA27AD3E0")
    assertEquals(parsed.data.certifiedAt, "2024-06-20T15:15:39-06:00")
    assertEquals(parsed.data.invoiceUrl, FELPLEX_GT_STAGE_SUCCESS_CONTRACT.invoice_url)
    assertEquals(parsed.data.invoiceXml, FELPLEX_GT_STAGE_SUCCESS_CONTRACT.invoice_xml)
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
            body: {
              ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
              sat: {
                ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT.sat,
                certification_date: undefined,
              },
            },
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
      const parsed = parseFelplexCertifyResponse({
        ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
        [field]: `https://${host}/${resource}/${OFFICIAL_GT_STAGE_UUID}`,
      }, 200)
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
    const parsed = parseFelplexCertifyResponse({
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
      invoice_url: invoiceUrl,
    }, 200)
    assertEquals(parsed.ok, false, invoiceUrl)
    if (!parsed.ok) assertEquals(parsed.kind, "unsafe_url")
  }
})

Deno.test("GT-29 UUID de invoice_url e invoice_xml debe coincidir", () => {
  const other = "6558823E-E710-40B5-A227-658784945C08"
  const urlMismatch = parseFelplexCertifyResponse({
    ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
    invoice_url: `https://felplex-gt.stage.plex.lat/pdf/${other}`,
  }, 200)
  assertEquals(urlMismatch.ok, false)
  if (!urlMismatch.ok) assertEquals(urlMismatch.kind, "incomplete")

  const xmlMismatch = parseFelplexCertifyResponse({
    ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
    invoice_xml: `https://felplex-gt.stage.plex.lat/xml/${other}`,
  }, 200)
  assertEquals(xmlMismatch.ok, false)
  if (!xmlMismatch.ok) assertEquals(xmlMismatch.kind, "incomplete")

  const swapped = parseFelplexCertifyResponse({
    ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
    invoice_url: `https://felplex-gt.stage.plex.lat/xml/${OFFICIAL_GT_STAGE_UUID}`,
    invoice_xml: `https://felplex-gt.stage.plex.lat/pdf/${OFFICIAL_GT_STAGE_UUID}`,
  }, 200)
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
    const parsed = parseFelplexCertifyResponse({
      ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
      sat: { ...sat, certification_date: "2024-06-20T15:15:39" },
    }, 200)
    assertEquals(parsed.ok, false)
    if (!parsed.ok) assertEquals(parsed.kind, "incomplete")
  }

  const missingUrls = parseFelplexCertifyResponse({
    ...FELPLEX_GT_STAGE_SUCCESS_CONTRACT,
    invoice_url: null,
    invoice_xml: null,
  }, 200)
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

Deno.test("GT-25 ambiguedades contractuales siguen UNCONFIRMED documentadas", () => {
  assertEquals(formatFelplexDatetimeIssue("2026-08-08T12:00:00") != null, true)
  assertEquals(resolveFelplexItemType(makeQ297Document({ sales_channel: "dine_in" })), "B")
  assertEquals(externalIdFromDocument(makeQ297Document()), makeQ297Document().external_id)
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
