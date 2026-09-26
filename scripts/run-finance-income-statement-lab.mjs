/**
 * Disposable local lab for Estado de Resultados migration 217.
 * Applies the finance schema through 216, then 217.
 * Does not connect to Stage or Production and does not pull images.
 *
 * Usage: node scripts/run-finance-income-statement-lab.mjs
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
const migration = join(schemaDir, "217_finance_income_statement.sql")
const migrationTest = join(schemaDir, "217_test_finance_income_statement.sql")
const rollback = join(rollbackDir, "217_finance_income_statement.rollback.sql")
const container = `finance-income-217-${Date.now()}`
const port = 55640 + Math.floor(Math.random() * 20)
const pgPass = "lab_pass_local_only"
const requiredScenarios = [
  "01_compiles",
  "02_signature",
  "03_security",
  "04_acl",
  "05_column",
  "06_rejects_without_permission",
  "06b_operational_role",
  "07_create_without_section",
  "08_create_spanish_label",
  "09_update_section",
  "10_invalid_combination",
  "11_header_rejects_section",
  "12_balance_rejects_section",
  "13_import_warning_without_section",
  "14_import_rejects_unknown",
  "14b_import_stores_label",
  "15_tax_absent_is_complete",
  "16_formulas",
  "17_contrary_income",
  "17b_contrary_balance",
  "18_zero_hidden",
  "19_zero_included",
  "20_inactive_history",
  "21_reversal",
  "22_snapshot_excludes",
  "23_posted_only",
  "24_empty_intersection",
  "25_date_order",
  "26_dimension_scope",
  "27_incomplete",
  "28_limit",
  "29_reports_remain"
]
const rollbackVerifyPrefix = "0|1|1|1|0|"

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
    console.error(`FAIL ${label}\n${out.slice(-12000)}`)
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
    throw new Error(`${label} failed: ${[...failed.map((row) => `${row.scenario}:${row.detail}`), ...missing.map((name) => `${name} missing`)].join(", ")}`)
  }
  console.log(`${label} ${rows.filter((row) => row.passed).length}/${requiredScenarios.length}`)
}

function reportAclSql() {
  return `
    select (
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_income_statement')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_general_journal')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_general_ledger')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_trial_balance')::text
      || '|' ||
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'finance_chart_accounts' and column_name = 'income_statement_section')::text
      || '|' ||
      has_function_privilege('authenticated', 'public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('anon', 'public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('service_role', 'public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('authenticated', 'public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('anon', 'public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('service_role', 'public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('authenticated', 'public.get_finance_trial_balance(date,date,uuid,uuid,uuid,text,boolean,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('anon', 'public.get_finance_trial_balance(date,date,uuid,uuid,uuid,text,boolean,integer,integer,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('service_role', 'public.get_finance_trial_balance(date,date,uuid,uuid,uuid,text,boolean,integer,integer,timestamptz)', 'EXECUTE')::text
    );
  `
}

function readVerifyLine(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => /^\d+\|\d+\|\d+\|/.test(line)) || ""
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
    "215_finance_general_ledger.sql",
    "216_finance_trial_balance.sql"
  ]) {
    psqlFile(join(schemaDir, file), file)
  }

  const beforeLine = readVerifyLine(psqlSql(reportAclSql(), "acl_before_217", ["-At"]))
  console.log(`before 217 ${beforeLine}`)
  if (!beforeLine.startsWith(rollbackVerifyPrefix)) {
    throw new Error(`Baseline ACL unexpected: ${beforeLine}`)
  }

  psqlFile(migration, "apply_217")
  assertScenarios(psqlFile(migrationTest, "test_217_first", ["-At", "-F", "|"]), "first")

  psqlFile(rollback, "rollback_217")
  psqlFile(rollback, "rollback_217_again")
  const verifyLine = readVerifyLine(psqlSql(reportAclSql(), "verify_after_rollback", ["-At"]))
  console.log(`after rollback ${verifyLine}`)
  if (verifyLine !== beforeLine) {
    throw new Error(`Rollback verification failed: ${verifyLine} expected ${beforeLine}`)
  }

  psqlFile(migration, "reapply_217")
  assertScenarios(psqlFile(migrationTest, "test_217_second", ["-At", "-F", "|"]), "second")
  console.log("217 apply, test, rollback, reapply, retest complete")
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
