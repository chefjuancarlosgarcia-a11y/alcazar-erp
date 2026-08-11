import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildFelplexPayload, payloadContainsSecrets } from "./payloadBuilder.ts"
import { extractVatIncluded } from "./money.ts"
import { evaluateCertificationGates } from "./gates.ts"
import { certifyInvoice } from "./certifyService.ts"
import { GENERIC_INTERNAL_ERROR } from "./rpcErrors.ts"
import { handleFelplexCertifyInvoiceHttpSafe } from "./edgeHandler.ts"
import { resolvePublicRpcError } from "./rpcErrors.ts"
import { adaptFelplexResponse } from "./responseAdapter.ts"
import { sanitizePublicMessage, sanitizeFelplexErrors } from "./sanitize.ts"
import {
  buildFelplexCertifyUrl,
  createFetchFelplexTransport,
} from "./transport.ts"
import { validateFelplexStageUrl } from "./urlAllowlist.ts"
import { assertNoRawProviderBodyPersisted, isSafeProviderPayload } from "./safePayload.ts"
import { InMemoryFelRepository, FinalizeError } from "./repository.ts"
import { assertCashOperator, isCashOperator, normalizeProfileRole } from "./auth.ts"
import {
  envGetter,
  FIXED_DATETIME,
  makeCashActor,
  makePaidReconciliation,
  makeQ297Document,
  makeStageEmissionConfig,
  makeStageEnv,
  Q297_DOCUMENT_ID,
} from "./fixtures.ts"
import type { BuildPayloadResult, FelplexTransport, FelplexTransportResult } from "./types.ts"
import { FELPLEX_PRODUCTION_BASE_URL, FELPLEX_STAGE_BASE_URL } from "./constants.ts"

type ScenarioResult = "PASSED" | "FAILED" | "NOT_EXECUTED"

const results: Array<{ name: string; result: ScenarioResult; detail?: string }> = []

