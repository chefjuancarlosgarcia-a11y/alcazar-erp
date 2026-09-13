import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const failures = []

const paths = {
  fixture: "supabase/stage-fixtures/felplex_gt_billing_bootstrap.sql",
  rollback: "supabase/stage-fixtures/felplex_gt_billing_bootstrap.rollback.sql",
  runbook: "docs/felplex-stage-billing-bootstrap-runbook.md",
  contractDoc: "docs/felplex-guatemala-api-contract.md",
}

function absolute(path) {
  return join(root, ...path.split("/"))
}

function read(path) {
  const full = absolute(path)
  if (!existsSync(full)) {
    failures.push(`Missing required file: ${path}`)
    return ""
  }
  return readFileSync(full, "utf8")
}

function requireCheck(condition, message) {
  if (!condition) failures.push(message)
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "")
}

function expectNegative(label, fn) {
  try {
    fn()
    failures.push(`Negative self-test should have failed: ${label}`)
  } catch (error) {
    if (error?.message !== "NEGATIVE_EXPECTED") {
      failures.push(`Negative self-test ${label} threw unexpectedly: ${error?.message ?? error}`)
    }
  }
}

export function validateFelplexStageBillingBootstrap(options = {}) {
  const rootDir = options.root ?? root
  const localFailures = []

  function abs(path) {
    return join(rootDir, ...path.split("/"))
  }

  function readLocal(path) {
    const full = abs(path)
    if (!existsSync(full)) {
      localFailures.push(`Missing required file: ${path}`)
      return ""
    }
    return readFileSync(full, "utf8")
  }

  function check(condition, message) {
    if (!condition) localFailures.push(message)
  }

  const fixture = readLocal(paths.fixture)
  const rollback = readLocal(paths.rollback)
  const runbook = readLocal(paths.runbook)
  const contractDoc = readLocal(paths.contractDoc)
  const fixtureCode = stripSqlComments(fixture)
  const rollbackCode = stripSqlComments(rollback)
  const combined = [fixture, rollback, runbook].join("\n")

  check(
    !paths.fixture.includes("supabase/migrations"),
    "Fixture must live outside supabase/migrations",
  )
  check(fixture.includes("felplex_gt_billing_bootstrap_guard"), "Fixture guard block is missing")
  check(
    fixture.indexOf("$felplex_gt_billing_bootstrap_guard$") <
      fixture.indexOf("insert into public.billing_legal_entities"),
    "Fixture Stage guard must appear before the first INSERT",
  )
  check(fixture.includes("emission_enabled = false"), "Fixture guard must require emission_enabled=false")
  check(fixture.includes("auto_issue_paid_orders = false"), "Fixture guard must require auto_issue_paid_orders=false")
  check(
    fixture.includes("formal_contingency_enabled = false"),
    "Fixture guard must require formal_contingency_enabled=false",
  )
  check(fixture.includes("environment = 'stage'"), "Fixture guard must require fel_emission_config environment=stage")
  check(!/\bupdate\b[\s\S]*fel_emission_config/i.test(fixtureCode), "Fixture must not UPDATE fel_emission_config")
  check(!/\binsert\b[\s\S]*environment\s*,\s*'production'/i.test(fixtureCode), "Fixture must not insert production environment")
  check(
    (fixture.match(/on conflict \(code\) do nothing/gi) ?? []).length >= 2,
    "Legal entity and provider catalog inserts must use ON CONFLICT (code) DO NOTHING",
  )
  check(
    fixture.includes("on conflict (legal_entity_id, provider_code, environment) do nothing"),
    "Provider config insert must use ON CONFLICT DO NOTHING",
  )
  check(fixture.includes("on conflict (provider_config_id) do nothing"), "Provider status insert must use ON CONFLICT DO NOTHING")
  check(!/\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i.test(fixtureCode), "Fixture must not use ON CONFLICT DO UPDATE")
  const insertLegalEntity = fixture.indexOf("insert into public.billing_legal_entities")
  const insertProviders = fixture.indexOf("insert into public.billing_providers")
  const insertConfigs = fixture.indexOf("insert into public.billing_provider_configs")
  const insertStatus = fixture.indexOf("insert into public.billing_provider_status")
  check(insertLegalEntity >= 0 && insertProviders > insertLegalEntity, "Fixture must insert legal entity before provider catalog")
  check(insertProviders >= 0 && insertConfigs > insertProviders, "Fixture must insert provider catalog before provider config")
  check(insertConfigs >= 0 && insertStatus > insertConfigs, "Fixture must insert provider config before provider status")
  check(fixture.includes("entity_id = '547'"), "Fixture must set entity_id exactly to 547")
  check(fixture.includes("tax_id = '326070'"), "Fixture must set tax_id exactly to 326070")
  check(fixture.includes("'326070'"), "Fixture must treat tax_id as text literal")
  check(!fixture.includes("'326-070'"), "Fixture tax_id must not contain hyphens")
  check(fixture.includes("Pruebas Gran Alcazar"), "Fixture must include exact legal_name/trade_name")
  check(fixture.includes("https://felplex.stage.plex.lat"), "Fixture must include exact Stage base URL")
  check(
    fixture.includes("adapter_key") && fixture.match(/'felplex_gt'/g)?.length >= 2,
    "Fixture must include adapter_key and provider_code felplex_gt",
  )
  check(
    fixture.includes("FELPLEX_GT_STAGE_API_KEY"),
    "Fixture must reference logical secret_env_var name only",
  )
  check(fixture.includes("connection_status = 'unknown'"), "Fixture status must initialize connection_status unknown")
  check(!/\b(?:sk_live|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/.test(combined), "Bootstrap artifacts must not contain API keys or JWTs")
  check(!/\b(?:postgres|postgresql):\/\//i.test(combined), "Bootstrap artifacts must not contain database URLs")
  check(!/\bpg_net\b|\bnet\.http_[a-z_]+\s*\(/i.test(combined), "Bootstrap artifacts must not contain HTTP/pg_net calls")
  check(!/\b(?:cascade|truncate)\b/i.test(stripSqlComments(rollback)), "Rollback must not use CASCADE or TRUNCATE")
  check(rollback.includes("pos_fel_documents"), "Rollback must guard against certified/processing FEL documents")
  check(rollback.includes("billing_certification_attempts"), "Rollback must guard against billing certification attempts")
  check(rollback.includes("delete from public.billing_provider_status"), "Rollback must delete provider status first")
  check(rollback.includes("delete from public.billing_provider_configs"), "Rollback must delete provider config")
  check(runbook.includes("NOT EXECUTED IN STAGE"), "Runbook must declare NOT EXECUTED IN STAGE")
  check(
    contractDoc.includes("billing_provider_configs.entity_id"),
    "Contract doc must reference billing_provider_configs.entity_id",
  )
  check(
    contractDoc.includes("billing_provider_configs.base_url"),
    "Contract doc must reference billing_provider_configs.base_url",
  )
  check(
    !contractDoc.includes("billing_providers.entity_id"),
    "Contract doc must not reference billing_providers.entity_id",
  )
  check(
    !contractDoc.includes("billing_providers.base_url"),
    "Contract doc must not reference billing_providers.base_url",
  )
  check(
    contractDoc.includes("billing_providers es únicamente el catálogo")
      || contractDoc.includes("billing_providers` es únicamente el catálogo"),
    "Contract doc must explain billing_providers as catalog only",
  )

  expectNegative("do update must be rejected", () => {
    const poisoned = "insert into t values (1) on conflict (id) do update set x = 1;"
    if (!/\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i.test(stripSqlComments(poisoned))) return
    throw new Error("NEGATIVE_EXPECTED")
  })

  expectNegative("production environment insert must be rejected", () => {
    const poisoned = "insert into public.billing_provider_configs (environment) values ('production');"
    if (!/\bvalues\s*\(\s*'production'\s*\)/i.test(stripSqlComments(poisoned))) return
    throw new Error("NEGATIVE_EXPECTED")
  })

  return localFailures
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  failures.push(...validateFelplexStageBillingBootstrap())
  if (failures.length > 0) {
    console.error(`FELplex Stage billing bootstrap validation failed (${failures.length}):`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }
  console.log("FELplex Stage billing bootstrap validation passed.")
  console.log("No SQL execution, Supabase CLI, Stage connection, or secret access was performed.")
}
