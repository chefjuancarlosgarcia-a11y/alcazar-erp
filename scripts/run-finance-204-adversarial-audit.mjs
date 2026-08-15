/**
 * Adversarial + multi-session concurrency audit for finance migration 204.
 * Includes baseline 204_test (23 scenarios). Replaces run-finance-2a2-journal-audit.mjs.
 * Run: node scripts/run-finance-204-adversarial-audit.mjs
 */

import { execSync, spawn, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const container = `finance-204-adv-${Date.now()}`
const port = 55434 + Math.floor(Math.random() * 100)

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim()
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n")
    throw new Error(detail || error.message)
  }
}

function psql(sql, opts = {}) {
  return run(`docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -F "|"`, {
    input: sql,
    ...opts
  })
}

function psqlFile(path) {
  return psql(readFileSync(path, "utf8"))
}

function parseTestOutput(output) {
  const lines = output.split(/\r?\n/).filter(Boolean)
  const rows = []
  for (const line of lines) {
    const parts = line.split("|")
    if (parts.length >= 6) {
      rows.push({
        scenario: parts[0],
        passed: parts[1] === "t",
        detail: parts.slice(2, -3).join("|") || parts[2] || ""
      })
    }
  }
  return rows
}

const bootstrapSql = readFileSync(join(root, "scripts/run-finance-2a1-audit.mjs"), "utf8")
  .match(/const bootstrapSql = `([\s\S]*?)`/)[1]

const concurrencySetupSql = `
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, full_name, username, role, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin', 'admin_conc', 'admin', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Contador', 'contador_conc', 'contador', 'active')
ON CONFLICT (id) DO UPDATE SET role = excluded.role, status = excluded.status;

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

CREATE TABLE IF NOT EXISTS public.conc_fixtures (key text primary key, val uuid not null);
TRUNCATE public.conc_fixtures;

DO $$
DECLARE v_cash uuid; v_equity uuid;
BEGIN
  PERFORM public.create_finance_accounting_period(2026, 12);
  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', '1.01-CONC', 'name', 'Caja CONC', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', '3.01-CONC', 'name', 'Capital CONC', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  INSERT INTO public.conc_fixtures (key, val) VALUES
    ('period_dec', (SELECT id FROM public.finance_accounting_periods WHERE period_year = 2026 AND period_month = 12)),
    ('cash', v_cash), ('equity', v_equity);
  WITH e AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-10', 'description', 'Concurrent same entry')) ->> 'id')::uuid AS id)
  INSERT INTO public.conc_fixtures SELECT 'entry_same', id FROM e;
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_same'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 100)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_same'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_same'));
  WITH e1 AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-11', 'description', 'Concurrent A')) ->> 'id')::uuid AS id),
  e2 AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-12', 'description', 'Concurrent B')) ->> 'id')::uuid AS id)
  INSERT INTO public.conc_fixtures VALUES ('entry_a', (SELECT id FROM e1)), ('entry_b', (SELECT id FROM e2));
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_a'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 40, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 40)));
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_b'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 60, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 60)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_a'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_a'));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_b'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_b'));
  WITH e AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-13', 'description', 'Reversal race')) ->> 'id')::uuid AS id)
  INSERT INTO public.conc_fixtures SELECT 'entry_rev', id FROM e;
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_rev'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 30, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 30)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_rev'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_rev'));
  PERFORM public.post_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_rev'));
  WITH s AS (SELECT '22222222-2222-2222-2222-222222222222'::uuid AS sid)
  INSERT INTO public.conc_fixtures SELECT 'entry_src_a', (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-14', 'description', 'Source A', 'source_module', 'conc',
    'source_id', s.sid::text, 'source_event', 'pay')) ->> 'id')::uuid FROM s;
  WITH s AS (SELECT '22222222-2222-2222-2222-222222222222'::uuid AS sid)
  INSERT INTO public.conc_fixtures SELECT 'entry_src_b', (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-15', 'description', 'Source B', 'source_module', 'conc',
    'source_id', s.sid::text, 'source_event', 'pay')) ->> 'id')::uuid FROM s;
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_a'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 20, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 20)));
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_b'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 20, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 20)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_a'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_a'));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_b'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_b'));
  WITH e AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-12-16', 'description', 'Close race')) ->> 'id')::uuid AS id)
  INSERT INTO public.conc_fixtures SELECT 'entry_close', id FROM e;
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_close'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 70, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 70)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_close'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_close'));
  PERFORM public.create_finance_accounting_period(2027, 1);
  INSERT INTO public.conc_fixtures (key, val) VALUES
    ('period_jan27', (SELECT id FROM public.finance_accounting_periods WHERE period_year = 2027 AND period_month = 1));
  WITH e AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2027-01-15', 'description', 'Close wins race')) ->> 'id')::uuid AS id)
  INSERT INTO public.conc_fixtures SELECT 'entry_close_wins', id FROM e;
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_close_wins'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 55, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 55)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_close_wins'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_close_wins'));
  WITH e AS (SELECT (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2027-01-16', 'description', 'Post wins race')) ->> 'id')::uuid AS id)
  INSERT INTO public.conc_fixtures SELECT 'entry_post_wins', id FROM e;
  PERFORM public.replace_finance_journal_lines((SELECT val FROM public.conc_fixtures WHERE key = 'entry_post_wins'), jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 65, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 65)));
  PERFORM public.submit_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_post_wins'));
  PERFORM public.approve_finance_journal_entry((SELECT val FROM public.conc_fixtures WHERE key = 'entry_post_wins'));
END $$;
`

