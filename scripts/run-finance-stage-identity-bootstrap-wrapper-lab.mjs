/**
 * Local lab for invoke-finance-stage-identity-bootstrap.ps1 (Docker PG only).
 * Does NOT connect to Stage/Production remotes.
 *
 * Usage: node scripts/run-finance-stage-identity-bootstrap-wrapper-lab.mjs
 */
import { execSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment } from "./finance-lab-guards.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const labDir = join(root, "supabase", "lab")
const wrapperPs1 = join(root, "scripts", "invoke-finance-stage-identity-bootstrap.ps1")
const evidenceDir = join(root, ".local-backup", "finance-stage-identity-bootstrap-wrapper-lab")
const container = `finance-stage-wrapper-${Date.now()}`
const hostPort = 55480 + Math.floor(Math.random() * 20)

export const STAGE_REF = "tgrqarxfmpwgrkntvgma"
export const PRODUCTION_REF = "lwpfrdnsiwtmyonwcduh"
export const WRONG_STAGE_REF = "wrong-stage-ref-lab"

mkdirSync(evidenceDir, { recursive: true })
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

function psql(sql, label = "inline", { allowFailure = false } = {}) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  )
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  if (!allowFailure && r.status !== 0) throw new Error(`${label} failed: ${out.slice(-2500)}`)
  return { out, status: r.status ?? 1 }
}

