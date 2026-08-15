/**
 * Structural guard: Stage preflight/postcheck fixtures must be pure read queries.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const FIXTURE_DIR = join("supabase", "stage-fixtures")
const FIXTURE_FILES = [
  "finance_accounting_stage_preflight.sql",
  "finance_accounting_postcheck_202.sql",
  "finance_accounting_postcheck_203.sql",
  "finance_accounting_postcheck_204.sql"
]

const FORBIDDEN_PATTERNS = [
  /(?:^|[;\n])\s*CREATE\s+(?:TABLE|TEMP(?:ORARY)?\s+TABLE|OR\s+REPLACE\s+FUNCTION|FUNCTION|INDEX|UNIQUE|SCHEMA|EXTENSION)\b/i,
  /(?:^|[;\n])\s*DROP\s+(?:TABLE|IF\s+EXISTS|FUNCTION|TRIGGER|INDEX|SCHEMA|EXTENSION)\b/i,
  /(?:^|[;\n])\s*ALTER\s+(?:TABLE|FUNCTION|TYPE|SCHEMA)\b/i,
  /(?:^|[;\n]|\))\s*INSERT\s+INTO\b/i,
  /\(\s*INSERT\s+INTO\b/i,
  /(?:^|[;\n])\s*UPDATE\s+[a-zA-Z0-9_."]+\s+SET\b/i,
  /(?:^|[;\n])\s*DELETE\s+FROM\b/i,
  /(?:^|[;\n])\s*TRUNCATE\s+(?:TABLE\s+)?/i,
  /(?:^|[;\n])\s*GRANT\s+/i,
  /(?:^|[;\n])\s*REVOKE\s+/i,
  /(?:^|[;\n])\s*COMMENT\s+ON\b/i,
  /(?:^|[;\n])\s*DO\s+\$/i,
  /(?:^|[;\n])\s*COPY\s+/i
]

const VOLATILE_CALL_PATTERN =
  /\bpublic\.(?:create_|post_|submit_|approve_|reject_|reverse_|replace_|delete_|update_|insert_)[a-z0-9_]+\s*\(/i

/** Catalog/read-only helpers used by fixtures (existence checks, not execution). */
export const ALLOWED_FUNCTION_PATTERNS = [
  "current_setting",
  "to_regclass",
  "to_regprocedure",
  "has_table_privilege",
  "has_function_privilege",
  "coalesce",
  "lower",
  "trim",
  "nullif",
  "exists",
  "count",
  "string_agg",
  "exists (select 1 from pg_extension",
  "information_schema.columns",
  "pg_policies",
  "pg_trigger",
  "pg_class"
]

export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n\r]*/g, "")
}

export function stripSqlStringLiterals(sql) {
  return sql.replace(/'(?:''|[^'])*'/g, "''")
}

export function assertReadOnlyFixtureSql(relativePath, sql) {
  const stripped = stripSqlComments(sql)
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = stripped.match(pattern)
    if (match) {
      throw new Error(`${relativePath} contains forbidden statement near: ${match[0].trim()}`)
    }
  }
  const withoutStrings = stripSqlStringLiterals(stripped)
  const volatileCall = withoutStrings.match(VOLATILE_CALL_PATTERN)
  if (volatileCall) {
    throw new Error(`${relativePath} invokes volatile business function: ${volatileCall[0].trim()}`)
  }
}

export function validateFinanceStageFixtures(rootDir) {
  const dir = join(rootDir, FIXTURE_DIR)
  for (const file of FIXTURE_FILES) {
    const relativePath = join(FIXTURE_DIR, file)
    const sql = readFileSync(join(dir, file), "utf8")
    assertReadOnlyFixtureSql(relativePath, sql)
  }
  const extras = readdirSync(dir).filter(
    (f) => f.endsWith(".sql") && !FIXTURE_FILES.includes(f) && f.startsWith("finance_accounting_")
  )
  for (const file of extras) {
    if (file.includes("stage_smoke") || file.includes("identity_guard")) continue
    const relativePath = join(FIXTURE_DIR, file)
    assertReadOnlyFixtureSql(relativePath, readFileSync(join(dir, file), "utf8"))
  }
}

export function listFixtureFunctionReferences(sql) {
  const stripped = stripSqlComments(stripSqlStringLiterals(sql))
  const refs = new Set()
  for (const match of stripped.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    refs.add(match[1].toLowerCase())
  }
  return [...refs].sort()
}
