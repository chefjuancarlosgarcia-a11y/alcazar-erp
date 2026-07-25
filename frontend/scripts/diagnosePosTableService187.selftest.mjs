/**
 * Static checks for diagnose_pos_table_service_lifecycle_187.sql (read-only).
 * Run: node frontend/scripts/diagnosePosTableService187.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const sqlPath = resolve(root, "supabase/schema/diagnose_pos_table_service_lifecycle_187.sql")
const sql = readFileSync(sqlPath, "utf8")

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
}

const executable = stripComments(sql)

const forbidden = [
  "CREATE FUNCTION",
  "CREATE OR REPLACE FUNCTION",
  "CREATE TABLE",
  "CREATE VIEW",
  "DROP ",
  "GRANT ",
  "REVOKE ",
  "INSERT ",
  "UPDATE ",
  "DELETE ",
  "DO $$"
]

function extractReportCte(source) {
  const start = source.indexOf("report AS (")
  if (start < 0) return ""
  let depth = 0
  for (let i = start + "report AS (".length; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "(") depth += 1
    else if (ch === ")") {
      if (depth === 0) return source.slice(start + "report AS (".length, i)
      depth -= 1
    }
  }
  return ""
}

const reportCte = extractReportCte(sql)

const tests = [
  {
    name: "report CTE has no consecutive SELECT without UNION ALL",
    run() {
      if (!reportCte) throw new Error("could not extract report CTE")
      const branchStarts = (reportCte.match(/^  SELECT\b/gm) || []).length
      const unionLines = (reportCte.match(/^  UNION ALL\b/gm) || []).length
      if (branchStarts !== unionLines + 1) {
        throw new Error(`report CTE expects ${unionLines + 1} top-level SELECT branches, found ${branchStarts} SELECT and ${unionLines} UNION ALL`)
      }
      const lines = reportCte.split("\n")
      for (let i = 0; i < lines.length - 1; i += 1) {
        if (!/^  FROM /.test(lines[i])) continue
        let j = i + 1
        while (j < lines.length && lines[j].trim() === "") j += 1
        if (j < lines.length && /^  SELECT/.test(lines[j])) {
          const between = lines.slice(i + 1, j).join("\n")
          if (!/^  UNION ALL\b/m.test(between)) {
            throw new Error(`missing UNION ALL after: ${lines[i].trim()}`)
          }
        }
      }
    }
  },
  {
    name: "diagnose SQL is a single statement",
    run() {
      const trimmed = executable.trim()
      if (!trimmed.endsWith(";")) throw new Error("statement must end with semicolon")
      const withoutStrings = trimmed.replace(/'([^']|'')*'/g, "''")
      const semicolons = (withoutStrings.match(/;/g) || []).length
      if (semicolons !== 1) throw new Error(`expected exactly one statement, found ${semicolons} semicolons`)
    }
  },
  {
    name: "diagnose SQL has no mutating or DDL statements",
    run() {
      for (const word of forbidden) {
        if (executable.toUpperCase().includes(word.toUpperCase())) {
          throw new Error(`forbidden token found: ${word.trim()}`)
        }
      }
    }
  },
  {
    name: "diagnose SQL ends with single projected SELECT result set",
    run() {
      const matches = [...executable.matchAll(/\bSELECT\b/gi)]
      if (matches.length < 1) throw new Error("expected at least one SELECT")
      const finalSelectIdx = executable.lastIndexOf("SELECT")
      const tail = executable.slice(finalSelectIdx)
      if (!/^SELECT[\s\S]*FROM report[\s\S]*ORDER BY[\s\S]*order_id NULLS LAST;\s*$/i.test(tail.trim())) {
        throw new Error("final result set must be SELECT ... FROM report ORDER BY projected columns")
      }
    }
  },
  {
    name: "diagnose ORDER BY uses projected columns only",
    run() {
      const orderBy = executable.match(/ORDER BY([\s\S]*?);/i)?.[1] || ""
      if (/bucket/i.test(orderBy)) throw new Error("ORDER BY must not reference bucket alias")
      for (const col of ["section", "gate_code", "classification", "operational_state", "risk_level", "table_id", "created_at", "order_id"]) {
        if (!orderBy.includes(col)) throw new Error(`ORDER BY missing ${col}`)
      }
    }
  },
  {
    name: "diagnose separates operational_state and risk_level",
    run() {
      if (!/operational_state/.test(sql) || !/risk_level/.test(sql)) {
        throw new Error("missing dual classification dimensions")
      }
      if (!/pending_release_total/.test(sql)) throw new Error("missing pending_release_total summary")
      if (!/pending_release_with_kds_history/.test(sql)) throw new Error("missing pending_release_with_kds_history summary")
    }
  },
  {
    name: "table-service summaries use dine_in_active not enriched",
    run() {
      const summaryBlock = sql.slice(sql.indexOf("report AS ("), sql.indexOf("SELECT\n  section,"))
      const dineInSummaries = [
        "pending_release_empty_no_history",
        "pending_release_total",
        "active_billing_total"
      ]
      for (const gate of dineInSummaries) {
        const re = new RegExp(`'${gate}'[\\s\\S]{0,220}FROM dine_in_active`, "i")
        if (!re.test(summaryBlock)) {
          throw new Error(`summary ${gate} must count FROM dine_in_active`)
        }
        const bad = new RegExp(`'${gate}'[\\s\\S]{0,220}FROM enriched`, "i")
        if (bad.test(summaryBlock)) {
          throw new Error(`summary ${gate} must not count FROM enriched`)
        }
      }
    }
  },
  {
    name: "table-service sections use dine_in_active scope",
    run() {
      const sections = [
        { label: "pending_release", marker: "'pending_release'," },
        { label: "billing", marker: "'billing'," }
      ]
      for (const { label, marker } of sections) {
        const start = sql.indexOf(marker)
        if (start < 0) throw new Error(`missing section ${label}`)
        const chunk = sql.slice(start, start + 700)
        if (!/FROM dine_in_active/.test(chunk)) {
          throw new Error(`section ${label} must read FROM dine_in_active`)
        }
        if (/FROM enriched/.test(chunk)) {
          throw new Error(`section ${label} must not read FROM enriched`)
        }
      }
    }
  },
  {
    name: "non_dine_in_channels section exists",
    run() {
      if (!/'non_dine_in_channels'/.test(sql)) throw new Error("missing non_dine_in_channels section")
      if (!/non_dine_in_active AS/.test(sql)) throw new Error("missing non_dine_in_active CTE")
    }
  },
  {
    name: "global total metric explicitly named",
    run() {
      if (!/'global_total_active_status_orders'/.test(sql)) {
        throw new Error("missing global_total_active_status_orders gate_code")
      }
    }
  },
  {
    name: "diagnose Q3 duplicates scoped to dine_in",
    run() {
      if (!/dine_in_active AS/.test(sql)) throw new Error("missing dine_in_active CTE")
      if (!/in_dine_in_table_service_scope/.test(sql)) {
        throw new Error("missing canonical in_dine_in_table_service_scope flag")
      }
      if (!/duplicate_tables AS \([\s\S]*FROM dine_in_active/.test(sql)) {
        throw new Error("duplicate_tables must use dine_in_active scope")
      }
    }
  },
  {
    name: "diagnose includes Q3 gate active_service_duplicates",
    run() {
      if (!/'active_service_duplicates'/.test(sql)) {
        throw new Error("missing Q3 gate_code active_service_duplicates")
      }
    }
  },
  {
    name: "diagnose includes evidence order section",
    run() {
      if (!/'evidence_4e6ba009'/.test(sql)) {
        throw new Error("missing evidence_4e6ba009 section")
      }
      if (!/4e6ba009-84ae-421e-9c6b-3217b3863dca/.test(sql)) {
        throw new Error("missing evidence UUID")
      }
    }
  },
  {
    name: "diagnose UNION ALL branches share report wrapper",
    run() {
      if (!/report AS \(/i.test(sql)) throw new Error("missing report CTE wrapper")
      const unionCount = (executable.match(/UNION ALL/gi) || []).length
      if (unionCount < 10) throw new Error(`expected many UNION ALL branches, found ${unionCount}`)
    }
  }
]

let passed = 0
for (const test of tests) {
  try {
    test.run()
    passed += 1
    console.log(`OK ${test.name}`)
  } catch (error) {
    console.error(`FAIL ${test.name}: ${error.message}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${tests.length} passed`)
