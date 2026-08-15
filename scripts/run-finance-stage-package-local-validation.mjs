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

function log(step, ok, detail = "") {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}\t${step}${detail ? `\t${detail}` : ""}`)
  if (!ok) exitCode = 1
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim()
}

function psql(sql, label = "inline") {
  const r = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  )
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  if (r.status !== 0) throw new Error(`${label} failed: ${out.slice(-2000)}`)
  return out
}

function psqlFile(filePath, label) {
  return psql(readFileSync(filePath, "utf8"), label)
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

let exitCode = 0

function seedStagePreflightLabEnv() {
  return `
insert into public.app_settings (key, value) values (
  'deployment_environment',
  jsonb_build_object('name', 'stage', 'project_ref', '${LOCAL_LAB_PROJECT_REF}')
)
on conflict (key) do update set value = excluded.value;
select set_config('alcazar.finance_stage_project_ref', '${LOCAL_LAB_PROJECT_REF}', false);
`
}

try {
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

  assertContains(
    psql(readFileSync(join(fixturesDir, "finance_accounting_stage_preflight.sql"), "utf8"), "preflight_before"),
    "READY",
    "preflight_before_apply"
  )

  const dry = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/stage-finance-accounting-snapshot.ps1"), "-DryRun"],
    { encoding: "utf8", cwd: root, env: { ...process.env, ALCAZAR_STAGE_DATABASE_URL: "" } }
  )
  log("snapshot_dry_run", dry.status === 0, dry.stderr?.slice(0, 200) || dry.stdout?.slice(0, 200) || "ok")

  psqlFile(join(schemaDir, "202_finance_accounting_chart_of_accounts.sql"), "apply_202")
  assertContains(psqlFile(join(fixturesDir, "finance_accounting_postcheck_202.sql"), "postcheck_202"), "PASS", "postcheck_202")

  psqlFile(join(schemaDir, "203_finance_accounting_multibranch_foundation.sql"), "apply_203")
  assertContains(psqlFile(join(fixturesDir, "finance_accounting_postcheck_203.sql"), "postcheck_203"), "PASS", "postcheck_203")

  psqlFile(join(schemaDir, "204_finance_accounting_journal_engine.sql"), "apply_204")
  assertContains(psqlFile(join(fixturesDir, "finance_accounting_postcheck_204.sql"), "postcheck_204"), "PASS", "postcheck_204")

  assertContains(
    psql(seedStagePreflightLabEnv() + readFileSync(join(fixturesDir, "finance_accounting_stage_smoke.sql"), "utf8"), "stage_smoke"),
    "PASS",
    "stage_smoke"
  )

  psql(seedStagePreflightLabEnv() + readFileSync(join(rollbackDir, "204_finance_accounting_journal_engine.rollback.sql"), "utf8"), "rollback_204")

  psql(seedStagePreflightLabEnv() + readFileSync(join(rollbackDir, "203_finance_accounting_multibranch_foundation.rollback.sql"), "utf8"), "rollback_203")

  psqlFile(join(schemaDir, "202_finance_accounting_chart_of_accounts.sql"), "rollback_203_restore_202")

  psql(seedStagePreflightLabEnv() + readFileSync(join(rollbackDir, "202_finance_accounting_chart_of_accounts.rollback.sql"), "utf8"), "rollback_202")

  assertContains(
    psql(seedStagePreflightLabEnv() + readFileSync(join(fixturesDir, "finance_accounting_stage_preflight.sql"), "utf8"), "preflight_after_rollback"),
    "READY",
    "preflight_after_rollback"
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