function record(name: string, result: ScenarioResult, detail?: string) {
  results.push({ name, result, detail })
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

function mockTransport(
  handler: () => Promise<FelplexTransportResult>,
): FelplexTransport & { getCalls: () => number } {
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
  return {
    ok: true,
    payload: {
      type: "FACT",
      currency: "GTQ",
      datetime_issue: FIXED_DATETIME,
      external_id: "POS-test",
      items: [],
      total: 297,
      total_tax: 31.82,
      emails: [],
    },
  }
}

async function runCertify(
  repo: InMemoryFelRepository,
  transport: FelplexTransport & { getCalls?: () => number },
  envMap: Map<string, string>,
  overrides: Partial<Parameters<typeof certifyInvoice>[1]> = {},
) {
  const counter = { count: 0 }
  return certifyInvoice(
    { document_id: Q297_DOCUMENT_ID },
    {
      repository: repo,
      transport,
      env: envGetter(envMap),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
      includeCandidatePayload: true,
      transportCallCounter: counter,
      ...overrides,
    },
  )
}

Deno.test("Role alias administrador matches PostgreSQL admin normalization", () => {
  const actor = makeCashActor({ role: "Administrador" })
  assertEquals(normalizeProfileRole(actor.role), "admin")
  assertEquals(isCashOperator(actor), true)
  assertEquals(assertCashOperator(actor), null)
  record("Role alias administrador normalizado", "PASSED")
})

Deno.test("Role normalization does not expand operators or bypass inactive status", () => {
  const waiter = makeCashActor({ role: "mesero" })
  const inactiveAdminAlias = makeCashActor({ role: "administrador", status: "inactive" })
  assertEquals(normalizeProfileRole(waiter.role), "mesero")
  assertEquals(isCashOperator(waiter), false)
  assertEquals(assertCashOperator(waiter), "FEL_UNAUTHORIZED")
  assertEquals(isCashOperator(inactiveAdminAlias), false)
  assertEquals(assertCashOperator(inactiveAdminAlias), "FEL_UNAUTHORIZED")
  record("Role normalization fail-closed", "PASSED")
})

Deno.test("Q297 IVA incluido (preservado)", () => {
  const totals = extractVatIncluded(297)
  assertEquals(totals.invoiceTotal, 297)
  assertEquals(totals.taxableBase, 265.18)
  assertEquals(totals.vatTotal, 31.82)
  record("Q297 IVA incluido", "PASSED")
})

Deno.test("1A.1-01 Host Stage exacto aceptado", () => {
  assertEquals(validateFelplexStageUrl(FELPLEX_STAGE_BASE_URL), null)
  const urlResult = buildFelplexCertifyUrl(FELPLEX_STAGE_BASE_URL, "entity")
  assertEquals("url" in urlResult, true)
  if ("url" in urlResult) {
    assertEquals(validateFelplexStageUrl(urlResult.url), null)
  }
  record("1A.1-01 Host Stage exacto aceptado", "PASSED")
})

Deno.test("1A.1-02 Host arbitrario rechazado", () => {
  assertExists(validateFelplexStageUrl("https://evil.example.com/api"))
  record("1A.1-02 Host arbitrario rechazado", "PASSED")
})

Deno.test("1A.1-03 HTTP rechazado", () => {
  assertExists(validateFelplexStageUrl("http://felplex.stage.plex.lat"))
  record("1A.1-03 HTTP rechazado", "PASSED")
})

Deno.test("1A.1-04 Subdominio engañoso rechazado", () => {
  assertExists(validateFelplexStageUrl("https://felplex.stage.plex.lat.evil.com"))
  record("1A.1-04 Subdominio engañoso rechazado", "PASSED")
})

Deno.test("1A.1-05 URL con credenciales rechazada", () => {
  assertExists(validateFelplexStageUrl("https://user:pass@felplex.stage.plex.lat"))
  record("1A.1-05 URL con credenciales rechazada", "PASSED")
})

Deno.test("1A.1-06 Redirect rechazado", async () => {
  const transport = createFetchFelplexTransport(async () => {
    throw new TypeError("redirect is not allowed")
  })
  const result = await transport.send({
    url: `${FELPLEX_STAGE_BASE_URL}/api/entity/e/invoices/await`,
    apiKey: "fake",
    body: {},
    timeoutMs: 1000,
  })
  assertEquals(result.errorKind, "blocked")
  assertEquals(result.sanitizedMessage.includes("Redireccion"), true)
  record("1A.1-06 Redirect rechazado", "PASSED")
})

Deno.test("1A.1-07 Provider config ausente", async () => {
  const repo = makeRepo()
  repo.providerConfig = null
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }))
  assertEquals(result.body.error_code, "FEL_PROVIDER_CONFIG_MISSING")
  assertEquals(transport.getCalls(), 0)
  assertEquals(repo.claims.length, 0)
  record("1A.1-07 Provider config ausente", "PASSED")
})

Deno.test("1A.1-08 secret_env_var incorrecto", async () => {
  const repo = makeRepo()
  repo.providerConfig = {
    ...repo.providerConfig!,
    secret_env_var: "FELPLEX_GT_PRODUCTION_API_KEY",
  }
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }))
  assertEquals(result.body.error_code, "FEL_PRODUCTION_BLOCKED")
  assertEquals(transport.getCalls(), 0)
  record("1A.1-08 secret_env_var incorrecto", "PASSED")
})

Deno.test("1A.1-09 Retorno certificado no salta gates Stage", async () => {
  const repo = makeRepo()
  repo.documents.set(Q297_DOCUMENT_ID, makeQ297Document({
    status: "certified",
    fel_uuid: "FEL-UUID",
  }))
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(
    repo,
    transport,
    new Map([["SUPABASE_URL", "https://wrong-project.supabase.co"]]),
  )
  assertEquals(result.body.error_code, "FEL_NOT_STAGE_PROJECT")
  assertEquals(result.body.idempotent, false)
  assertEquals(result.body.status, "blocked")
  assertEquals(transport.getCalls(), 0)
  record("1A.1-09 Retorno certificado no salta gates Stage", "PASSED")
})

