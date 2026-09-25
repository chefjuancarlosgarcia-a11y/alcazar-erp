/**
 * Local lab for invoke-finance-stage-accounting-migration.ps1 (Docker PG only).
 * Does NOT connect to Stage/Production remotes.
 *
 * Usage: node scripts/run-finance-stage-accounting-migration-wrapper-lab.mjs
 */
import { createHash } from "node:crypto"
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment } from "./finance-lab-guards.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const labDir = join(root, "supabase", "lab")
const wrapperPs1 = join(root, "scripts", "invoke-finance-stage-accounting-migration.ps1")
const evidenceDir = join(root, ".local-backup", "finance-stage-accounting-migration-wrapper-lab")
const container = `finance-stage-migration-${Date.now()}`
const hostPort = 55620 + Math.floor(Math.random() * 20)

export const STAGE_REF = "tgrqarxfmpwgrkntvgma"
export const PRODUCTION_REF = "lwpfrdnsiwtmyonwcduh"

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

function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function stageLabUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function productionLabUrl() {
  return `postgresql://postgres.${PRODUCTION_REF}:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function transactionPoolerUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
}

function operatorConfirmation(phase) {
  return `APPLY ${phase} TO ${STAGE_REF}`
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

function createPostBootstrapManifest(dir) {
  mkdirSync(dir, { recursive: true })
  const schemaFile = join(dir, "schema-only-lab.sql")
  const tablesFile = join(dir, "finance-target-tables-lab.sql")
  const baselineFile = join(dir, "baseline-counts-lab.txt")
  writeFileSync(schemaFile, "-- lab schema\n", "utf8")
  writeFileSync(tablesFile, "-- lab tables\n", "utf8")
  writeFileSync(baselineFile, "deployment_environment_present=true\n", "utf8")
  const manifest = {
    manifest_version: 1,
    dry_run: false,
    uninitialized_stage: false,
    stage_project_ref: STAGE_REF,
    production_project_ref: PRODUCTION_REF,
    timestamp: "lab",
    created_at: new Date().toISOString(),
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

function invokeWrapper({
  label,
  phase,
  manifestPath,
  databaseUrl = stageLabUrl(),
  stageRef = STAGE_REF,
  productionRef = PRODUCTION_REF,
  confirmation = operatorConfirmation(phase),
  maxSnapshotAgeHours = 24,
  validateOnly = false,
  expectSuccess = false,
  envExtra = {}
}) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    wrapperPs1,
    "-Phase",
    String(phase),
    "-SnapshotManifestPath",
    manifestPath,
    "-MaxSnapshotAgeHours",
    String(maxSnapshotAgeHours),
    "-OperatorConfirmation",
    confirmation
  ]
  if (validateOnly) args.push("-ValidateOnly")

  const r = spawnSync("powershell", args, {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      ...envExtra,
      ALCAZAR_FINANCE_MIGRATION_LAB_SKIP_GIT_CHECK: "1",
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

function tableExists(tableName) {
  const { out } = psql(
    `select coalesce(to_regclass('${tableName}')::text, 'missing');`,
    `exists_${tableName.replace(/\W/g, "_")}`,
    { allowFailure: true }
  )
  return !/missing/.test(out)
}

function seedLabIdentityAndFelplex() {
  psql(
    `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres.${STAGE_REF}') then
    execute format('create role %I login password %L superuser', 'postgres.${STAGE_REF}', 'lab_pass');
  end if;
end $$;

insert into public.app_settings (key, value) values
  ('deployment_environment', jsonb_build_object('name','stage','project_ref','${STAGE_REF}','finance_accounting_identity_bootstrap',true)),
  ('felplex_stage_config', jsonb_build_object('enabled', true, 'source', 'lab_dummy'))
on conflict (key) do update set value = excluded.value;
`,
    "seed_identity_felplex"
  )
}

function bootstrapDatabase() {
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=lab_pass -p ${hostPort}:5432 postgres:17-alpine`)
  for (let i = 0; i < 30; i++) {
    if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" }).status === 0) break
    execSync("powershell -Command Start-Sleep -Seconds 1")
  }
  psqlFile(join(labDir, "bootstrap-supabase-local.sql"), "bootstrap")
  psqlFile(join(labDir, "finance_accounting_supabase_contaminated_default_privileges.sql"), "contaminated_default_acl")
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
  seedLabIdentityAndFelplex()
}

