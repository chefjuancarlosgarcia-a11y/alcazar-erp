/**
 * Full ERP schema lab: bootstrap + migrations 001-200 + finance 202-204 + SQL test suites.
 * Disposable Docker PostgreSQL only. Does NOT connect to Stage/Production.
 *
 * Usage:
 *   node scripts/run-finance-full-schema-lab.mjs
 *   node scripts/run-finance-full-schema-lab.mjs --skip-tests
 *   node scripts/run-finance-full-schema-lab.mjs --migrations-only
 */

import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment } from "./finance-lab-guards.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const labDir = join(root, "supabase", "lab")
const evidenceDir = join(root, ".local-backup", "finance-full-schema-lab")
const container = `finance-fullschema-${Date.now()}`
const port = 55450 + Math.floor(Math.random() * 40)
const pgPass = "lab_pass_local_only"
const skipTests = process.argv.includes("--skip-tests")
const migrationsOnly = process.argv.includes("--migrations-only")

mkdirSync(evidenceDir, { recursive: true })

function log(msg) {
  console.log(msg)
  writeFileSync(join(evidenceDir, "run.log"), msg + "\n", { flag: "a" })
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim()
}

function psql(sql) {
  return run(`docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, { input: sql })
}

function psqlFile(filePath, label) {
  const sql = readFileSync(filePath, "utf8")
  const r = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  )
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  if (r.status !== 0) {
    log(`FAIL ${label}\n${out.slice(-4000)}`)
    throw new Error(`Failed ${label}`)
  }
  log(`OK ${label}`)
  return out
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

function parseTestOutput(output) {
  const rows = []
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("|").map((s) => s.trim())
    if (parts.length >= 3 && (parts[1] === "t" || parts[1] === "f") && parts[0] && parts[0] !== "scenario") {
      rows.push({ scenario: parts[0], passed: parts[1] === "t", detail: parts[2] || "" })
    }
  }
  return rows
}

function runTestSuite(label, fileName) {
  psqlFile(join(labDir, "finance_accounting_test_auth_seed.sql"), `${label}_auth_seed`)
  const out = psqlFile(join(schemaDir, fileName), label)
  const parsed = parseTestOutput(out)
  const failed = parsed.filter((r) => !r.passed)
  log(`${label}: ${parsed.length - failed.length}/${parsed.length} passed`)
  if (failed.length) {
    for (const f of failed) log(`  FAIL ${f.scenario}: ${f.detail}`)
    throw new Error(`${label} failed (${failed.length})`)
  }
  return parsed.length
}

let exitCode = 0
const summary = { migrations: [], tests: {} }

try {
  assertLocalLabEnvironment()
  assertDockerAvailable()
  log("Starting disposable PostgreSQL 16...")
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=${pgPass} -p ${port}:5432 postgres:16-alpine`)
  for (let i = 0; i < 30; i++) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" })
    if (ready.status === 0) break
    execSync("powershell -Command Start-Sleep -Seconds 1")
  }

  psqlFile(join(labDir, "bootstrap-supabase-local.sql"), "bootstrap")
  for (const file of listBaselineMigrations()) {
    psqlFile(join(schemaDir, file), file)
    summary.migrations.push(file)
  }
  for (const file of [
    "197_fix_operational_pin_module_station_type.sql",
    "198_operational_station_pos_shared_foundation.sql",
    "199_fix_operational_station_pos_catalog_parity.sql",
    "200_fix_station_pos_audit_actor.sql"
  ]) {
    psqlFile(join(schemaDir, file), file)
    summary.migrations.push(file)
  }

  log(`Baseline ERP through 200: ${summary.migrations.length} files`)

  for (const file of [
    "202_finance_accounting_chart_of_accounts.sql",
    "203_finance_accounting_multibranch_foundation.sql",
    "204_finance_accounting_journal_engine.sql"
  ]) {
    psqlFile(join(schemaDir, file), file)
    summary.migrations.push(file)
  }

  if (!migrationsOnly && !skipTests) {
    summary.tests["202_test"] = runTestSuite("202_test", "202_test_finance_chart_accounts.sql")
    summary.tests["203_test"] = runTestSuite("203_test", "203_test_finance_accounting_multibranch_foundation.sql")
    summary.tests["204_test"] = runTestSuite("204_test", "204_test_finance_accounting_journal_engine.sql")
  }

  writeFileSync(join(evidenceDir, "summary.json"), JSON.stringify(summary, null, 2))
  log("Finance full-schema lab complete")
} catch (e) {
  log(`ERROR: ${e.message}`)
  exitCode = 1
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