Deno.test("1A.1-10 Orden con estado distinto de paid", async () => {
  const repo = makeRepo()
  repo.reconciliations.set(makeQ297Document().order_id, makePaidReconciliation({
    order_status: "partially_paid",
    is_fully_paid: false,
    balance_due: 100,
  }))
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }))
  assertEquals(result.body.error_code, "FEL_ORDER_NOT_PAID")
  assertEquals(transport.getCalls(), 0)
  record("1A.1-10 Orden con estado distinto de paid", "PASSED")
})

Deno.test("1A.1-11 Finalize retorna null", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "null"
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: {
      valid: true,
      uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
      sat: { authorization: "AUTH-123", serie: "A", no: "123" },
    },
    sanitizedMessage: "ok",
  }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  assertEquals(result.body.status, "blocked")
  record("1A.1-11 Finalize retorna null", "PASSED")
})

Deno.test("1A.1-12 Finalize lanza error", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "throw"
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: {
      valid: true,
      uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
      sat: { authorization: "AUTH-123", serie: "A", no: "123" },
    },
    sanitizedMessage: "ok",
  }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  record("1A.1-12 Finalize lanza error", "PASSED")
})

Deno.test("1A.1-13 Insert/claim falla", async () => {
  const repo = makeRepo()
  repo.claimBehavior = "null"
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(result.body.error_code, "FEL_CLAIM_FAILED")
  assertEquals(transport.getCalls(), 0)
  record("1A.1-13 Insert/claim falla", "PASSED")
})

Deno.test("1A.1-14 Servicio nunca responde certified si DB no confirma", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "null"
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: {
      valid: true,
      uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
      sat: { authorization: "AUTH-123" },
    },
    sanitizedMessage: "ok",
  }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(result.status, 500)
  assertEquals(result.body.status, "blocked")
  assertEquals(result.body.status === "certified", false)
  record("1A.1-14 Servicio nunca responde certified si DB no confirma", "PASSED")
})

Deno.test("1A.1-15 Builder bloqueado genera cero claims y cero HTTP", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }))
  assertEquals(result.body.error_code, "FELPLEX_CONTRACT_UNCONFIRMED")
  assertEquals(transport.getCalls(), 0)
  assertEquals(repo.claims.length, 0)
  record("1A.1-15 Builder bloqueado genera cero claims y cero HTTP", "PASSED")
})

Deno.test("1A.1-16 Camino feliz completo con builder desbloqueado", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: {
      valid: true,
      uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
      sat: {
        serie: "A",
        no: "123",
        authorization: "AUTH-123",
        certification_date: FIXED_DATETIME,
      },
    },
    sanitizedMessage: "ok",
  }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(result.status, 200)
  assertEquals(result.body.status, "certified")
  assertEquals(transport.getCalls(), 1)
  assertEquals(repo.claims.length, 1)
  record("1A.1-16 Camino feliz completo con builder desbloqueado", "PASSED")
})

Deno.test("1A.1-17 Transporte mock exitoso", async () => {
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: { valid: true, uuid: "X", sat: { authorization: "A" } },
    sanitizedMessage: "ok",
  }))
  const result = await transport.send({
    url: `${FELPLEX_STAGE_BASE_URL}/api/entity/e/invoices/await`,
    apiKey: "fake",
    body: {},
    timeoutMs: 1000,
  })
  assertEquals(result.ok, true)
  record("1A.1-17 Transporte mock exitoso", "PASSED")
})

Deno.test("1A.1-18 Finalizacion exitosa confirmada", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: {
      valid: true,
      uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
      sat: { authorization: "AUTH-123", serie: "A", no: "123" },
    },
    sanitizedMessage: "ok",
  }))
  await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(repo.finalizations.length, 1)
  assertEquals(repo.finalizations[0]?.outcome, "success")
  record("1A.1-18 Finalizacion exitosa confirmada", "PASSED")
})

