/**
 * Local validation of Stage application package (Docker PG only).
 * Does NOT connect to Stage/Production.
 *
 * Usage: node scripts/run-finance-stage-package-local-validation.mjs
 */

import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment, LOCAL_LAB_PROJECT_REF } from "./finance-lab-guards.mjs"
import { assertReadOnlyFixtureSql, validateFinanceStageFixtures } from "./finance-stage-fixture-guard.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const labDir = join(root, "supabase", "lab")
const fixturesDir = join(root, "supabase", "stage-fixtures")
const rollbackDir = join(root, "supabase", "rollback")
const evidenceDir = join(root, ".local-backup", "finance-stage-package-validation")
const container = `finance-stage-pkg-${Date.now()}`
const port = 55460 + Math.floor(Math.random() * 30)

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
  if (!allowFailure && r.status !== 0) throw new Error(`${label} failed: ${out.slice(-2000)}`)
  return { out, status: r.status ?? 1 }
}

function psqlFile(filePath, label, opts = {}) {
  return psql(readFileSync(filePath, "utf8"), label, opts)
}

function stageSessionProjectRef(ref = LOCAL_LAB_PROJECT_REF, { local = true } = {}) {
  return `SELECT set_config('alcazar.finance_stage_project_ref', '${ref}', ${local});`
}

function psqlReadOnly(sql, label, { expectNonZero = false, sessionSql = stageSessionProjectRef() } = {}) {
  const wrapped = [
    "SET default_transaction_read_only = on;",
    "SELECT current_setting('default_transaction_read_only') AS default_transaction_read_only;",
    "BEGIN READ ONLY;",
    "SELECT current_setting('transaction_read_only') AS transaction_read_only;",
    sessionSql,
    sql,
    "ROLLBACK;"
  ].join("\n")
  const { out, status } = psql(wrapped, label, { allowFailure: true })
  const readOnlyOk =
    /default_transaction_read_only[\s\S]*?\bon\b/m.test(out) &&
    /transaction_read_only[\s\S]*?\bon\b/m.test(out)
  if (!readOnlyOk) {
    throw new Error(`${label} missing read-only evidence in output`)
  }
  if (expectNonZero) {
    if (status === 0) throw new Error(`${label} expected non-zero exit under fail-closed`)
  } else if (status !== 0) {
    throw new Error(`${label} failed under READ ONLY: ${out.slice(-2000)}`)
  }
  return out
}