function sessionSql(label, body) {
  return `
\\set ON_ERROR_STOP off
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
BEGIN;
${body}
COMMIT;
\\set ON_ERROR_STOP on
`
}

function runConcurrent(scenario, sqlA, sqlB) {
  const tmp = mkdtempSync(join(tmpdir(), "finance204-"))
  const fileA = join(tmp, "a.sql")
  const fileB = join(tmp, "b.sql")
  writeFileSync(fileA, sessionSql("A", sqlA))
  writeFileSync(fileB, sessionSql("B", sqlB))

  const runSession = (file) =>
    new Promise((resolve) => {
      const proc = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres"], {
        stdio: ["pipe", "pipe", "pipe"]
      })
      let stdout = ""
      let stderr = ""
      proc.stdout.on("data", (chunk) => { stdout += chunk.toString() })
      proc.stderr.on("data", (chunk) => { stderr += chunk.toString() })
      proc.on("close", (code) => resolve({ status: code, stdout, stderr }))
      proc.stdin.write(readFileSync(file))
      proc.stdin.end()
    })

  return Promise.all([runSession(fileA), runSession(fileB)]).then(([procA, procB]) => {
    rmSync(tmp, { recursive: true, force: true })
    return { scenario, procA, procB }
  })
}

function sleep(ms) {
  execSync(`powershell -Command Start-Sleep -Milliseconds ${ms}`)
}

let exitCode = 0
const allRows = []