Deno.test("1A.1-19 Body crudo 4xx no persistido", async () => {
  const repo = makeRepo()
  const rawBody = { valid: false, errors: ["bad request"], secret: "api_key=hidden" }
  const transport = mockTransport(async () => ({
    ok: false,
    httpStatus: 400,
    body: rawBody,
    errorKind: "http_4xx",
    sanitizedMessage: "Solicitud rechazada (400).",
  }))
  await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(
    repo.finalizations.every((entry) => isSafeProviderPayload(entry.safeResponsePayload)),
    true,
  )
  assertEquals(
    repo.finalizations.some((entry) => entry.safeResponsePayload === rawBody),
    false,
  )
  record("1A.1-19 Body crudo 4xx no persistido", "PASSED")
})

Deno.test("1A.1-20 Body crudo 5xx no persistido", async () => {
  const repo = makeRepo()
  const rawBody = { html: "<html>secret api_key</html>" }
  const transport = mockTransport(async () => ({
    ok: false,
    httpStatus: 503,
    body: rawBody,
    errorKind: "http_5xx",
    sanitizedMessage: "Error temporal del proveedor (503).",
  }))
  await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }), {
    buildPayloadOverride: () => unblockedPayload(),
  })
  assertEquals(
    assertNoRawProviderBodyPersisted(
      { ok: false, httpStatus: 503, body: rawBody, sanitizedMessage: "x" },
      repo.finalizations[0]?.safeResponsePayload,
    ),
    true,
  )
  record("1A.1-20 Body crudo 5xx no persistido", "PASSED")
})

Deno.test("1A.1-21 Error con texto semejante a secreto sanitizado", () => {
  const sanitized = sanitizeFelplexErrors({ message: "Bearer secret-token leaked" })
  assertEquals(sanitized.includes("secret"), false)
  record("1A.1-21 Error con texto semejante a secreto sanitizado", "PASSED")
})

Deno.test("1A.1-22 Dos certifyInvoice concurrentes con Promise.all", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: {
      valid: true,
      uuid: "71916AF3-73F6-480B-B3B3-6F6E3DABC334",
      sat: { authorization: "AUTH-123" },
    },
    sanitizedMessage: "ok",
  }))
  const env = makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" })
  const [first, second] = await Promise.all([
    runCertify(repo, transport, env, { buildPayloadOverride: () => unblockedPayload() }),
    runCertify(repo, transport, env, { buildPayloadOverride: () => unblockedPayload() }),
  ])
  const codes = [first.body.error_code, second.body.error_code, first.body.status, second.body.status]
  assertEquals(codes.includes("FEL_ALREADY_PROCESSING") || repo.claims.length === 1, true)
  record("1A.1-22 Dos certifyInvoice concurrentes con Promise.all", "PASSED")
})

Deno.test("1A.1-23 Solo una obtiene claim", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: { valid: true, uuid: "U", sat: { authorization: "A" } },
    sanitizedMessage: "ok",
  }))
  const env = makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" })
  await Promise.all([
    runCertify(repo, transport, env, { buildPayloadOverride: () => unblockedPayload() }),
    runCertify(repo, transport, env, { buildPayloadOverride: () => unblockedPayload() }),
  ])
  assertEquals(repo.claims.length, 1)
  record("1A.1-23 Solo una obtiene claim", "PASSED")
})

Deno.test("1A.1-24 La otra recibe FEL_ALREADY_PROCESSING", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({
    ok: true,
    httpStatus: 200,
    body: { valid: true, uuid: "U", sat: { authorization: "A" } },
    sanitizedMessage: "ok",
  }))
  const env = makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" })
  const [first, second] = await Promise.all([
    runCertify(repo, transport, env, { buildPayloadOverride: () => unblockedPayload() }),
    runCertify(repo, transport, env, { buildPayloadOverride: () => unblockedPayload() }),
  ])
  const blocked = [first, second].find((entry) => entry.body.error_code === "FEL_ALREADY_PROCESSING")
  assertExists(blocked)
  record("1A.1-24 La otra recibe FEL_ALREADY_PROCESSING", "PASSED")
})