function psqlReadOnlyFile(filePath, label, opts = {}) {
  return psqlReadOnly(readFileSync(filePath, "utf8"), label, opts)
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

function assertContains(out, token, step) {
  log(step, out.includes(token), token)
}

function seedStagePreflightLabEnv() {
  return `
insert into public.app_settings (key, value) values (
  'deployment_environment',
  jsonb_build_object('name', 'stage', 'project_ref', '${LOCAL_LAB_PROJECT_REF}')
)
on conflict (key) do update set value = excluded.value;
`
}

try {
  validateFinanceStageFixtures(root)
  log("fixture_structural_guard", true, "no DDL/DML in preflight/postchecks")
  try {
    assertReadOnlyFixtureSql("negative-test", "drop table if exists pg_temp.foo;")
    log("fixture_guard_rejects_ddl", false, "guard did not reject DROP")
  } catch {
    log("fixture_guard_rejects_ddl", true, "DROP rejected")
  }
  try {
    assertReadOnlyFixtureSql("negative-insert-with", "with x as (insert into foo values (1)) select 1;")
    log("fixture_guard_rejects_insert_with", false, "guard did not reject INSERT in WITH")
  } catch {
    log("fixture_guard_rejects_insert_with", true, "INSERT in WITH rejected")
  }
  try {
    assertReadOnlyFixtureSql(
      "negative-volatile-call",
      "select public.create_finance_journal_draft('{}'::jsonb);"
    )
    log("fixture_guard_rejects_volatile_call", false, "guard did not reject volatile RPC call")
  } catch {
    log("fixture_guard_rejects_volatile_call", true, "volatile RPC call rejected")
  }

  assertLocalLabEnvironment()
  assertDockerAvailable()
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=lab_pass -p ${port}:5432 postgres:16-alpine`)
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

  psql(seedStagePreflightLabEnv(), "lab_env")

  const preflightPath = join(fixturesDir, "finance_accounting_stage_preflight.sql")
  assertContains(
    psqlReadOnlyFile(preflightPath, "preflight_before_readonly"),
    "READY",
    "preflight_before_apply_readonly"
  )

  psql("SELECT set_config('alcazar.finance_stage_project_ref', 'wrong-project-ref', true);", "wrong_project_ref")
  const wrongIdentity = psqlReadOnlyFile(preflightPath, "preflight_wrong_identity", {
    expectNonZero: true,
    sessionSql: stageSessionProjectRef("wrong-project-ref")
  })
  assertContains(wrongIdentity, "NOT_READY", "preflight_wrong_identity_not_ready")
  psql(seedStagePreflightLabEnv(), "lab_env_restore")

  psql("create table public.finance_journal_entries (id uuid primary key);", "partial_journal_setup")
  const partial = psqlReadOnlyFile(preflightPath, "preflight_partial_journal", { expectNonZero: true })
  assertContains(partial, "NOT_READY", "preflight_partial_journal_not_ready")
  psql("drop table if exists public.finance_journal_entries;", "partial_journal_cleanup")

  const dry = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/stage-finance-accounting-snapshot.ps1"), "-DryRun"],
    { encoding: "utf8", cwd: root, env: { ...process.env, ALCAZAR_STAGE_DATABASE_URL: "" } }
  )
  log("snapshot_dry_run", dry.status === 0, dry.stderr?.slice(0, 200) || dry.stdout?.slice(0, 120) || "ok")

  psqlFile(join(schemaDir, "202_finance_accounting_chart_of_accounts.sql"), "apply_202")
  assertContains(
    psqlReadOnlyFile(join(fixturesDir, "finance_accounting_postcheck_202.sql"), "postcheck_202_readonly"),
    "PASS",
    "postcheck_202_readonly"
  )

  psqlFile(join(schemaDir, "203_finance_accounting_multibranch_foundation.sql"), "apply_203")
  assertContains(
    psqlReadOnlyFile(join(fixturesDir, "finance_accounting_postcheck_203.sql"), "postcheck_203_readonly"),
    "PASS",
    "postcheck_203_readonly"
  )

  psqlFile(join(schemaDir, "204_finance_accounting_journal_engine.sql"), "apply_204")
  assertContains(
    psqlReadOnlyFile(join(fixturesDir, "finance_accounting_postcheck_204.sql"), "postcheck_204_readonly"),
    "PASS",
    "postcheck_204_readonly"
  )

  assertContains(
    psql(
      seedStagePreflightLabEnv() +
        stageSessionProjectRef(LOCAL_LAB_PROJECT_REF, { local: false }) +
        readFileSync(join(fixturesDir, "finance_accounting_stage_smoke.sql"), "utf8"),
      "stage_smoke"
    ).out,
    "PASS",
    "stage_smoke"
  )

  psql(
    seedStagePreflightLabEnv() +
      stageSessionProjectRef(LOCAL_LAB_PROJECT_REF, { local: false }) +
      readFileSync(join(rollbackDir, "204_finance_accounting_journal_engine.rollback.sql"), "utf8"),
    "rollback_204"
  )
  psql(
    seedStagePreflightLabEnv() +
      stageSessionProjectRef(LOCAL_LAB_PROJECT_REF, { local: false }) +
      readFileSync(join(rollbackDir, "203_finance_accounting_multibranch_foundation.rollback.sql"), "utf8"),
    "rollback_203"
  )
  psqlFile(join(schemaDir, "202_finance_accounting_chart_of_accounts.sql"), "rollback_203_restore_202")
  psql(
    seedStagePreflightLabEnv() +
      stageSessionProjectRef(LOCAL_LAB_PROJECT_REF, { local: false }) +
      readFileSync(join(rollbackDir, "202_finance_accounting_chart_of_accounts.rollback.sql"), "utf8"),
    "rollback_202"
  )

  assertContains(
    psqlReadOnlyFile(preflightPath, "preflight_after_rollback_readonly"),
    "READY",
    "preflight_after_rollback_readonly"
  )

  writeFileSync(join(evidenceDir, "results.json"), JSON.stringify(results, null, 2))
} catch (e) {
  log("validation_error", false, e.message)
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
