/**
 * Real local snapshot lab (Docker PG + snapshot.ps1 without native psql/pg_dump).
 * Does NOT connect to Stage/Production remotes.
 *
 * Usage: node scripts/run-finance-stage-snapshot-docker-lab.mjs
 */
import { createHash } from "node:crypto"
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment } from "./finance-lab-guards.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const labDir = join(root, "supabase", "lab")
const snapshotPs1 = join(root, "scripts", "stage-finance-accounting-snapshot.ps1")
const evidenceDir = join(root, ".local-backup", "finance-stage-snapshot-docker-lab")
const outputRoot = join(evidenceDir, "snapshots")
const container = `finance-stage-snapshot-${Date.now()}`
const hostPort = 55510 + Math.floor(Math.random() * 20)

export const STAGE_REF = "tgrqarxfmpwgrkntvgma"
export const PRODUCTION_REF = "lwpfrdnsiwtmyonwcduh"

mkdirSync(evidenceDir, { recursive: true })
mkdirSync(outputRoot, { recursive: true })

const results = []
let exitCode = 0

function log(step, ok, detail = "") {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}\t${step}${detail ? `\t${detail}` : ""}`)
  if (!ok) exitCode = 1
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim()
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function pathWithoutPgTools() {
  return (process.env.PATH || "")
    .split(";")
    .filter((part) => !/postgres|\\pg\\|pgsql/i.test(part))
    .join(";")
}

function stageLabUrl(password = "lab_pass") {
  return `postgresql://postgres.${STAGE_REF}:${password}@127.0.0.1:${hostPort}/postgres`
}

function productionLabUrl() {
  return `postgresql://postgres.${PRODUCTION_REF}:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function directLabUrl() {
  return `postgresql://postgres:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function sessionPoolerRemoteShapeUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
}

function transactionPoolerUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
}

function directRemoteShapeUrl() {
  return `postgresql://postgres:lab_pass@db.${STAGE_REF}.supabase.co:5432/postgres`
}

function fakeSupabaseHostUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@evil.pooler.supabase.com.attacker.example:5432/postgres`
}

function testUriValidation(label, { uri, stageRef = STAGE_REF, productionRef = PRODUCTION_REF, allowLabLocal = false, expectSuccess }) {
  const modulePath = join(root, "scripts", "finance-stage-postgres-connection.ps1").replace(/\\/g, "\\\\")
  const allowFlag = allowLabLocal ? "-AllowLabLocal" : ""
  const ps = `
$ErrorActionPreference = 'Stop'
. '${modulePath}'
try {
  $null = Test-StagePostgresConnectionUri -ConnectionString '${uri}' -StageRef '${stageRef}' -ProductionRef '${productionRef}' ${allowFlag}
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    cwd: root
  })
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  const ok = expectSuccess ? r.status === 0 : r.status !== 0
  return { ok, out, status: r.status ?? 1 }
}

function invokeSnapshot({
  label,
  extraArgs = [],
  databaseUrl = stageLabUrl(),
  stageRef = STAGE_REF,
  productionRef = PRODUCTION_REF,
  outputRootOverride = outputRoot,
  expectSuccess = true,
  envExtra = {}
}) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    snapshotPs1,
    "-OutputRoot",
    outputRootOverride,
    ...extraArgs
  ]
  const r = spawnSync("powershell", args, {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      ...envExtra,
      PATH: pathWithoutPgTools(),
      ALCAZAR_STAGE_DATABASE_URL: databaseUrl,
      ALCAZAR_STAGE_PROJECT_REF: stageRef,
      ALCAZAR_PRODUCTION_PROJECT_REF: productionRef
    }
  })
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  const ok = expectSuccess ? r.status === 0 : r.status !== 0
  return { ok, out, status: r.status ?? 1 }
}

function psql(sql, label = "inline") {
  const r = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  if (r.status !== 0) throw new Error(`${label} failed: ${out.slice(-2000)}`)
  return out
}

function psqlFile(path, label) {
  return psql(readFileSync(path, "utf8"), label)
}

function latestSnapshotDir() {
  const dirs = readdirSync(outputRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(outputRoot, d.name))
    .sort()
  return dirs.at(-1) || null
}