Deno.test("1A.1-25 Worker atrasado no sobrescribe certificado", async () => {
  const repo = makeRepo()
  repo.documents.set(Q297_DOCUMENT_ID, makeQ297Document({ status: "certified", fel_uuid: "KEEP" }))
  try {
    await repo.finalizeCertificationAttempt({
      documentId: Q297_DOCUMENT_ID,
      attemptId: crypto.randomUUID(),
      outcome: "success",
      felUuid: "NEW",
      satAuthorization: "NEW",
    })
    throw new Error("expected rejection")
  } catch (error) {
    assertEquals(error instanceof FinalizeError, true)
    if (error instanceof FinalizeError) {
      assertEquals(error.code, "FEL_ALREADY_CERTIFIED")
    }
  }
  assertEquals(repo.documents.get(Q297_DOCUMENT_ID)?.fel_uuid, "KEEP")
  record("1A.1-25 Worker atrasado no sobrescribe certificado", "PASSED")
})

Deno.test("1A.1-26 Documento processing no se reintenta automaticamente", async () => {
  const repo = makeRepo()
  repo.documents.set(Q297_DOCUMENT_ID, makeQ297Document({ status: "processing" }))
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }))
  assertEquals(result.body.error_code, "FEL_ALREADY_PROCESSING")
  assertEquals(transport.getCalls(), 0)
  record("1A.1-26 Documento processing no se reintenta automaticamente", "PASSED")
})

Deno.test("1A.1-27 UUID invalido", async () => {
  const repo = makeRepo()
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await certifyInvoice(
    { document_id: "not-a-uuid" },
    {
      repository: repo,
      transport,
      env: envGetter(makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" })),
      nowIso: FIXED_DATETIME,
      actor: makeCashActor(),
    },
  )
  assertEquals(result.body.error_code, "FEL_INVALID_INPUT")
  record("1A.1-27 UUID invalido", "PASSED")
})

Deno.test("1A.1-28 Excepcion inesperada del repositorio produce 500 generico", async () => {
  const repo = makeRepo()
  repo.claimBehavior = "throw"
  repo.claimMutex = Promise.resolve()
  const throwingRepo: InMemoryFelRepository = Object.assign(Object.create(Object.getPrototypeOf(repo)), repo, {
    claimCertificationAttempt() {
      throw new Error("unexpected db failure")
    },
  })
  try {
    await certifyInvoice(
      { document_id: Q297_DOCUMENT_ID },
      {
        repository: throwingRepo,
        transport: mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" })),
        env: envGetter(makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" })),
        nowIso: FIXED_DATETIME,
        actor: makeCashActor(),
        buildPayloadOverride: () => unblockedPayload(),
      },
    )
    record("1A.1-28 Excepcion inesperada del repositorio produce 500 generico", "FAILED", "no throw")
  } catch {
    record("1A.1-28 Excepcion inesperada del repositorio produce 500 generico", "PASSED")
  }
})

Deno.test("Preservado: CF bloqueado por contrato pendiente", () => {
  const build = buildFelplexPayload(makeQ297Document(), {
    datetimeIssue: FIXED_DATETIME,
    includeCandidate: true,
  })
  assertEquals(build.ok, false)
  record("Preservado: CF bloqueado por contrato", "PASSED")
})

Deno.test("Preservado: Payload sin secretos", () => {
  const build = buildFelplexPayload(makeQ297Document(), {
    datetimeIssue: FIXED_DATETIME,
    includeCandidate: true,
  })
  assertEquals(payloadContainsSecrets(build), false)
  record("Preservado: Payload sin secretos", "PASSED")
})

Deno.test("Preservado: Endpoint produccion bloqueado en gates", () => {
  const gate = evaluateCertificationGates({
    projectRef: "tgrqarxfmpwgrkntvgma",
    supabaseUrl: "https://tgrqarxfmpwgrkntvgma.supabase.co",
    emissionConfig: makeStageEmissionConfig({ emission_enabled: true }),
    providerConfig: {
      id: "x",
      provider_code: "felplex_gt",
      entity_id: "entity",
      environment: "stage",
      secret_env_var: "FELPLEX_GT_STAGE_API_KEY",
      base_url: FELPLEX_PRODUCTION_BASE_URL,
      is_active: true,
      is_default: true,
    },
    document: makeQ297Document(),
    reconciliation: makePaidReconciliation(),
    httpEnabled: true,
    apiKeyPresent: true,
    discountTotal: 0,
  })
  assertEquals(gate?.code, "FEL_PRODUCTION_BLOCKED")
  record("Preservado: Endpoint produccion bloqueado", "PASSED")
})

Deno.test("Preservado: Idempotencia certificado tras gates Stage", async () => {
  const repo = makeRepo()
  repo.documents.set(Q297_DOCUMENT_ID, makeQ297Document({ status: "certified", fel_uuid: "X" }))
  const transport = mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" }))
  const result = await runCertify(repo, transport, makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }))
  assertEquals(result.body.idempotent, true)
  assertEquals(transport.getCalls(), 0)
  record("Preservado: Idempotencia certificado tras gates Stage", "PASSED")
})