function psqlFile(path, label, opts = {}) {
  return psql(readFileSync(path, "utf8"), label, opts)
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function stageLabUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function productionLabUrl() {
  return `postgresql://postgres.${PRODUCTION_REF}:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function noRefLabUrl() {
  return `postgresql://postgres:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function invokeWrapper({
  label,
  manifestPath,
  databaseUrl = stageLabUrl(),
  stageRef = STAGE_REF,
  productionRef = PRODUCTION_REF,
  operatorConfirmation = STAGE_REF,
  maxSnapshotAgeHours = 24,
  validateOnly = false,
  expectSuccess = false
}) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    wrapperPs1,
    "-SnapshotManifestPath",
    manifestPath,
    "-MaxSnapshotAgeHours",
    String(maxSnapshotAgeHours),
    "-OperatorConfirmation",
    operatorConfirmation
  ]
  if (validateOnly) args.push("-ValidateOnly")

  const r = spawnSync("powershell", args, {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
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

function createManifest(dir, {
  stageRef = STAGE_REF,
  productionRef = PRODUCTION_REF,
  uninitializedStage = true,
  createdAt = new Date().toISOString(),
  tamperFile = null
} = {}) {
  mkdirSync(dir, { recursive: true })
  const schemaFile = join(dir, "schema-only.sql")
  const tablesFile = join(dir, "finance-target-tables.sql")
  const baselineFile = join(dir, "baseline-counts.txt")
  writeFileSync(schemaFile, "-- lab schema\n", "utf8")
  writeFileSync(tablesFile, "-- lab tables\n", "utf8")
  writeFileSync(baselineFile, "deployment_environment_present=false\n", "utf8")
  if (tamperFile) {
    appendFileSync(tamperFile, "\n-- tampered\n", "utf8")
  }
  const manifest = {
    manifest_version: 1,
    dry_run: false,
    uninitialized_stage: uninitializedStage,
    stage_project_ref: stageRef,
    production_project_ref: productionRef,
    timestamp: "lab",
    created_at: createdAt,
    files: [
      { path: schemaFile, sha256: sha256(readFileSync(schemaFile)) },
      { path: tablesFile, sha256: sha256(readFileSync(tablesFile)) },
      { path: baselineFile, sha256: sha256(readFileSync(baselineFile)) }
    ],
    target_tables: []
  }
  const manifestPath = join(dir, "manifest-lab.json")
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  return manifestPath
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
  for (const file of [
    "197_fix_operational_pin_module_station_type.sql",
    "198_operational_station_pos_shared_foundation.sql",
    "199_fix_operational_station_pos_catalog_parity.sql",
    "200_fix_station_pos_audit_actor.sql"
  ]) {
    psqlFile(join(schemaDir, file), file)
  }
  psql(
    `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres.${STAGE_REF}') then
    execute format('create role %I login password %L superuser', 'postgres.${STAGE_REF}', 'lab_pass');
  end if;
end $$;
insert into public.app_settings (key, value) values ('felplex_stage_config', jsonb_build_object('enabled', true, 'source', 'lab_dummy')) on conflict (key) do nothing;
`,
    "felplex_seed"
  )

  const manifestDir = join(evidenceDir, "valid-manifest")
  const validManifest = createManifest(manifestDir)

  log("url_stage_correct", invokeWrapper({ label: "url_stage", manifestPath: validManifest, validateOnly: true, expectSuccess: true }).ok, "ValidateOnly")
  log("url_production_rejected", invokeWrapper({ label: "url_prod", manifestPath: validManifest, databaseUrl: productionLabUrl(), validateOnly: true }).ok, "rejected")
  log("url_no_ref_rejected", invokeWrapper({ label: "url_no_ref", manifestPath: validManifest, databaseUrl: noRefLabUrl(), validateOnly: true }).ok, "rejected")
  log("refs_equal_rejected", invokeWrapper({ label: "refs_equal", manifestPath: validManifest, productionRef: STAGE_REF, validateOnly: true }).ok, "rejected")
  log("manifest_missing_rejected", invokeWrapper({ label: "manifest_missing", manifestPath: join(evidenceDir, "missing.json"), validateOnly: true }).ok, "rejected")

  const tamperedDir = join(evidenceDir, "tampered-manifest")
  createManifest(tamperedDir)
  appendFileSync(join(tamperedDir, "schema-only.sql"), "\n-- tampered\n", "utf8")
  const tamperedManifest = join(tamperedDir, "manifest-lab.json")
  log("manifest_altered_rejected", invokeWrapper({ label: "manifest_tampered", manifestPath: tamperedManifest, validateOnly: true }).ok, "rejected")

  const otherProjectDir = join(evidenceDir, "other-project-manifest")
  const otherManifest = createManifest(otherProjectDir, { stageRef: WRONG_STAGE_REF })
  log("manifest_other_project_rejected", invokeWrapper({ label: "manifest_other", manifestPath: otherManifest, validateOnly: true }).ok, "rejected")

  const staleDir = join(evidenceDir, "stale-manifest")
  const staleCreatedAt = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const staleManifest = createManifest(staleDir, { createdAt: staleCreatedAt })
  log("snapshot_too_old_rejected", invokeWrapper({ label: "snapshot_stale", manifestPath: staleManifest, validateOnly: true, maxSnapshotAgeHours: 24 }).ok, "rejected")

  psql("create table public.finance_journal_entries (id uuid primary key);", "partial_journal")
  const extraBlocker = invokeWrapper({
    label: "preflight_extra_blocker",
    manifestPath: validManifest,
    expectSuccess: false
  })
  log("preflight_extra_blocker_rejected", extraBlocker.ok && extraBlocker.out.includes("Unexpected preflight blockers"), "no_partial_journal")
  psql("drop table if exists public.finance_journal_entries;", "partial_journal_cleanup")

  const bootstrapRun = invokeWrapper({
    label: "bootstrap_success",
    manifestPath: validManifest,
    expectSuccess: true
  })
  log("bootstrap_success_ready", bootstrapRun.ok && bootstrapRun.out.includes("READY"), "READY")

  const felCount = psql("select count(*)::text from public.app_settings where key = 'felplex_stage_config';", "felplex_after")
  log("felplex_preserved", felCount.out.includes("1"), "count=1")

  const idempotentSql = readFileSync(join(root, "supabase/stage-fixtures/finance_accounting_stage_identity_bootstrap.sql"), "utf8")
    .replace(
      "-- alcazar:session_refs",
      `SELECT set_config('alcazar.finance_stage_project_ref', '${STAGE_REF}', true);\nSELECT set_config('alcazar.finance_production_project_ref', '${PRODUCTION_REF}', true);`
    )
  const idem = psql(idempotentSql, "bootstrap_idempotent_sql")
  log("bootstrap_idempotent_sql", idem.out.includes("PASS"), "PASS")

  const secondWrapper = invokeWrapper({
    label: "wrapper_after_ready_rejected",
    manifestPath: validManifest,
    expectSuccess: false
  })
  log("wrapper_rejects_when_already_ready", secondWrapper.ok && secondWrapper.out.includes("Preflight must be NOT_READY"), "NOT_READY required")

  writeFileSync(join(evidenceDir, "results.json"), JSON.stringify(results, null, 2))
} catch (e) {
  log("lab_error", false, e.message)
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
