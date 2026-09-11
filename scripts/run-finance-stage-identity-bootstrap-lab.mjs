/**
 * Local lab for Stage identity bootstrap (Docker PG only).
 * Does NOT connect to Stage/Production.
 *
 * Usage: node scripts/run-finance-stage-identity-bootstrap-lab.mjs
 */
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertDockerAvailable, assertLocalLabEnvironment } from "./finance-lab-guards.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "supabase", "schema")
const labDir = join(root, "supabase", "lab")
const fixturesDir = join(root, "supabase", "stage-fixtures")
const rollbackDir = join(root, "supabase", "rollback")
const evidenceDir = join(root, ".local-backup", "finance-stage-identity-bootstrap-lab")
const container = `finance-stage-identity-${Date.now()}`

export const STAGE_PROJECT_REF_LAB = "tgrqarxfmpwgrkntvgma"
export const PRODUCTION_PROJECT_REF_LAB = "lwpfrdnsiwtmyonwcduh"
const WRONG_STAGE_REF = "wrong-stage-ref-lab"

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

function sessionRefs(stageRef, prodRef) {
  return `
SELECT set_config('alcazar.finance_stage_project_ref', '${stageRef}', true);
SELECT set_config('alcazar.finance_production_project_ref', '${prodRef}', true);
`
}

function psqlReadOnlyPreflight(label, stageRef = STAGE_PROJECT_REF_LAB) {
  const wrapped = [
    "SET default_transaction_read_only = on;",
    "BEGIN READ ONLY;",
    sessionRefs(stageRef, PRODUCTION_PROJECT_REF_LAB),
    readFileSync(join(fixturesDir, "finance_accounting_stage_preflight.sql"), "utf8"),
    "ROLLBACK;"
  ].join("\n")
  return psql(wrapped, label, { allowFailure: true })
}

function injectSessionRefs(sql, stageRef, prodRef) {
  const refs = sessionRefs(stageRef, prodRef)
  if (!sql.includes("-- alcazar:session_refs")) {
    throw new Error("Fixture missing -- alcazar:session_refs injection point")
  }
  return sql.replace("-- alcazar:session_refs", refs.trim())
}

function assertFelplexUnchanged(output) {
  const rows = [...output.matchAll(/^\s*(before|after)\s*\|[^\n]*/gm)]
  if (rows.length < 2) return false
  const counts = rows.map((m) => {
    const cells = m[0].split("|").map((c) => c.trim())
    return Number.parseInt(cells[cells.length - 1], 10)
  })
  return counts.length === 2 && counts[0] === counts[1] && Number.isFinite(counts[0])
}

function runBootstrap(label, stageRef = STAGE_PROJECT_REF_LAB, prodRef = PRODUCTION_PROJECT_REF_LAB, { allowFailure = false } = {}) {
  const sql = injectSessionRefs(
    readFileSync(join(fixturesDir, "finance_accounting_stage_identity_bootstrap.sql"), "utf8"),
    stageRef,
    prodRef
  )
  return psql(sql, label, { allowFailure })
}

function seedFelplexDummy() {
  return `
insert into public.app_settings (key, value) values
  ('felplex_stage_config', jsonb_build_object('enabled', true, 'source', 'lab_dummy'))
on conflict (key) do nothing;
`
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
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=lab_pass postgres:16-alpine`)
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
  psql(seedFelplexDummy(), "felplex_seed")

  const preMissing = psqlReadOnlyPreflight("preflight_identity_missing")
  log("preflight_missing_identity_not_ready", preMissing.out.includes("NOT_READY"), "NOT_READY")

  const boot1 = runBootstrap("bootstrap_initial")
  log("bootstrap_initial_pass", boot1.out.includes("PASS"), "PASS")
  log("felplex_count_unchanged", assertFelplexUnchanged(boot1.out), "before=after count")

  const preReady = psqlReadOnlyPreflight("preflight_after_bootstrap")
  log("preflight_after_bootstrap_ready", preReady.out.includes("READY") && preReady.status === 0, "READY")

  const boot2 = runBootstrap("bootstrap_idempotent")
  log("bootstrap_idempotent_pass", boot2.out.includes("PASS"), "PASS")

  const sameRefs = runBootstrap("bootstrap_same_refs_reject", STAGE_PROJECT_REF_LAB, STAGE_PROJECT_REF_LAB, { allowFailure: true })
  log("bootstrap_same_refs_rejected", sameRefs.status !== 0, "non-zero exit")

  const wrongRef = runBootstrap("bootstrap_wrong_stage_ref", WRONG_STAGE_REF, PRODUCTION_PROJECT_REF_LAB, { allowFailure: true })
  log("bootstrap_wrong_stage_ref_rejected", wrongRef.status !== 0, "non-zero exit")

  psql(
    `insert into public.app_settings (key, value) values ('deployment_environment', jsonb_build_object('name','production','project_ref','${PRODUCTION_PROJECT_REF_LAB}')) on conflict (key) do update set value = excluded.value;`,
    "conflict_production_env"
  )
  const conflictProd = runBootstrap("bootstrap_conflict_production", STAGE_PROJECT_REF_LAB, PRODUCTION_PROJECT_REF_LAB, { allowFailure: true })
  log("bootstrap_conflict_production_rejected", conflictProd.status !== 0, "non-zero exit")
  psql("delete from public.app_settings where key = 'deployment_environment';", "cleanup_production_env")

  runBootstrap("bootstrap_restore_for_rollback")
  const rollback = psql(
    injectSessionRefs(
      readFileSync(join(rollbackDir, "finance_accounting_stage_identity_bootstrap.rollback.sql"), "utf8"),
      STAGE_PROJECT_REF_LAB,
      PRODUCTION_PROJECT_REF_LAB
    ),
    "rollback_identity"
  )
  log("rollback_pass", rollback.out.includes("PASS"), "PASS")

  const preAfterRollback = psqlReadOnlyPreflight("preflight_after_rollback")
  log("preflight_after_rollback_not_ready", preAfterRollback.out.includes("NOT_READY"), "NOT_READY")

  const felAfter = psql("select count(*)::text from public.app_settings where key = 'felplex_stage_config';", "felplex_after")
  log("felplex_dummy_preserved", felAfter.out.includes("1"), "count=1")

  const dry = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(root, "scripts/stage-finance-accounting-snapshot.ps1"),
      "-DryRun",
      "-UninitializedStage"
    ],
    {
      encoding: "utf8",
      cwd: root,
      env: {
        ...process.env,
        ALCAZAR_STAGE_DATABASE_URL: "",
        ALCAZAR_STAGE_PROJECT_REF: STAGE_PROJECT_REF_LAB,
        ALCAZAR_PRODUCTION_PROJECT_REF: PRODUCTION_PROJECT_REF_LAB
      }
    }
  )
  log("snapshot_uninitialized_dry_run", dry.status === 0, dry.stdout?.slice(0, 80) || "ok")

  writeFileSync(join(evidenceDir, "results.json"), JSON.stringify(results, null, 2))
} catch (e) {
  log("lab_error", false, e.message)
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