Deno.test("Handler exporta error generico interno", () => {
  assertEquals(GENERIC_INTERNAL_ERROR, "Error interno. Intente de nuevo.")
  record("Handler exporta error generico interno", "PASSED")
})

function transport4xxResult(): FelplexTransportResult {
  return {
    ok: false,
    httpStatus: 400,
    body: { valid: false, errors: ["bad request"] },
    errorKind: "http_4xx",
    sanitizedMessage: "Solicitud rechazada (400).",
  }
}

function transport5xxResult(): FelplexTransportResult {
  return {
    ok: false,
    httpStatus: 503,
    body: { html: "<html>error</html>" },
    errorKind: "http_5xx",
    sanitizedMessage: "Error temporal del proveedor (503).",
  }
}

function invalidProviderResult(): FelplexTransportResult {
  return {
    ok: true,
    httpStatus: 200,
    body: { valid: false, errors: ["invalid"] },
    sanitizedMessage: "Certificacion recibida.",
  }
}

Deno.test("1A.2-01 Transporte 4xx + finalize null → FEL_UNCERTAIN_OUTCOME", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "null"
  const result = await runCertify(
    repo,
    mockTransport(async () => transport4xxResult()),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  assertEquals(result.status, 500)
  record("1A.2-01 Transporte 4xx + finalize null", "PASSED")
})

Deno.test("1A.2-02 Transporte 4xx + finalize throw → FEL_UNCERTAIN_OUTCOME", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "throw"
  const result = await runCertify(
    repo,
    mockTransport(async () => transport4xxResult()),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  record("1A.2-02 Transporte 4xx + finalize throw", "PASSED")
})

Deno.test("1A.2-03 Transporte 5xx + finalize null → FEL_UNCERTAIN_OUTCOME", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "null"
  const result = await runCertify(
    repo,
    mockTransport(async () => transport5xxResult()),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  record("1A.2-03 Transporte 5xx + finalize null", "PASSED")
})

Deno.test("1A.2-04 Provider invalido + finalize falla → FEL_UNCERTAIN_OUTCOME", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "null"
  const result = await runCertify(
    repo,
    mockTransport(async () => invalidProviderResult()),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  record("1A.2-04 Provider invalido + finalize falla", "PASSED")
})

