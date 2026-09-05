/**
 * Disposable local PostgreSQL audit for finance migrations 202 + 203.
 * Run: node scripts/run-finance-2a1-audit.mjs
 */

import { execSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const container = `finance-2a1-audit-${Date.now()}`
const pgPassword = "audit_pass"
const pgPort = "55432"

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim()
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n")
    throw new Error(detail || error.message)
  }
}

function psqlFile(filePath, db = "postgres") {
  const sql = readFileSync(filePath, "utf8")
  const tmp = join(tmpdir(), `finance-audit-${Date.now()}.sql`)
  writeFileSync(tmp, sql)
  try {
    return run(
      `docker exec -i ${container} psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -f /dev/stdin`,
      { input: readFileSync(tmp) }
    )
  } finally {
    rmSync(tmp, { force: true })
  }
}

function psql(sql, db = "postgres") {
  return run(`docker exec -i ${container} psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -At -F "|"`, {
    input: sql
  })
}

const bootstrapSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  username text UNIQUE,
  role text NOT NULL DEFAULT 'colaborador',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE,
  role_name text NOT NULL,
  description text,
  category text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_roles (role_key, role_name, description, category, is_system, is_active) VALUES
  ('admin', 'Admin', 'Admin', 'Administración', true, true),
  ('gerente_general', 'Gerente General', 'Gerente', 'Administración', true, true),
  ('contador', 'Contador', 'Contador', 'Administración', true, true),
  ('mesero', 'Mesero', 'Mesero', 'Operaciones', true, true)
ON CONFLICT (role_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.normalize_profile_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN translate(lower(coalesce(p_role, '')), 'áéíóú', 'aeiou') IN ('gerente general', 'gerente_general') THEN 'gerente_general'
    WHEN translate(lower(coalesce(p_role, '')), 'áéíóú', 'aeiou') IN ('administrador', 'admin') THEN 'admin'
    ELSE replace(translate(lower(coalesce(p_role, '')), 'áéíóú', 'aeiou'), ' ', '_')
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_finance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND public.normalize_profile_role(p.role) IN ('admin', 'gerente_general', 'contador')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_finance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND public.normalize_profile_role(p.role) IN ('admin', 'contador')
  );
$$;

CREATE OR REPLACE FUNCTION public.finance_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.areas (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'operativa',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.areas (id, name, type, active, sort_order)
VALUES ('cocina', 'Cocina', 'produccion', true, 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
ON CONFLICT DO NOTHING;
`

function parseTestOutput(output) {
  const lines = output.split(/\r?\n/).filter(Boolean)
  const rows = []
  for (const line of lines) {
    const parts = line.split("|")
    if (parts.length >= 6) {
      rows.push({
        scenario: parts[0],
        passed: parts[1] === "t",
        detail: parts.slice(2, -3).join("|") || parts[2] || "",
        total: parts.at(-3),
        passed_total: parts.at(-2),
        failed_total: parts.at(-1)
      })
    }
  }
  return rows
}

let exitCode = 0
try {
  console.log("Starting disposable PostgreSQL container...")
  run(
    `docker run -d --rm --name ${container} -e POSTGRES_PASSWORD=${pgPassword} -p ${pgPort}:5432 postgres:16-alpine`
  )

  for (let i = 0; i < 30; i++) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" })
    if (ready.status === 0) break
    execSync("powershell -Command Start-Sleep -Seconds 1")
  }

  console.log("Applying audit bootstrap...")
  psql(bootstrapSql)

  console.log("Applying 202_finance_accounting_chart_of_accounts.sql...")
  psql(readFileSync(join(root, "supabase/schema/202_finance_accounting_chart_of_accounts.sql"), "utf8"))

  console.log("Applying 203_finance_accounting_multibranch_foundation.sql...")
  psql(readFileSync(join(root, "supabase/schema/203_finance_accounting_multibranch_foundation.sql"), "utf8"))

  console.log("Running 203_test_finance_accounting_multibranch_foundation.sql...")
  const testOutput = psql(readFileSync(join(root, "supabase/schema/203_test_finance_accounting_multibranch_foundation.sql"), "utf8"))
  const rows = parseTestOutput(testOutput)

  console.log("\n=== SQL AUDIT RESULTS ===")
  let failed = 0
  for (const row of rows) {
    const status = row.passed ? "PASS" : "FAIL"
    if (!row.passed) failed += 1
    console.log(`${status}\t${row.scenario}\t${row.detail}`)
  }

  if (rows.length) {
    const last = rows[rows.length - 1]
    console.log(`\nTotal: ${last.total}, Passed: ${last.passed_total}, Failed: ${last.failed_total}`)
  }

  if (failed > 0) exitCode = 1
} catch (error) {
  console.error("Audit failed:", error.stdout || error.message || error)
  exitCode = 1
} finally {
  try {
    run(`docker rm -f ${container}`)
    console.log("\nDisposable PostgreSQL container removed.")
  } catch {
    console.warn("Could not remove container", container)
  }
}

process.exit(exitCode)