try {
  console.log("Starting disposable PostgreSQL for adversarial audit...")
  run(`docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=audit_pass -p ${port}:5432 postgres:16-alpine`)

  for (let i = 0; i < 30; i++) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" })
    if (ready.status === 0) break
    sleep(1000)
  }

  console.log("Applying bootstrap + migrations 202, 203, 204...")
  psql(bootstrapSql)
  psqlFile(join(root, "supabase/schema/202_finance_accounting_chart_of_accounts.sql"))
  psqlFile(join(root, "supabase/schema/203_finance_accounting_multibranch_foundation.sql"))
  psqlFile(join(root, "supabase/schema/204_finance_accounting_journal_engine.sql"))

  console.log("\n=== ADVERSARIAL SQL TESTS ===")
  const advOutput = psqlFile(join(root, "supabase/schema/204_adversarial_test_finance_accounting_journal_engine.sql"))
  const advRows = parseTestOutput(advOutput)
  allRows.push(...advRows)

  console.log("\n=== CONCURRENCY SETUP ===")
  psql(concurrencySetupSql)

  console.log("\n=== MULTI-SESSION CONCURRENCY ===")

  // A: Two sessions posting same entry
  {
    const entryId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_same';")
    const sql = `
      SELECT pg_sleep(0.15);
      SELECT public.post_finance_journal_entry('${entryId}'::uuid);
    `
    const { procA, procB } = await runConcurrent("conc_same_entry_post", sql, sql)
    const combined = [procA.stdout, procA.stderr, procB.stdout, procB.stderr].join("\n")
    const successes = (combined.match(/JE-2026-/g) || []).length
    const status = psql(`SELECT status, count(*)::text FROM finance_journal_entries WHERE id = '${entryId}' GROUP BY status;`)
    const numbers = psql(`SELECT coalesce(entry_number,'') FROM finance_journal_entries WHERE id = '${entryId}';`)
    const passed = successes === 1 && status.includes("posted|1") && numbers.match(/JE-2026-/)
    allRows.push({ scenario: "conc_A_same_entry_one_post", passed, detail: `successes=${successes} status=${status} num=${numbers}` })
  }

  // B: Two different entries posted concurrently
  {
    const idA = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_a';")
    const idB = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_b';")
    const sqlA = `SELECT pg_sleep(0.05); SELECT public.post_finance_journal_entry('${idA}'::uuid);`
    const sqlB = `SELECT pg_sleep(0.05); SELECT public.post_finance_journal_entry('${idB}'::uuid);`
    const { procA, procB } = await runConcurrent("conc_diff_entries", sqlA, sqlB)
    const combined = [procA.stdout, procA.stderr, procB.stdout, procB.stderr].join("\n")
    const nums = psql(`
      SELECT entry_number FROM finance_journal_entries
      WHERE id IN ('${idA}'::uuid, '${idB}'::uuid) AND status = 'posted' ORDER BY entry_number;
    `).split("\n").filter(Boolean)
    const passed = nums.length === 2 && nums[0] !== nums[1] && combined.includes("JE-2026-")
    allRows.push({ scenario: "conc_B_two_entries_unique_numbers", passed, detail: nums.join(",") })
  }

  // C-post-wins: post completes before close evaluates (isolated period 2027-01)
  {
    const entryId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_post_wins';")
    const periodId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'period_jan27';")
    const sqlPost = `SELECT public.post_finance_journal_entry('${entryId}'::uuid);`
    const sqlClose = `
      SELECT pg_sleep(0.4);
      SELECT public.set_finance_accounting_period_status('${periodId}'::uuid, 'closed');
    `
    await runConcurrent("conc_C_post_wins", sqlPost, sqlClose)
    const entryStatus = psql(`SELECT status FROM finance_journal_entries WHERE id = '${entryId}';`)
    const periodStatus = psql(`SELECT status FROM finance_accounting_periods WHERE id = '${periodId}';`)
    const entryNumber = psql(`SELECT coalesce(entry_number, '') FROM finance_journal_entries WHERE id = '${entryId}';`)
    const postedInClosed = psql(`
      SELECT count(*)::int FROM finance_journal_entries
      WHERE id = '${entryId}' AND status = 'posted'
        AND period_id IN (SELECT id FROM finance_accounting_periods WHERE status = 'closed');
    `)
    const passed =
      entryStatus === "posted" &&
      periodStatus === "open" &&
      entryNumber.match(/JE-2027-/) &&
      postedInClosed === "0"
    allRows.push({
      scenario: "conc_C_post_wins",
      passed,
      detail: `entry=${entryStatus} period=${periodStatus} num=${entryNumber}`
    })
  }

  // C-close-wins: close locks period first while post holds entry lock waiting
  {
    const entryId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_close_wins';")
    const periodId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'period_jan27';")
    const counterBefore = psql(`
      SELECT coalesce(last_number::text, '0')
      FROM public.finance_journal_entry_counters WHERE period_year = 2027;
    `) || "0"
    const sqlClose = `
      SELECT pg_sleep(0.25);
      SELECT public.set_finance_accounting_period_status('${periodId}'::uuid, 'closed');
    `
    const sqlPost = `
      SELECT id FROM public.finance_journal_entries WHERE id = '${entryId}' FOR UPDATE;
      SELECT pg_sleep(0.8);
      SELECT public.post_finance_journal_entry('${entryId}'::uuid);
    `
    const { procA, procB } = await runConcurrent("conc_C_close_wins", sqlClose, sqlPost)
    const combined = [procA.stdout, procA.stderr, procB.stdout, procB.stderr].join("\n")
    const entryStatus = psql(`SELECT status FROM finance_journal_entries WHERE id = '${entryId}';`)
    const periodStatus = psql(`SELECT status FROM finance_accounting_periods WHERE id = '${periodId}';`)
    const entryNumber = psql(`SELECT coalesce(entry_number, '') FROM finance_journal_entries WHERE id = '${entryId}';`)
    const counterAfter = psql(`
      SELECT coalesce(last_number::text, '0')
      FROM public.finance_journal_entry_counters WHERE period_year = 2027;
    `) || "0"
    const postFailedClosed = combined.toLowerCase().includes("cerrado")
    const passed =
      entryStatus === "approved" &&
      periodStatus === "closed" &&
      entryNumber === "" &&
      counterBefore === counterAfter &&
      postFailedClosed
    allRows.push({
      scenario: "conc_C_close_wins",
      passed,
      detail: `entry=${entryStatus} period=${periodStatus} counter=${counterBefore}->${counterAfter} closed_err=${postFailedClosed}`
    })
    if (periodStatus === "closed") {
      run(`docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=0 -c "SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); SELECT public.reopen_finance_accounting_period('${periodId}'::uuid, 'Reapertura tras prueba close-wins');"`)
    }
  }

  // Sanity: never post into a closed period (Dec fixtures race)
  {
    const entryId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_close';")
    const periodId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'period_dec';")
    const sqlPost = `
      SELECT pg_sleep(0.1);
      SELECT public.post_finance_journal_entry('${entryId}'::uuid);
    `
    const sqlClose = `
      SELECT pg_sleep(0.1);
      SELECT public.set_finance_accounting_period_status('${periodId}'::uuid, 'closed');
    `
    await runConcurrent("conc_close_vs_post_race", sqlPost, sqlClose)
    const entryStatus = psql(`SELECT status FROM finance_journal_entries WHERE id = '${entryId}';`)
    const periodStatus = psql(`SELECT status FROM finance_accounting_periods WHERE id = '${periodId}';`)
    const postedInClosed = psql(`
      SELECT count(*)::int FROM finance_journal_entries
      WHERE id = '${entryId}' AND status = 'posted'
        AND period_id IN (SELECT id FROM finance_accounting_periods WHERE status = 'closed');
    `)
    const passed = postedInClosed === "0"
    allRows.push({
      scenario: "conc_no_posted_in_closed_period",
      passed,
      detail: `entry=${entryStatus} period=${periodStatus}`
    })
  }

  // D: Two concurrent reversals
  {
    const entryId = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_rev';")
    const sql = `
      SELECT pg_sleep(0.1);
      SELECT public.reverse_finance_journal_entry('${entryId}'::uuid, 'Reversión concurrente', '2026-12-13'::date);
    `
    await runConcurrent("conc_dual_reversal", sql, sql)
    const reversalCount = psql(`
      SELECT count(*)::int FROM finance_journal_entries WHERE reversal_of_id = '${entryId}';
    `)
    const reversedLink = psql(`SELECT reversed_by_entry_id IS NOT NULL FROM finance_journal_entries WHERE id = '${entryId}';`)
    const passed = reversalCount === "1" && reversedLink === "t"
    allRows.push({ scenario: "conc_D_one_reversal_only", passed, detail: `reversals=${reversalCount}` })
  }

  // E: Same source concurrent post
  {
    const idA = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_a';")
    const idB = psql("SELECT val FROM public.conc_fixtures WHERE key = 'entry_src_b';")
    const sqlA = `SELECT pg_sleep(0.05); SELECT public.post_finance_journal_entry('${idA}'::uuid);`
    const sqlB = `SELECT pg_sleep(0.05); SELECT public.post_finance_journal_entry('${idB}'::uuid);`
    await runConcurrent("conc_same_source", sqlA, sqlB)
    const postedCount = psql(`
      SELECT count(*)::int FROM finance_journal_entries
      WHERE source_module = 'conc' AND source_id = '22222222-2222-2222-2222-222222222222'
        AND source_event = 'pay' AND status = 'posted' AND reversal_of_id IS NULL;
    `)
    const passed = postedCount === "1"
    allRows.push({ scenario: "conc_E_one_posted_per_source", passed, detail: `posted=${postedCount}` })
  }

  console.log("\n=== FULL AUDIT RESULTS ===")
  let failed = 0
  for (const row of allRows) {
    const status = row.passed ? "PASS" : "FAIL"
    if (!row.passed) failed += 1
    console.log(`${status}\t${row.scenario}\t${row.detail}`)
  }
  console.log(`\nTotal: ${allRows.length}, Passed: ${allRows.length - failed}, Failed: ${failed}`)

  if (failed > 0) exitCode = 1

  // Re-run baseline 204 tests
  console.log("\n=== BASELINE 204 REGRESSION ===")
  const baseOutput = psqlFile(join(root, "supabase/schema/204_test_finance_accounting_journal_engine.sql"))
  const baseRows = parseTestOutput(baseOutput)
  const baseFailed = baseRows.filter((r) => !r.passed).length
  for (const row of baseRows.filter((r) => !r.passed)) {
    console.log(`FAIL\t${row.scenario}\t${row.detail}`)
  }
  console.log(`Baseline: ${baseRows.length} scenarios, ${baseFailed} failed`)
  if (baseFailed > 0) exitCode = 1
} catch (error) {
  console.error("Audit failed:", error.message || error)
  exitCode = 1
} finally {
  try {
    run(`docker rm -f ${container}`)
    console.log("\nContainer removed.")
  } catch {
    console.warn("Could not remove container", container)
  }
}

process.exit(exitCode)