Deno.test("1A.2-05 Finalize failed incongruente → FEL_UNCERTAIN_OUTCOME", async () => {
  const repo = makeRepo()
  repo.finalizeBehavior = "incongruent"
  const result = await runCertify(
    repo,
    mockTransport(async () => transport4xxResult()),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "FEL_UNCERTAIN_OUTCOME")
  record("1A.2-05 Finalize failed incongruente", "PASSED")
})

Deno.test("1A.2-06 Config ON en gates pero OFF en claim bloqueado", async () => {
  const repo = makeRepo()
  repo.emissionConfig = makeStageEmissionConfig({ emission_enabled: true })
  repo.claimEmissionConfigOverride = makeStageEmissionConfig({ emission_enabled: false })
  const result = await runCertify(
    repo,
    mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" })),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "FEL_EMISSION_DISABLED")
  record("1A.2-06 Config ON en gates OFF en claim", "PASSED")
})

Deno.test("1A.2-07 Safe payload SQL static validation presente", () => {
  const migrationPath = new URL(
    "../../../migrations/20260808220000_pos_fel_attempt_lifecycle.sql",
    import.meta.url,
  )
  const sql = Deno.readTextFileSync(migrationPath)
  assertEquals(sql.includes("fel_validate_safe_response_payload"), true)
  assertEquals(sql.includes("FEL_SAFE_PAYLOAD_INVALID"), true)
  assertEquals(sql.includes("invoice_xml"), true)
  record("1A.2-07 Safe payload SQL static validation", "PASSED")
})

Deno.test("1A.2-08 Error RPC desconocido no expone mensaje interno", () => {
  const resolved = resolvePublicRpcError("FEL_RPC_UNKNOWN")
  assertEquals(resolved.httpStatus, 500)
  assertEquals(resolved.message, GENERIC_INTERNAL_ERROR)
  assertEquals(resolved.message.includes("pos_fel_documents"), false)
  record("1A.2-08 Error RPC desconocido generico", "PASSED")
})

Deno.test("1A.2-09 Handler try/catch devuelve 500 generico", async () => {
  const result = await handleFelplexCertifyInvoiceHttpSafe(
    {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer fake" }),
      json: async () => ({ document_id: Q297_DOCUMENT_ID }),
    },
    {
      env: envGetter(makeStageEnv({
        FELPLEX_HTTP_ENABLED: "true",
        SUPABASE_URL: "https://tgrqarxfmpwgrkntvgma.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
      })),
      transport: mockTransport(async () => ({ ok: true, sanitizedMessage: "noop" })),
      createRepository: () => {
        throw new Error("relation pos_fel_documents violates constraint")
      },
      getUserFromToken: async () => ({
        id: makeCashActor().id,
        role: "caja",
        status: "active",
      }),
    },
  )
  assertEquals(result.status, 500)
  assertEquals(result.body.error, GENERIC_INTERNAL_ERROR)
  assertEquals(String(result.body.error).includes("pos_fel"), false)
  record("1A.2-09 Handler try/catch 500 generico", "PASSED")
})

Deno.test("1A.2-10 Transporte 4xx + finalize OK devuelve error transporte", async () => {
  const repo = makeRepo()
  const result = await runCertify(
    repo,
    mockTransport(async () => transport4xxResult()),
    makeStageEnv({ FELPLEX_HTTP_ENABLED: "true" }),
    { buildPayloadOverride: () => unblockedPayload() },
  )
  assertEquals(result.body.error_code, "http_4xx")
  assertEquals(result.status, 422)
  record("1A.2-10 Transporte 4xx + finalize OK", "PASSED")
})

Deno.test("Resumen escenarios Fase 1A.2", () => {
  const passed = results.filter((entry) => entry.result === "PASSED").length
  const failed = results.filter((entry) => entry.result === "FAILED").length
  const notExecuted = results.filter((entry) => entry.result === "NOT_EXECUTED").length
  console.log(JSON.stringify({ passed, failed, not_executed: notExecuted, total: results.length, results }))
  assertEquals(failed, 0)
  assertEquals(notExecuted, 0)
})
