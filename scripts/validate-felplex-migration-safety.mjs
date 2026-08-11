import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const migrationsDir = join(root, "supabase", "migrations")
const failures = []

const paths = {
  baseline: "supabase/migrations/20260808180000_erp_schema_baseline.sql",
  seed: "supabase/migrations/20260808200000_user_roles_catalog_seed.sql",
  trigger: "supabase/migrations/20260808210000_restore_cross_schema_triggers.sql",
  felBase: "supabase/migrations/20260808190000_pos_fel_documents.sql",
  lifecycle: "supabase/migrations/20260808220000_pos_fel_attempt_lifecycle.sql",
  hardening: "supabase/migrations/20260808230000_pos_fel_premerge_hardening.sql",
  hardeningRollback: "supabase/rollback/20260808230000_pos_fel_premerge_hardening.rollback.sql",
  fixtureEnv: "supabase/functions/_shared/felplex/fixtures.ts",
  payloadBuilder: "supabase/functions/_shared/felplex/payloadBuilder.ts",
  workflow: ".github/workflows/felplex-ci.yml",
  packageJson: "package.json",
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

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function validateSqlDelimiters(path, sql) {
  const dollarTags = [...sql.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g)].map((match) => match[0])
  const stack = []
  for (const tag of dollarTags) {
    if (stack.at(-1) === tag) stack.pop()
    else stack.push(tag)
  }
  requireCheck(stack.length === 0, `${path}: unbalanced dollar-quoted SQL delimiters`)

  const withoutStrings = stripSqlComments(sql)
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/'(?:''|[^'])*'/g, "")
  let depth = 0
  for (const char of withoutStrings) {
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (depth < 0) break
  }
  requireCheck(depth === 0, `${path}: unbalanced SQL parentheses`)
}

const baselineBuffer = existsSync(absolute(paths.baseline))
  ? readFileSync(absolute(paths.baseline))
  : Buffer.alloc(0)
const baseline = baselineBuffer.toString("utf8")
const guardBoundary = Buffer.from("$erp_baseline_guard$;\n\n", "ascii")
const guardBoundaryAt = baselineBuffer.indexOf(guardBoundary)
const secondGuardBoundaryAt = guardBoundaryAt >= 0
  ? baselineBuffer.indexOf(guardBoundary, guardBoundaryAt + guardBoundary.length)
  : -1
requireCheck(guardBoundaryAt >= 0, "Exact baseline guard/snapshot boundary is missing")
requireCheck(secondGuardBoundaryAt < 0, "Baseline guard/snapshot boundary is ambiguous")

const guardStart = baseline.indexOf("do $erp_baseline_guard$")
const guardEndMarker = "$erp_baseline_guard$;"
const guardEnd = baseline.indexOf(guardEndMarker, guardStart)
requireCheck(guardStart >= 0, "Baseline guard is missing at the beginning")
requireCheck(guardEnd > guardStart, "Baseline guard terminator is missing")

