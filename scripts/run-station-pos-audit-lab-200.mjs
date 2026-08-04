/**
 * Apply 200 + run remote-safe structural test + lab runtime on embedded local Postgres.
 */
import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")
const PG_LAB = path.join(REPO_ROOT, ".local-backup", "pg-lab")
const embeddedPath = path.join(PG_LAB, "node_modules", "embedded-postgres", "dist", "index.js")
const { default: EmbeddedPostgres } = await import(pathToFileURL(embeddedPath).href)
const SCHEMA_DIR = path.join(REPO_ROOT, "supabase", "schema")
const EVIDENCE = path.join(PG_LAB, "evidence", "audit-200")
const DATA_DIR = path.join(PG_LAB, "data-audit-200")
const PORT = 54331
const LAB_DB = "alcazar_audit_200"
const LAB_USER = "postgres"
const LAB_PASSWORD = "postgres-lab-local-only"
const PSQL = process.env.PSQL_PATH || "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe"

fs.mkdirSync(EVIDENCE, { recursive: true })

function runPsqlFile(database, filePath, label) {
  const outLog = path.join(EVIDENCE, `${label}.log`)
  const r = spawnSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", String(PORT), "-U", LAB_USER, "-d", database, "-v", "ON_ERROR_STOP=1", "-o", outLog, "-f", filePath],
    { env: { ...process.env, PGPASSWORD: LAB_PASSWORD }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
  const combined = (fs.existsSync(outLog) ? fs.readFileSync(outLog, "utf8") : "") + (r.stderr || "")
  fs.writeFileSync(path.join(EVIDENCE, `${label}.json`), JSON.stringify({ ok: r.status === 0, label, tail: combined.slice(-8000) }, null, 2))
  console.log(r.status === 0 ? `OK ${label}` : `FAIL ${label}`)
  if (r.status !== 0) console.error(combined.slice(-2000))
  return r.status === 0
}

function parseSummary(logPath, expectedTotal = null) {
  const log = fs.readFileSync(logPath, "utf8")
  const failedRows = [...log.matchAll(/\|\s*f\s*\|/g)].length
  const summaryMatch = log.match(/(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\r?\n\s*\(\d+ filas?\)/)
  const total = summaryMatch ? Number(summaryMatch[1]) : null
  const passedTotal = summaryMatch ? Number(summaryMatch[2]) : null
  const failedTotal = summaryMatch ? Number(summaryMatch[3]) : failedRows
  if (expectedTotal != null && total !== expectedTotal) {
    console.error(`Expected ${expectedTotal} scenarios, got ${total ?? "?"}`)
    return { ok: false, total, passedTotal, failedTotal }
  }
  return { ok: failedTotal === 0, total, passedTotal, failedTotal }
}

function listBaselineMigrations() {
  return fs
    .readdirSync(SCHEMA_DIR)
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

async function main() {
  if (!fs.existsSync(PSQL)) {
    console.error(`psql not found at ${PSQL}`)
    process.exit(1)
  }
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true })

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: LAB_USER,
    password: LAB_PASSWORD,
    port: PORT,
    persistent: false
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase(LAB_DB)

  const boot = path.join(PG_LAB, "bootstrap-supabase-local.sql")
  if (!runPsqlFile(LAB_DB, boot, "bootstrap")) {
    await pg.stop()
    process.exit(1)
  }

  for (const file of listBaselineMigrations()) {
    if (!runPsqlFile(LAB_DB, path.join(SCHEMA_DIR, file), file)) {
      await pg.stop()
      process.exit(1)
    }
  }

  for (const file of [
    "197_fix_operational_pin_module_station_type.sql",
    "198_operational_station_pos_shared_foundation.sql",
    "199_fix_operational_station_pos_catalog_parity.sql",
    "200_fix_station_pos_audit_actor.sql"
  ]) {
    if (!runPsqlFile(LAB_DB, path.join(SCHEMA_DIR, file), file)) {
      await pg.stop()
      process.exit(1)
    }
  }

  const structuralOk = runPsqlFile(LAB_DB, path.join(SCHEMA_DIR, "200_test_station_pos_audit_actor.sql"), "200_test")
  const structuralSummary = parseSummary(path.join(EVIDENCE, "200_test.log"))
  if (!structuralOk || !structuralSummary.ok) {
    console.error(
      `FAIL 200_test structural: ${structuralSummary.passedTotal ?? "?"}/${structuralSummary.total ?? "?"} passed (${structuralSummary.failedTotal ?? "?"} failed)`
    )
    await pg.stop()
    process.exit(1)
  }
  console.log(`OK 200_test structural ${structuralSummary.passedTotal}/${structuralSummary.total}`)

  const labOk = runPsqlFile(LAB_DB, path.join(SCHEMA_DIR, "200_lab_station_pos_audit_actor_runtime.sql"), "200_lab")
  const labSummary = parseSummary(path.join(EVIDENCE, "200_lab.log"))
  if (!labOk || !labSummary.ok || labSummary.total !== 15) {
    console.error(
      `FAIL 200_lab runtime: ${labSummary.passedTotal ?? "?"}/${labSummary.total ?? "?"} passed (${labSummary.failedTotal ?? "?"} failed)`
    )
    await pg.stop()
    process.exit(1)
  }
  console.log(`OK 200_lab runtime ${labSummary.passedTotal}/${labSummary.total}`)

  await pg.stop()
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true })
  console.log("audit lab 200 complete")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
