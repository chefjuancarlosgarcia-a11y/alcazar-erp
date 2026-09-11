/**
 * PG17 lab: reproduce Supabase contaminated default ACL failure (pre-patch)
 * and verify hardened migrations 202-204 pass all privilege postchecks (post-patch).
 * Does NOT connect to Stage/Production remotes.
 *
 * Usage: node scripts/run-finance-accounting-privileges-lab.mjs
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
const wrapperPs1 = join(root, "scripts", "invoke-finance-stage-accounting-migration.ps1")
const evidenceDir = join(root, ".local-backup", "finance-accounting-privileges-lab")
const container = `finance-privileges-${Date.now()}`
const hostPort = 55720 + Math.floor(Math.random() * 20)
const STAGE_REF = "tgrqarxfmpwgrkntvgma"

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

function psqlOneValue(sql, label, { allowFailure = false } = {}) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  )
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  if (!allowFailure && r.status !== 0) throw new Error(`${label} failed: ${out.slice(-2500)}`)
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(BEGIN|COMMIT|ROLLBACK|DO|CREATE|GRANT|DROP|INSERT|SELECT 1)/i.test(l))
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^(t|f|true|false|\d+|missing|\[\]|\{)/.test(lines[i])) return lines[i]
  }
  return lines.at(-1) ?? ""
}

function psqlScalar(sql, label, opts = {}) {
  return psqlOneValue(sql, label, opts)
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

function stageLabUrl() {
  return `postgresql://postgres.${STAGE_REF}:lab_pass@127.0.0.1:${hostPort}/postgres`
}

function tableExists(tableName) {
  const val = psqlScalar(`select coalesce(to_regclass('${tableName}')::text, 'missing');`, `exists_${tableName.replace(/\W/g, "_")}`)
  return val !== "missing"
}

function postcheckPass(label, path) {
  const { out, status } = psqlFile(path, label, { allowFailure: true })
  const pass = status === 0 && /PASS/.test(out)
  return { pass, out }
}

function invokeWrapper(phase, label, expectSuccess = true) {
  const manifestPath = join(evidenceDir, "manifest-lab.json")
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        manifest_version: 1,
        dry_run: false,
        uninitialized_stage: false,
        stage_project_ref: STAGE_REF,
        production_project_ref: "lwpfrdnsiwtmyonwcduh",
        timestamp: "lab",
        created_at: new Date().toISOString(),
        files: []
      },
      null,
      2
    ),
    "utf8"
  )
  const r = spawnSync(
    "powershell",
    [
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
      "24",
      "-OperatorConfirmation",
      `APPLY ${phase} TO ${STAGE_REF}`
    ],
    {
      encoding: "utf8",
      cwd: root,
      env: {
        ...process.env,
        ALCAZAR_FINANCE_MIGRATION_LAB_SKIP_GIT_CHECK: "1",
        ALCAZAR_STAGE_DATABASE_URL: stageLabUrl(),
        ALCAZAR_STAGE_PROJECT_REF: STAGE_REF,
        ALCAZAR_PRODUCTION_PROJECT_REF: "lwpfrdnsiwtmyonwcduh"
      }
    }
  )
  const out = (r.stdout || "") + (r.stderr || "")
  writeFileSync(join(evidenceDir, `${label}.log`), out)
  const ok = expectSuccess ? r.status === 0 : r.status !== 0
  return { ok, out, status: r.status ?? 1 }
}

function bootstrapDatabase() {
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=lab_pass -p ${hostPort}:5432 postgres:17-alpine`)
  for (let i = 0; i < 40; i++) {
    if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" }).status === 0) break
    execSync("powershell -Command Start-Sleep -Seconds 1")
  }
  const pgMajor = psqlScalar("show server_version_num;", "pg_version").slice(0, 2)
  log("pg17_bootstrap", pgMajor === "17", `server_version_num=${pgMajor}`)

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

function simulateOldPatternFailure() {
  psql(
    `
create table public.finance_chart_accounts_old_pattern (
  id uuid primary key default gen_random_uuid()
);
grant select, insert, update on table public.finance_chart_accounts_old_pattern to authenticated;
`,
    "old_pattern_setup"
  )
  const deleteLeak = psqlScalar(
    `select has_table_privilege('authenticated', 'public.finance_chart_accounts_old_pattern', 'DELETE')::text;`,
    "old_pattern_delete_leak"
  )
  log("before_patch_contaminated_delete_leak", deleteLeak === "t" || deleteLeak === "true", `DELETE=${deleteLeak}`)

  const gateFail = psqlScalar(
    `select (not has_table_privilege('authenticated', 'public.finance_chart_accounts_old_pattern', 'DELETE'))::text;`,
    "old_pattern_no_delete_gate"
  )
  log("before_patch_no_delete_gate_fails", gateFail === "f" || gateFail === "false", `gate=${gateFail}`)

  psql("drop table if exists public.finance_chart_accounts_old_pattern;", "old_pattern_cleanup")

  psql(
    `
begin;
create table public.finance_chart_accounts_tx_probe (id uuid primary key default gen_random_uuid());
grant select, insert, update on table public.finance_chart_accounts_tx_probe to authenticated;
select 1 / (case when has_table_privilege('authenticated', 'public.finance_chart_accounts_tx_probe', 'DELETE') then 0 else 1 end);
commit;
`,
    "old_pattern_would_commit_fail",
    { allowFailure: true }
  )
  log("before_patch_tx_rollback_zero_objects", !tableExists("public.finance_chart_accounts_tx_probe"), "0 objects after rollback")
}

function dumpPrivilegeInventory() {
  const inventory = psqlScalar(
    `
select coalesce(jsonb_pretty(jsonb_agg(row_to_json(x) order by x.table_name, x.grantee)), '[]')
from (
  select
    c.relname as table_name,
    acl.grantee::regrole::text as grantee,
    acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', n.oid))) acl
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'finance_chart_accounts', 'branches', 'finance_cost_centers', 'finance_accounting_periods',
      'finance_journal_entries', 'finance_journal_lines', 'finance_journal_entry_counters'
    )
    and acl.grantee::regrole::text in ('anon', 'authenticated', 'service_role', 'PUBLIC')
) x;
`,
    "privilege_inventory"
  )
  writeFileSync(join(evidenceDir, "privilege-inventory.json"), inventory || "[]", "utf8")
  log("privilege_inventory_captured", inventory.startsWith("[") || inventory.startsWith("{"), "written")
}

try {
  assertLocalLabEnvironment()
  assertDockerAvailable()
  bootstrapDatabase()

  simulateOldPatternFailure()

  const apply202 = invokeWrapper("202", "wrapper_202_contaminated", true)
  log("wrapper_202_pass_contaminated_acl", apply202.ok && tableExists("public.finance_chart_accounts"), "chart present")

  const pc202 = postcheckPass("postcheck_202", join(fixturesDir, "finance_accounting_postcheck_202.sql"))
  log("postcheck_202_pass", pc202.pass, pc202.pass ? "PASS" : pc202.out.slice(-400))

  const apply203 = invokeWrapper("203", "wrapper_203_contaminated", true)
  log("wrapper_203_pass_contaminated_acl", apply203.ok && tableExists("public.branches"), "branches present")

  const pc203 = postcheckPass("postcheck_203", join(fixturesDir, "finance_accounting_postcheck_203.sql"))
  log("postcheck_203_pass", pc203.pass, pc203.pass ? "PASS" : pc203.out.slice(-400))

  const apply204 = invokeWrapper("204", "wrapper_204_contaminated", true)
  log("wrapper_204_pass_contaminated_acl", apply204.ok && tableExists("public.finance_journal_entries"), "journal present")

  const pc204 = postcheckPass("postcheck_204", join(fixturesDir, "finance_accounting_postcheck_204.sql"))
  log("postcheck_204_pass", pc204.pass, pc204.pass ? "PASS" : pc204.out.slice(-400))

  dumpPrivilegeInventory()

  writeFileSync(join(evidenceDir, "results.json"), JSON.stringify(results, null, 2))
} catch (e) {
  log("lab_error", false, e.message)
} finally {
  try {
    run(`docker rm -f ${container}`)
  } catch {}
}

process.exit(exitCode)
