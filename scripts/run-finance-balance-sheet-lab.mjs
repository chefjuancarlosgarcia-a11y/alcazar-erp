/**
 * Disposable local lab for Balance General migration 218.
 * Applies the finance schema through 217, then 218.
 * Does not connect to Stage or Production and does not pull images.
 *
 * Usage: node scripts/run-finance-balance-sheet-lab.mjs
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
const migration = join(schemaDir, "218_finance_balance_sheet.sql")
const migrationTest = join(schemaDir, "218_test_finance_balance_sheet.sql")
const rollback = join(rollbackDir, "218_finance_balance_sheet.rollback.sql")
const container = `finance-balance-218-${Date.now()}`
const port = 55720 + Math.floor(Math.random() * 20)
const pgPass = "lab_pass_local_only"
const requiredScenarios = [
  "01_compiles",
  "02_signature",
  "03_security",
  "04_acl",
  "04b_classifier_not_executable",
  "05_column",
  "06_rejects_without_permission",
  "06b_operational_role",
  "07_create_without_section",
  "08_create_spanish_label",
  "09_update_section",
  "10_invalid_combination",
  "11_header_rejects_section",
  "12_results_reject_section",
  "13_import_warning_without_section",
  "14_import_rejects_unknown",
  "14b_import_stores_label",
  "15_omit_keeps_section",
  "16_blank_clears_section",
  "17_null_clears_section",
  "18_type_change_requires_clear",
  "19_square",
  "20_depreciation_reduces_assets",
  "21_loss_reduces_equity",
  "22_close_does_not_duplicate",
  "23_unclassified_pnl_in_result",
  "24_unclassified_asset_incomplete",
  "25_unclassified_without_balance_complete",
  "26_classified_differs_from_control",
  "27_contrary_visible",
  "28_inactive_history",
  "29_zero_hidden",
  "29b_zero_included",
  "30_reversal",
  "31_snapshot",
  "32_cutoff_excludes",
  "33_cutoff_required",
  "34_posted_only",
  "35_dimension_warning",
  "36_limit",
  "37_reports_remain",
  "38_income_section_preserved"
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

function fingerprintSql() {
  return `
    select (
      coalesce((
        select string_agg(md5(pg_get_functiondef(p.oid)), '|' order by p.proname)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'finance_chart_account_row_to_json',
            'create_finance_chart_account',
            'update_finance_chart_account',
            'preview_finance_chart_accounts_import',
            'import_finance_chart_accounts',
            'get_finance_general_journal',
            'get_finance_general_ledger',
            'get_finance_trial_balance',
            'get_finance_income_statement'
          )
      ), '')
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_finance_balance_sheet')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'finance_chart_account_classify_balance_sheet_section')::text
      || '|' ||
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'finance_chart_accounts' and column_name = 'balance_sheet_section')::text
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
      || '|' ||
      has_function_privilege('authenticated', 'public.get_finance_income_statement(date,date,uuid,uuid,uuid,boolean,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('anon', 'public.get_finance_income_statement(date,date,uuid,uuid,uuid,boolean,timestamptz)', 'EXECUTE')::text
      || '|' ||
      has_function_privilege('service_role', 'public.get_finance_income_statement(date,date,uuid,uuid,uuid,boolean,timestamptz)', 'EXECUTE')::text
    );
  `
}

function readVerifyLine(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[0-9a-f]{32}\|/.test(line)) || ""
}

let exitCode = 0
try {
  const migrationSql = readFileSync(migration, "utf8")
  if (/insert\s+into\s+supabase_migrations\.schema_migrations/i.test(migrationSql)) {
    throw new Error("218 must not write schema_migrations")
  }
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
    "216_finance_trial_balance.sql",
    "217_finance_income_statement.sql"
  ]) {
    psqlFile(join(schemaDir, file), file)
  }

  const beforeLine = readVerifyLine(psqlSql(fingerprintSql(), "fingerprint_before_218", ["-At"]))
  console.log(`before 218 ${beforeLine.slice(0, 80)}...`)
  if (!beforeLine.endsWith("|0|0|0|1|true|false|false|true|false|false|true|false|false|true|false|false")) {
    throw new Error(`Baseline fingerprint unexpected: ${beforeLine}`)
  }
  if (!beforeLine.includes("|0|0|0|1|")) {
    throw new Error(`218 objects already present: ${beforeLine}`)
  }

  psqlFile(migration, "apply_218")
  assertScenarios(psqlFile(migrationTest, "test_218_first", ["-At", "-F", "|"]), "first")

  psqlFile(rollback, "rollback_218")
  psqlFile(rollback, "rollback_218_again")
  const verifyLine = readVerifyLine(psqlSql(fingerprintSql(), "verify_after_rollback", ["-At"]))
  console.log(`after rollback ${verifyLine.slice(0, 80)}...`)
  if (verifyLine !== beforeLine) {
    throw new Error(`Rollback verification failed: catalog or report fingerprint changed\nbefore ${beforeLine}\nafter  ${verifyLine}`)
  }

  psqlFile(migration, "reapply_218")
  assertScenarios(psqlFile(migrationTest, "test_218_second", ["-At", "-F", "|"]), "second")

  psqlSql(`
    set session_replication_role = replica;
    insert into public.profiles (id, full_name, username, role, status)
    values (
      '33333333-3333-3333-3333-333333333333',
      'Admin precontaminacion',
      'admin_pre_bs_218',
      'admin',
      'active'
    )
    on conflict (id) do update set role = excluded.role, status = excluded.status;
    set session_replication_role = default;

    do $$
    declare
      v_admin uuid := '33333333-3333-3333-3333-333333333333';
      v_branch uuid;
      v_asset uuid;
      v_liability uuid;
      v_equity uuid;
      v_expense uuid;
      v_entry uuid;
      v_report jsonb;
    begin
      perform set_config('request.jwt.claim.sub', v_admin::text, true);
      v_branch := (public.create_branch(jsonb_build_object(
        'code', 'PRE-OTHER',
        'name', 'Sucursal ajena de precontaminacion'
      )) ->> 'id')::uuid;
      perform public.create_finance_accounting_period(2024, 6);
      v_asset := (public.create_finance_chart_account(jsonb_build_object(
        'code', 'PRE-UNCA', 'name', 'Activo ajeno sin seccion', 'financial_type', 'asset',
        'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
      )) ->> 'id')::uuid;
      v_liability := (public.create_finance_chart_account(jsonb_build_object(
        'code', 'PRE-UNCL', 'name', 'Pasivo ajeno sin seccion', 'financial_type', 'liability',
        'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
      )) ->> 'id')::uuid;
      v_equity := (public.create_finance_chart_account(jsonb_build_object(
        'code', 'PRE-UNCE', 'name', 'Patrimonio ajeno sin seccion', 'financial_type', 'equity',
        'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
      )) ->> 'id')::uuid;
      v_expense := (public.create_finance_chart_account(jsonb_build_object(
        'code', 'PRE-EXP', 'name', 'Gasto ajeno sin seccion', 'financial_type', 'expense',
        'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
      )) ->> 'id')::uuid;

      v_entry := (public.create_finance_journal_draft(jsonb_build_object(
        'entry_date', '2024-06-15',
        'description', 'Precontaminacion de balance',
        'reference', 'PRE-BAL'
      )) ->> 'id')::uuid;
      perform public.replace_finance_journal_lines(v_entry, jsonb_build_array(
        jsonb_build_object('line_number', 1, 'account_id', v_asset::text, 'branch_id', v_branch::text, 'debit', 700, 'credit', 0),
        jsonb_build_object('line_number', 2, 'account_id', v_liability::text, 'branch_id', v_branch::text, 'debit', 0, 'credit', 200),
        jsonb_build_object('line_number', 3, 'account_id', v_equity::text, 'debit', 0, 'credit', 500)
      ));
      perform public.submit_finance_journal_entry(v_entry);
      perform public.approve_finance_journal_entry(v_entry);
      perform public.post_finance_journal_entry(v_entry);

      v_entry := (public.create_finance_journal_draft(jsonb_build_object(
        'entry_date', '2024-06-16',
        'description', 'Precontaminacion de resultados',
        'reference', 'PRE-PNL'
      )) ->> 'id')::uuid;
      perform public.replace_finance_journal_lines(v_entry, jsonb_build_array(
        jsonb_build_object('line_number', 1, 'account_id', v_expense::text, 'branch_id', v_branch::text, 'debit', 77, 'credit', 0),
        jsonb_build_object('line_number', 2, 'account_id', v_asset::text, 'branch_id', v_branch::text, 'debit', 0, 'credit', 77)
      ));
      perform public.submit_finance_journal_entry(v_entry);
      perform public.approve_finance_journal_entry(v_entry);
      perform public.post_finance_journal_entry(v_entry);

      v_report := public.get_finance_balance_sheet('2097-04-30', null, null, false, null);
      if (v_report ->> 'report_label') is distinct from 'Balance provisional'
         or (v_report ->> 'unclassified_asset_amount')::numeric is distinct from 623
         or (v_report ->> 'unclassified_liability_amount')::numeric is distinct from 200
         or (v_report ->> 'accumulated_result')::numeric is distinct from -77
      then
        raise exception 'precontamination_not_visible label=% asset=% liability=% result=%',
          v_report ->> 'report_label',
          v_report ->> 'unclassified_asset_amount',
          v_report ->> 'unclassified_liability_amount',
          v_report ->> 'accumulated_result';
      end if;

      v_report := public.get_finance_balance_sheet(
        '2097-04-30', '00000000-0000-0000-0000-000000000099', null, false, null
      );
      if (v_report ->> 'report_complete')::boolean is distinct from true
         or (v_report ->> 'unclassified_asset_amount')::numeric is distinct from 0
         or (v_report ->> 'accumulated_result')::numeric is distinct from 0
         or (v_report ->> 'control_total_assets')::numeric is distinct from 0
      then
        raise exception 'branch_filter_did_not_exclude_precontamination label=% asset=% result=% assets=%',
          v_report ->> 'report_label',
          v_report ->> 'unclassified_asset_amount',
          v_report ->> 'accumulated_result',
          v_report ->> 'control_total_assets';
      end if;
    end $$;
  `, "precontaminate_before_isolated_test", ["-At"])
  assertScenarios(psqlFile(migrationTest, "test_218_contaminated", ["-At", "-F", "|"]), "contaminated")
  const isolation = psqlSql(`
    select
      (select count(*) from public.branches where code in ('BS-LAB-218-ISO', 'BS-LAB-218-DIM'))::text
      || '|' ||
      (select count(*) from public.branches where code = 'PRE-OTHER')::text
      || '|' ||
      (select count(*) from public.finance_chart_accounts where code like 'BS-%' or code like 'BSL%')::text
      || '|' ||
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('is_lab_post', 'bs_lab_account', 'test_finance_balance_sheet'))::text;
  `, "confirm_lab_fixtures_rolled_back", ["-At"])
  if (!isolation.includes("0|1|0|0")) {
    throw new Error(`Lab fixtures survived or precontamination disappeared: ${isolation}`)
  }
  console.log("218 apply, test, rollback twice, reapply, retest, and contaminated isolation complete")
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