if (guardStart >= 0) {
  const beforeGuard = stripSqlComments(baseline.slice(0, guardStart))
  requireCheck(
    !/\b(?:create|alter|grant|revoke|set)\b|pg_catalog\.set_config\s*\(/i.test(beforeGuard),
    "Mutating DDL/session command appears before the baseline guard",
  )
}

const guardText = guardStart >= 0 && guardEnd >= 0
  ? baseline.slice(guardStart, guardEnd + guardEndMarker.length)
  : ""
for (const token of [
  "ERP_BASELINE_REQUIRES_EMPTY_PUBLIC",
  "ERP_BASELINE_REQUIRES_SUPABASE_PLATFORM",
  "public.profiles",
  "public.pos_orders",
  "public.user_roles",
  "public.areas",
  "auth.users",
  "storage.buckets",
  "pgcrypto",
  "'r', 'p', 'v', 'm', 'S', 'f'",
]) {
  requireCheck(guardText.includes(token), `Baseline guard is missing required token: ${token}`)
}
requireCheck(!/\bcascade\b/i.test(guardText), "Baseline guard must not use CASCADE")

if (guardBoundaryAt >= 0) {
  const suffixStart = guardBoundaryAt + guardBoundary.length
  const suffix = baselineBuffer.subarray(suffixStart)
  const suffixHash = createHash("sha256").update(suffix).digest("hex").toUpperCase()
  requireCheck(
    suffix.length === 2141307,
    `Baseline reviewed suffix must contain 2141307 bytes (actual ${suffix.length})`,
  )
  requireCheck(
    suffixHash === "F0A9AA71F46D78084D40DBDF5454ABB5BB55F809F4AA3D145B36E090C1FAAD35",
    `Baseline reviewed suffix changed (actual ${suffixHash})`,
  )
}

const baselineAttr = spawnSync(
  "git",
  ["check-attr", "text", "--", paths.baseline],
  { cwd: root, encoding: "utf8" },
)
requireCheck(baselineAttr.status === 0, "Unable to inspect baseline Git text attribute")
requireCheck(
  baselineAttr.stdout.trim().endsWith(": text: unset"),
  `Baseline Git text attribute must be unset (actual: ${baselineAttr.stdout.trim()})`,
)

const filteredObject = spawnSync(
  "git",
  ["hash-object", "--stdin", `--path=${paths.baseline}`],
  { cwd: root, input: baselineBuffer, encoding: "utf8" },
)
const rawObjectId = createHash("sha1")
  .update(Buffer.from(`blob ${baselineBuffer.length}\0`, "ascii"))
  .update(baselineBuffer)
  .digest("hex")
requireCheck(filteredObject.status === 0, "Unable to test Git baseline clean filtering")
requireCheck(
  filteredObject.stdout.trim() === rawObjectId,
  "Git clean filtering would normalize the reviewed baseline snapshot",
)

const seed = read(paths.seed)
const seedCode = stripSqlComments(seed)
requireCheck(
  /on\s+conflict\s*\(\s*role_key\s*\)\s*do\s+nothing\s*;/i.test(seedCode),
  "Role seed must use ON CONFLICT (role_key) DO NOTHING",
)
requireCheck(!/\bdo\s+update\b/i.test(seedCode), "Role seed must never use DO UPDATE")
const roleRows = [...seedCode.matchAll(/\(\s*'[^']+'\s*,\s*'[^']+'/g)]
requireCheck(roleRows.length === 26, `Role seed must retain 26 rows (found ${roleRows.length})`)

const trigger = read(paths.trigger)
for (const token of [
  "t.tgenabled = 'O'",
  "t.tgqual is null",
  "t.tgnargs = 0",
  "octet_length(t.tgargs) = 0",
  "t.tgtype = 5",
  "t.tgconstraint = 0",
]) {
  requireCheck(trigger.includes(token), `Auth trigger validation is missing: ${token}`)
}

const migrationNames = readdirSync(migrationsDir).filter((name) => /^\d{14}_.+\.sql$/.test(name))
const timestampCounts = new Map()
for (const name of migrationNames) {
  const timestamp = name.slice(0, 14)
  timestampCounts.set(timestamp, (timestampCounts.get(timestamp) ?? 0) + 1)
  requireCheck(!/fixture/i.test(name), `Stage fixture is not allowed in migrations: ${name}`)
}
for (const [timestamp, count] of timestampCounts) {
  requireCheck(count === 1, `Duplicate migration timestamp ${timestamp} (${count} files)`)
}

const rollbackAlternatives = [
  ["20260808190000", ["supabase/rollback/201_pos_fel_documents.rollback.sql"]],
  ["20260808220000", ["supabase/rollback/20260808220000_pos_fel_attempt_lifecycle.rollback.sql"]],
  ["20260808230000", [paths.hardeningRollback]],
]
for (const [timestamp, alternatives] of rollbackAlternatives) {
  requireCheck(
    alternatives.some((path) => existsSync(absolute(path))),
    `Missing rollback artifact for FEL migration ${timestamp}`,
  )
}

for (const path of [paths.felBase, paths.lifecycle, paths.hardening]) {
  const code = stripSqlComments(read(path))
  requireCheck(
    !/\bpg_net\b|\bnet\.http_[a-z_]+\s*\(|\bhttp_(?:get|post|put|delete)\s*\(/i.test(code),
    `${path}: FEL migration must not contain HTTP/pg_net calls`,
  )
  validateSqlDelimiters(path, read(path))
}

const hardening = read(paths.hardening)
const hardeningCode = stripSqlComments(hardening)
const hardeningGuardEnd = hardening.indexOf("$fel_premerge_config_guard$;")
const hardeningGuardText = hardeningGuardEnd >= 0
  ? hardening.slice(0, hardeningGuardEnd + "$fel_premerge_config_guard$;".length)
  : ""
requireCheck(hardeningGuardEnd >= 0, "230000 pre-merge config guard terminator is missing")
requireCheck(
  /emission_enabled\s+is\s+distinct\s+from\s+false/i.test(hardeningGuardText),
  "230000 guard must fail closed when emission_enabled is distinct from false",
)
requireCheck(
  hardeningGuardText.includes("FEL_HARDENING_REQUIRES_EMISSION_DISABLED"),
  "230000 guard must raise FEL_HARDENING_REQUIRES_EMISSION_DISABLED",
)
requireCheck(
  !/\bupdate\b[\s\S]*fel_emission_config[\s\S]*emission_enabled\s*=\s*false/i.test(hardeningCode),
  "230000 must not auto-disable emission_enabled with UPDATE",
)
requireCheck(
  !/\b(?:alter\s+table|create\s+or\s+replace\s+function|revoke\s+all|grant\s+)\b/i.test(
    stripSqlComments(hardening.slice(0, hardeningGuardEnd)),
  ),
  "230000 config guard must execute before the first mutation",
)

const fixtureEnv = read(paths.fixtureEnv)
requireCheck(
  /\[\s*["']FELPLEX_HTTP_ENABLED["']\s*,\s*["']false["']\s*\]/.test(fixtureEnv),
  "FELPLEX_HTTP_ENABLED must remain false by default",
)
requireCheck(
  read(paths.payloadBuilder).includes("FELPLEX_CONTRACT_UNCONFIRMED"),
  "FELPLEX_CONTRACT_UNCONFIRMED fail-closed marker disappeared",
)

const rollback230 = read(paths.hardeningRollback)
for (const token of [
  "fel_validate_request_payload(jsonb)",
  "request_pos_fel_certification",
  "fel_finalize_pos_fel_certification_attempt",
  "FEL_PREMERGE_ROLLBACK_UNSAFE",
]) {
  requireCheck(rollback230.includes(token), `230000 rollback correspondence missing: ${token}`)
}
requireCheck(!/\bcascade\b/i.test(stripSqlComments(rollback230)), "230000 rollback must not use CASCADE")

const packageJson = JSON.parse(read(paths.packageJson))
const workflow = read(paths.workflow)
requireCheck(!workflow.includes("\t"), "Workflow YAML must not contain tab indentation")
for (const [index, line] of workflow.split(/\r?\n/).entries()) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue
  const indent = line.length - line.trimStart().length
  requireCheck(indent % 2 === 0, `Workflow YAML line ${index + 1} has invalid indentation`)
  requireCheck(
    /^\s*(?:-\s+(?:[A-Za-z0-9_.-]+:.*|\S.*)|[A-Za-z0-9_.-]+:)(?:\s+.*)?$/.test(line),
    `Workflow YAML line ${index + 1} is outside the validated mapping/list subset`,
  )
}
for (const key of ["name:", "on:", "permissions:", "jobs:"]) {
  requireCheck(
    workflow.split(/\r?\n/).some((line) => line.startsWith(key)),
    `Workflow YAML is missing top-level key ${key}`,
  )
}
const pullRequestPaths = workflow.match(
  /pull_request:\s*\n\s*paths:\s*\n([\s\S]*?)(?:\n\s*push:|\n\s*permissions:)/,
)?.[1] ?? ""
const pushPaths = workflow.match(
  /push:\s*\n\s*paths:\s*\n([\s\S]*?)(?:\n\s*permissions:|\n\s*jobs:)/,
)?.[1] ?? ""
requireCheck(
  /-\s+"\.gitattributes"/.test(pullRequestPaths),
  "Workflow pull_request.paths must include .gitattributes",
)
requireCheck(
  /-\s+"\.gitattributes"/.test(pushPaths),
  "Workflow push.paths must include .gitattributes",
)
const ciSurface = [
  JSON.stringify(packageJson.scripts ?? {}),
  workflow,
].join("\n")
requireCheck(
  !/supabase\s+(?:db\s+(?:push|pull|reset|dump)|functions\s+deploy|login|link)\b|--linked\b|postgres(?:ql)?:\/\//i.test(ciSurface),
  "CI-executed scripts must not deploy or connect to remote Supabase/PostgreSQL",
)

const scopedFiles = [
  ...walk(join(root, "supabase", "functions", "_shared", "felplex")),
  ...walk(join(root, "supabase", "functions", "felplex-certify-invoice")),
  ...[paths.felBase, paths.lifecycle, paths.hardening].map(absolute),
  absolute(paths.hardeningRollback),
].filter(existsSync)
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b(?:postgres|postgresql):\/\/[^/\s]+:[^@\s]+@/i,
  /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
]
for (const file of scopedFiles) {
  const content = readFileSync(file, "utf8")
  for (const pattern of secretPatterns) {
    requireCheck(!pattern.test(content), `Detectable secret in ${relative(root, file)}`)
  }
}

validateSqlDelimiters(paths.baseline, baseline)
validateSqlDelimiters(paths.seed, seed)
validateSqlDelimiters(paths.trigger, trigger)
validateSqlDelimiters(paths.hardeningRollback, rollback230)
validateSqlDelimiters(
  "supabase/schema/20260808230000_test_pos_fel_premerge_hardening.sql",
  read("supabase/schema/20260808230000_test_pos_fel_premerge_hardening.sql"),
)

if (failures.length > 0) {
  console.error(`FELplex migration safety validation failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`FELplex migration safety validation passed (${migrationNames.length} timestamped migrations checked).`)
console.log("No network, SQL execution, deployment or remote connection was performed.")
