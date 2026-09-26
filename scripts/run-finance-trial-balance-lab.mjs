/**
 * Disposable local lab for Balanza de Comprobación migration 216.
 * Applies the finance schema through 215, then 216.
 * Does not connect to Stage or Production and does not pull images.
 *
 * Usage: node scripts/run-finance-trial-balance-lab.mjs
 */
import { execSync, spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment } from "./finance-lab-guards.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const rollbackDir = join(root, "supabase", "rollback")
const labDir = join(root, "supabase", "lab")
const migration = join(schemaDir, "216_finance_trial_balance.sql")
const migrationTest = join(schemaDir, "216_test_finance_trial_balance.sql")
const rollback = join(rollbackDir, "216_finance_trial_balance.rollback.sql")
const container = `finance-trial-216-${Date.now()}`
const port = 55520 + Math.floor(Math.random() * 20)
const pgPass = "lab_pass_local_only"
const requiredScenarios = [
  "01_compiles",
  "02_signature",
  "03_security",
  "04_no_public_anon",
  "05_authenticated_execute",
  "05b_no_service_role",
  "06_rejects_without_permission",
  "06b_operational_role",
  "07_posted_only",
  "08_snapshot_excludes_later_post",
  "08b_snapshot_includes_exact_post",
  "09_debit_nature",
  "10_credit_nature",
  "11_contrary_balance",
  "12_inactive_detail",
  "13_header_excluded",
  "14_opening_before_effective_start",
  "15_period_date_intersection",
  "16_empty_intersection",
  "16b_date_order",
  "17_dimensions_can_unbalance",
  "18_search_keeps_control_totals",
  "19_pagination",
  "21_reversal_separate",
  "22_json_contract",
  "23_page_out_of_range",
  "23b_invalid_page",
  "23c_invalid_page_size",
  "24_zero_hidden",
  "25_zero_included",
  "26_global_square",
  "29_journal_and_ledger_remain"
]

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim()
}

function psqlFile(filePath, label, extraArgs = []) {
  const sql = readFileSync(filePath, "utf8")
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extraArgs, "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  )
  const out = `${result.stdout || ""}${result.stderr || ""}`
  if (result.status !== 0) {
    console.error(`FAIL ${label}\n${out.slice(-8000)}`)
    throw new Error(`Failed ${label}`)
  }
  console.log(`OK ${label}`)
  return out
}

function psqlSql(sql, label, extraArgs = []) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extraArgs, "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  )
  const out = `${result.stdout || ""}${result.stderr || ""}`
  if (result.status !== 0) {
    console.error(`FAIL ${label}\n${out.slice(-8000)}`)
    throw new Error(`Failed ${label}`)
  }
  console.log(`OK ${label}`)
  return out
}

function listBaselineMigrations() {
  return readdirSync(schemaDir)
    .filter((file) => /^(\d{3})_/.test(file) && file.endsWith(".sql"))
    .filter((file) => {
      const n = parseInt(file.slice(0, 3), 10)
      if (n > 196) return false
      if (/^(\d{3})_test_/.test(file)) return false
      if (file.startsWith("diagnose_")) return false
      if (file.includes("concurrency")) return false
      if (file.includes("_perf_explain")) return false
      return true
    })
    .sort((a, b) => parseInt(a.slice(0, 3), 10) - parseInt(b.slice(0, 3), 10))
}

function parseScenarios(testOut) {
  return testOut.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|")
    return { scenario: parts[0], passed: parts[1] === "t", detail: parts.slice(2).join("|") }
  }).filter((row) => requiredScenarios.includes(row.scenario) || row.scenario === "unhandled")
}

function assertScenarios(testOut, label) {
  const rows = parseScenarios(testOut)
  for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${label} ${row.scenario} ${row.detail}`)
  const missing = requiredScenarios.filter((name) => !rows.some((row) => row.scenario === name && row.passed))
  const failed = rows.filter((row) => !row.passed)
  if (missing.length || failed.length) {
    throw new Error(`${label} failed: ${[...failed.map((row) => row.scenario), ...missing.map((name) => `${name} missing`)].join(", ")}`)
  }
  console.log(`${label} ${rows.filter((row) => row.passed).length}/${requiredScenarios.length}`)
}

let exitCode = 0
try {
  assertLocalLabEnvironment()
  assertDockerAvailable()
  const image = spawnSync("docker", ["image", "inspect", "postgres:16-alpine"], { encoding: "utf8" })
  if (image.status !== 0) {
    throw new Error("postgres:16-alpine is not present locally. Refusing to download it.")
  }

  console.log("Starting disposable PostgreSQL 16...")
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=${pgPass} -p ${port}:5432 postgres:16-alpine`)
  let ready = false
  for (let i = 0; i < 40; i += 1) {
    const probe = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" })
    if (probe.status === 0) {
      ready = true
      break
    }
    execSync("powershell -Command Start-Sleep -Seconds 1")
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready")

  psqlFile(join(labDir, "bootstrap-supabase-local.sql"), "bootstrap")
  for (const file of listBaselineMigrations()) psqlFile(join(schemaDir, file), file)
  for (const file of [
    "197_fix_operational_pin_module_station_type.sql",
    "198_operational_station_pos_shared_foundation.sql",
    "199_fix_operational_station_pos_catalog_parity.sql",
    "200_fix_station_pos_audit_actor.sql",
    "202_finance_accounting_chart_of_accounts.sql",
    "203_finance_accounting_multibranch_foundation.sql",
    "204_finance_accounting_journal_engine.sql",
    "208_finance_general_journal.sql",
    "209_finance_general_journal_helper_acl.sql",
    "215_finance_general_ledger.sql"
  ]) {
    psqlFile(join(schemaDir, file), file)
  }

  psqlFile(migration, "apply_216")
  assertScenarios(psqlFile(migrationTest, "test_216_first", ["-At", "-F", "|"]), "first")

  psqlFile(rollback, "rollback_216")
  psqlFile(rollback, "rollback_216_again")
  const afterRollback = psqlSql(`
    select (
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_trial_balance')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_general_journal')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_general_ledger')::text
      || '|' ||
      has_function_privilege('authenticated', 'public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('anon', 'public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('public', 'public.finance_general_journal_row_to_json(uuid,uuid,date,text,text,text,smallint,uuid,text,text,text,text,uuid,text,text,uuid,text,text,numeric,numeric,boolean,uuid,text,uuid)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('authenticated', 'public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('anon', 'public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
    );
  `, "verify_after_rollback", ["-At"])
  const verifyLine = afterRollback.split(/\r?\n/).map((line) => line.trim()).find((line) => /^\d+\|\d+\|\d+\|/.test(line))
  console.log(`after rollback ${verifyLine}`)
  if (verifyLine !== "0|1|1|true|false|false|true|false") {
    throw new Error(`Rollback verification failed: ${verifyLine || afterRollback}`)
  }

  psqlFile(migration, "reapply_216")
  assertScenarios(psqlFile(migrationTest, "test_216_second", ["-At", "-F", "|"]), "second")
  console.log("216 apply, test, rollback, reapply, retest complete")
} catch (error) {
  console.error(error.message)
  exitCode = 1
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {
    // The container may already have been removed.
  }
}

process.exit(exitCode)