function verifyManifest(dir) {
  const manifestPath = readdirSync(dir).find((f) => f.startsWith("manifest-") && f.endsWith(".json"))
  if (!manifestPath) throw new Error("manifest missing")
  const manifest = JSON.parse(readFileSync(join(dir, manifestPath), "utf8"))
  for (const entry of manifest.files) {
    const filePath = entry.path
    const hash = sha256(readFileSync(filePath))
    if (hash !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${filePath}`)
    }
  }
  return { manifest, manifestPath: join(dir, manifestPath) }
}

function listBaselineMigrations() {
  return readdirSync(schemaDir)
    .filter((f) => /^(\d{3})_/.test(f) && f.endsWith(".sql"))
    .filter((f) => {
      const n = parseInt(f.slice(0, 3), 10)
      if (n > 196) return false
      if (/^(\d{3})_test_/.test(f)) return false
      if (f.startsWith("diagnose_")) return false
      if (f.includes("concurrency")) return false
      if (f.includes("_perf_explain")) return false
      return true
    })
    .sort((a, b) => parseInt(a.slice(0, 3), 10) - parseInt(b.slice(0, 3), 10))
}

const snapshotSeedSql = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres.${STAGE_REF}') then
    execute format('create role %I login password %L superuser', 'postgres.${STAGE_REF}', 'lab_pass');
  end if;
end $$;

create table if not exists public.finance_chart_accounts (id uuid primary key default gen_random_uuid());
create table if not exists public.branches (id uuid primary key default gen_random_uuid());
create table if not exists public.finance_cost_centers (id uuid primary key default gen_random_uuid());
create table if not exists public.finance_accounting_periods (id uuid primary key default gen_random_uuid());
create table if not exists public.finance_journal_entries (id uuid primary key default gen_random_uuid());
create table if not exists public.finance_journal_lines (id uuid primary key default gen_random_uuid());
create table if not exists public.finance_journal_entry_counters (id uuid primary key default gen_random_uuid());

insert into public.app_settings (key, value) values
  ('felplex_stage_config', jsonb_build_object('enabled', true, 'source', 'lab_dummy'))
on conflict (key) do nothing;
`

try {
  assertLocalLabEnvironment()
  assertDockerAvailable()
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=lab_pass -p ${hostPort}:5432 postgres:16-alpine`)
  for (let i = 0; i < 30; i++) {
    if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" }).status === 0) break
    execSync("powershell -Command Start-Sleep -Seconds 1")
  }

  psqlFile(join(labDir, "bootstrap-supabase-local.sql"), "bootstrap")
  for (const file of listBaselineMigrations()) {
    psqlFile(join(schemaDir, file), file)
  }
  psql(snapshotSeedSql, "snapshot_seed")

  const uriSessionPooler = testUriValidation("uri_session_pooler_5432", {
    uri: sessionPoolerRemoteShapeUrl(),
    expectSuccess: true
  })
  log("uri_session_pooler_5432", uriSessionPooler.ok, "remote shape validation only")

  const uriTransactionPooler = testUriValidation("uri_transaction_pooler_6543", {
    uri: transactionPoolerUrl(),
    expectSuccess: false
  })
  log("uri_transaction_pooler_6543_rejected", uriTransactionPooler.ok, "6543 rejected")

  const uriDirect = testUriValidation("uri_direct_5432", {
    uri: directRemoteShapeUrl(),
    expectSuccess: true
  })
  log("uri_direct_5432", uriDirect.ok, "remote shape validation only")

  const uriFakeHost = testUriValidation("uri_fake_supabase_host", {
    uri: fakeSupabaseHostUrl(),
    expectSuccess: false
  })
  log("uri_fake_supabase_host_rejected", uriFakeHost.ok, "fake host rejected")

  const uriLabSession = testUriValidation("uri_lab_session_pooler_local", {
    uri: stageLabUrl(),
    allowLabLocal: true,
    expectSuccess: true
  })
  log("uri_lab_session_pooler_local", uriLabSession.ok, "localhost lab")

  const uriLabDirect = testUriValidation("uri_lab_direct_local", {
    uri: directLabUrl(),
    allowLabLocal: true,
    expectSuccess: true
  })
  log("uri_lab_direct_local", uriLabDirect.ok, "localhost lab direct")

  const dry = invokeSnapshot({ label: "dryrun_docker_tooling", extraArgs: ["-DryRun", "-UninitializedStage"], expectSuccess: true })
  log("docker_tooling_dryrun", dry.ok && dry.out.includes("pg_dump=docker") && dry.out.includes("psql=docker"), "docker fallback")

  const uninitialized = invokeSnapshot({ label: "snapshot_uninitialized", extraArgs: ["-UninitializedStage"], expectSuccess: true })
  const snapDir = latestSnapshotDir()
  log("snapshot_uninitialized_real", uninitialized.ok && !!snapDir, snapDir || "missing dir")
  log(
    "pgdump_compatible_with_server",
    uninitialized.ok && /PostgreSQL server=/.test(uninitialized.out) && /pg_dump=/.test(uninitialized.out),
    "version lines present"
  )

  let manifestInfo = null
  if (snapDir) {
    manifestInfo = verifyManifest(snapDir)
    log("manifest_sha256_valid", true, manifestInfo.manifestPath)
    log("manifest_uninitialized_stage", manifestInfo.manifest.uninitialized_stage === true, "true")
    writeFileSync(join(evidenceDir, "manifest-inventory.json"), JSON.stringify(manifestInfo.manifest, null, 2))
  } else {
    log("manifest_sha256_valid", false, "no snapshot dir")
  }

  const schemaFile = manifestInfo?.manifest.files.find((f) => /schema-only/.test(f.path))?.path
  const tablesFile = manifestInfo?.manifest.files.find((f) => /finance-target-tables/.test(f.path))?.path
  if (schemaFile && existsSync(schemaFile)) {
    const schemaContent = readFileSync(schemaFile, "utf8")
    log("schema_dump_inspectable", schemaContent.includes("CREATE TABLE") && schemaContent.length > 500, `bytes=${schemaContent.length}`)
  } else {
    log("schema_dump_inspectable", false, "missing schema file")
  }
  if (tablesFile && existsSync(tablesFile)) {
    const tablesContent = readFileSync(tablesFile, "utf8")
    log("data_dump_inspectable", /COPY public\.|INSERT INTO public\./.test(tablesContent), `bytes=${tablesContent.length}`)
  } else {
    log("data_dump_inspectable", false, "missing tables file")
  }

  psql(
    `insert into public.app_settings (key, value) values ('deployment_environment', jsonb_build_object('name','stage','project_ref','${STAGE_REF}')) on conflict (key) do update set value = excluded.value;`,
    "seed_identity"
  )
  const normal = invokeSnapshot({ label: "snapshot_normal", expectSuccess: true })
  log("snapshot_normal_real", normal.ok, "with deployment_environment")

  const prodReject = invokeSnapshot({
    label: "production_ref_rejected",
    databaseUrl: productionLabUrl(),
    extraArgs: ["-UninitializedStage"],
    expectSuccess: false
  })
  log("production_ref_rejected", prodReject.ok, "rejected")

  const failRoot = join(evidenceDir, "failure-test")
  mkdirSync(failRoot, { recursive: true })
  const beforeFailDirs = readdirSync(failRoot).length
  const fail = invokeSnapshot({
    label: "failure_cleanup",
    databaseUrl: stageLabUrl("wrong_password"),
    outputRootOverride: failRoot,
    expectSuccess: false
  })
  const afterFailDirs = existsSync(failRoot) ? readdirSync(failRoot).length : 0
  log("failure_removes_partial_dir", fail.ok && beforeFailDirs === afterFailDirs, `dirs=${afterFailDirs}`)

  const pgDumpFailRoot = join(evidenceDir, "pgdump-version-fail")
  mkdirSync(pgDumpFailRoot, { recursive: true })
  const beforePgDumpDirs = readdirSync(pgDumpFailRoot).length
  run("docker pull postgres:15-alpine")
  const pgDumpFail = invokeSnapshot({
    label: "pgdump_incompatible",
    extraArgs: ["-UninitializedStage"],
    outputRootOverride: pgDumpFailRoot,
    expectSuccess: false,
    envExtra: { ALCAZAR_FINANCE_PG_DOCKER_TAG: "postgres:15-alpine" }
  })
  const afterPgDumpDirs = readdirSync(pgDumpFailRoot).length
  log(
    "pgdump_older_than_server_rejected",
    pgDumpFail.ok && beforePgDumpDirs === afterPgDumpDirs && /older than server major/i.test(pgDumpFail.out),
    `dirs=${afterPgDumpDirs}`
  )

  writeFileSync(join(evidenceDir, "results.json"), JSON.stringify(results, null, 2))
} catch (e) {
  log("lab_error", false, e.message)
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