try {
  assertLocalLabEnvironment()
  assertDockerAvailable()
  bootstrapDatabase()

  const manifestDir = join(evidenceDir, "valid-manifest")
  const validManifest = createPostBootstrapManifest(manifestDir)

  log(
    "validate_only_ok",
    invokeWrapper({ label: "validate_only", phase: "202", manifestPath: validManifest, validateOnly: true, expectSuccess: true }).ok,
    "ValidateOnly"
  )
  log(
    "production_url_rejected",
    invokeWrapper({ label: "url_prod", phase: "202", manifestPath: validManifest, databaseUrl: productionLabUrl(), validateOnly: true }).ok,
    "rejected"
  )
  log(
    "transaction_pooler_6543_rejected",
    invokeWrapper({ label: "url_6543", phase: "202", manifestPath: validManifest, databaseUrl: transactionPoolerUrl(), validateOnly: true }).ok,
    "6543 rejected"
  )

  const tamperedDir = join(evidenceDir, "tampered-manifest")
  createPostBootstrapManifest(tamperedDir)
  appendFileSync(join(tamperedDir, "schema-only-lab.sql"), "\n-- tampered\n", "utf8")
  log(
    "manifest_tampered_rejected",
    invokeWrapper({ label: "manifest_tampered", phase: "202", manifestPath: join(tamperedDir, "manifest-lab.json"), validateOnly: true }).ok,
    "rejected"
  )

  const staleDir = join(evidenceDir, "stale-manifest")
  const staleManifestPath = join(staleDir, "manifest-lab.json")
  mkdirSync(staleDir, { recursive: true })
  writeFileSync(
    staleManifestPath,
    JSON.stringify(
      {
        manifest_version: 1,
        dry_run: false,
        uninitialized_stage: false,
        stage_project_ref: STAGE_REF,
        production_project_ref: PRODUCTION_REF,
        timestamp: "stale",
        created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        files: []
      },
      null,
      2
    ),
    "utf8"
  )
  log(
    "manifest_stale_rejected",
    invokeWrapper({ label: "manifest_stale", phase: "202", manifestPath: staleManifestPath, validateOnly: true, maxSnapshotAgeHours: 24 }).ok,
    "rejected"
  )

  log(
    "wrong_order_203_before_202_rejected",
    invokeWrapper({ label: "order_203_first", phase: "203", manifestPath: validManifest, expectSuccess: false }).ok,
    "rejected"
  )

  psql("create table public.finance_journal_entries (id uuid primary key);", "partial_journal")
  log(
    "partial_journal_rejected_for_202",
    invokeWrapper({ label: "partial_journal", phase: "202", manifestPath: validManifest, expectSuccess: false }).ok,
    "rejected"
  )
  psql("drop table if exists public.finance_journal_entries;", "partial_journal_cleanup")

  const injectFail = invokeWrapper({
    label: "phase_202_inject_failure",
    phase: "202",
    manifestPath: validManifest,
    expectSuccess: false,
    envExtra: { ALCAZAR_FINANCE_MIGRATION_LAB_INJECT_FAILURE: "1" }
  })
  log(
    "phase_202_inject_failure_rollback",
    injectFail.ok && !tableExists("public.finance_chart_accounts"),
    "0 objects"
  )

  const injectBreak = invokeWrapper({
    label: "phase_202_inject_break_postcheck",
    phase: "202",
    manifestPath: validManifest,
    expectSuccess: false,
    envExtra: { ALCAZAR_FINANCE_MIGRATION_LAB_INJECT_BREAK: "postcheck" }
  })
  log(
    "phase_202_postcheck_tx_rollback",
    injectBreak.ok && !tableExists("public.finance_chart_accounts"),
    "0 objects"
  )

  const apply202 = invokeWrapper({ label: "phase_202_apply", phase: "202", manifestPath: validManifest, expectSuccess: true })
  log("phase_202_apply_pass", apply202.ok && tableExists("public.finance_chart_accounts"), "chart present")

  log(
    "phase_202_second_apply_rejected",
    invokeWrapper({ label: "phase_202_repeat", phase: "202", manifestPath: validManifest, expectSuccess: false }).ok,
    "rejected"
  )

  const apply203 = invokeWrapper({ label: "phase_203_apply", phase: "203", manifestPath: validManifest, expectSuccess: true })
  log("phase_203_after_202_pass", apply203.ok && tableExists("public.branches"), "branches present")

  const apply204 = invokeWrapper({ label: "phase_204_apply", phase: "204", manifestPath: validManifest, expectSuccess: true })
  log("phase_204_after_203_pass", apply204.ok && tableExists("public.finance_journal_entries"), "journal present")

  const felCount = psql("select count(*)::text from public.app_settings where key = 'felplex_stage_config';", "felplex_after")
  log("felplex_preserved", felCount.out.includes("1"), "count=1")

  writeFileSync(join(evidenceDir, "results.json"), JSON.stringify(results, null, 2))
} catch (e) {
  log("lab_error", false, e.message)
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
