/**
 * Static checks for 199 remote-safe structural test + lab runtime separation.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const testSql = fs.readFileSync(
  path.join(root, "supabase/schema/199_test_operational_station_pos_catalog_parity.sql"),
  "utf8"
)
const labSql = fs.readFileSync(
  path.join(root, "supabase/schema/199_lab_operational_station_pos_catalog_parity_runtime.sql"),
  "utf8"
)
const labRunner = fs.readFileSync(
  path.join(root, "scripts/run-parity-lab-199.mjs"),
  "utf8"
)
const mig199 = fs.readFileSync(
  path.join(root, "supabase/schema/199_fix_operational_station_pos_catalog_parity.sql"),
  "utf8"
)
const stationPos = fs.readFileSync(
  path.join(root, "frontend/src/services/stationPosService.js"),
  "utf8"
)
const postflight = fs.readFileSync(
  path.join(root, "supabase/schema/diagnose_operational_station_pos_catalog_postflight_199.sql"),
  "utf8"
)

const REMOTE_FORBIDDEN = [
  { label: "session_replication_role", pattern: /session_replication_role/i },
  { label: "auth.users DML", pattern: /\b(insert|update|delete)\s+into\s+auth\.users\b/i },
  { label: "ALTER TABLE trigger toggle", pattern: /alter\s+table[\s\S]*?trigger/i },
  { label: "app_settings UPDATE", pattern: /\bupdate\s+public\.app_settings\b/i },
  { label: "cc199 fixture DML", pattern: /\bcc199-/i },
  { label: "operational_stations_enabled write", pattern: /set\s+value[\s\S]*operational_stations_enabled/i },
  { label: "operational_station_pos_enabled write", pattern: /set\s+value[\s\S]*operational_station_pos_enabled/i },
  { label: "pos_orders INSERT", pattern: /\binsert\s+into\s+public\.pos_orders\b/i },
  { label: "pos_products INSERT", pattern: /\binsert\s+into\s+public\.pos_products\b/i },
  { label: "operational_stations INSERT", pattern: /\binsert\s+into\s+public\.operational_stations\b/i }
]

function sqlWithoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n\r]*/g, "")
}

const tests = [
  {
    name: "199-TEST-1 begin rollback no commit",
    run() {
      if (!/^begin;/im.test(testSql)) throw new Error("BEGIN")
      if (!/^rollback;/im.test(testSql)) throw new Error("ROLLBACK")
      if (/^commit;/im.test(testSql)) throw new Error("no COMMIT")
    }
  },
  {
    name: "199-TEST-2 single grid with failed_total",
    run() {
      if (!/scenario_rows/.test(testSql)) throw new Error("scenario_rows")
      if (!/failed_total/.test(testSql)) throw new Error("failed_total")
      if (!/cross join summary/.test(testSql)) throw new Error("summary cross join")
      if ((testSql.match(/;\s*\n\s*select/mg) || []).length > 1) {
        throw new Error("expected one result grid")
      }
    }
  },
  {
    name: "199-TEST-3 remote test forbids unsafe patterns",
    run() {
      const executable = sqlWithoutComments(testSql)
      for (const { label, pattern } of REMOTE_FORBIDDEN) {
        if (pattern.test(executable)) throw new Error(`remote test must not contain ${label}`)
      }
    }
  },
  {
    name: "199-TEST-4 remote structural checks present",
    run() {
      for (const token of [
        "pg_proc",
        "proconfig",
        "catalog_batch_image_url",
        "catalog_no_n_plus_one_image_rpc",
        "assert_owner_error_code",
        "assert_not_open_error_code",
        "open_service_opened_insert",
        "open_service_opened_type",
        "open_service_opened_created_by_operator",
        "open_replay_before_resolve",
        "operational_stations_enabled_false",
        "operational_station_pos_enabled_false"
      ]) {
        if (!testSql.includes(token)) throw new Error(`missing ${token}`)
      }
    }
  },
  {
    name: "199-TEST-5 lab runtime separated",
    run() {
      if (!/199_lab_operational_station_pos_catalog_parity_runtime/.test(labRunner)) {
        throw new Error("lab runner must invoke lab runtime SQL")
      }
      if (!/runtime 20\/20/.test(labRunner)) throw new Error("lab runner documents 20/20")
      if (!/session_replication_role/.test(labSql)) throw new Error("lab retains elevated fixtures")
      if (!/remote_p0001_owner_mismatch_repro/.test(labSql)) throw new Error("lab owner mismatch runtime")
      if (!/open_new_service_opened_once/.test(labSql)) throw new Error("lab service_opened runtime")
    }
  },
  {
    name: "199-MIG-1 differentiated errors",
    run() {
      if (!/STATION_POS_ORDER_OWNER_MISMATCH/.test(mig199)) throw new Error("owner code")
      if (!/STATION_POS_ORDER_NOT_OPEN/.test(mig199)) throw new Error("not open code")
    }
  },
  {
    name: "199-MIG-2 batch image_url no N+1",
    run() {
      if (!/image_url/.test(mig199)) throw new Error("batch image_url in catalog RPC")
      if (/get_pos_product_image_url/.test(mig199)) throw new Error("no per-product image RPC in SQL")
      if (/get_pos_product_image_url/.test(stationPos)) throw new Error("station service must not N+1 images")
    }
  },
  {
    name: "199-MIG-3 open preserves service_opened event",
    run() {
      if (!/insert into public\.pos_order_events/.test(mig199)) throw new Error("pos_order_events insert")
      if (!/'service_opened'/.test(mig199)) throw new Error("service_opened event_type")
      if (!/v_operator_id/.test(mig199)) throw new Error("created_by v_operator_id")
    }
  },
  {
    name: "199-PREFLIGHT-1 service_opened gate",
    run() {
      const preflight = fs.readFileSync(
        path.join(root, "supabase/schema/diagnose_operational_station_pos_catalog_preflight_199.sql"),
        "utf8"
      )
      if (!/baseline_open_preserves_service_opened/.test(preflight)) throw new Error("baseline gate")
      if (!/ready_to_apply_199/.test(preflight)) throw new Error("ready boolean")
      if (!/199_partial/.test(preflight)) throw new Error("partial blocker")
    }
  },
  {
    name: "199-PREFLIGHT-2 search_path via pg_proc not functiondef",
    run() {
      const preflight = fs.readFileSync(
        path.join(root, "supabase/schema/diagnose_operational_station_pos_catalog_preflight_199.sql"),
        "utf8"
      )
      const securityGates = [
        "open_security_definer_search_path",
        "assert_security_definer_search_path",
        "catalog_security_definer_search_path"
      ]
      for (const gate of securityGates) {
        if (!preflight.includes(gate)) throw new Error(`missing ${gate}`)
      }
      if (/pg_get_functiondef\([^)]+\)[^;]*ilike[^;]*search_path/is.test(preflight)) {
        throw new Error("must not detect search_path via pg_get_functiondef")
      }
      if (!/pg_proc/.test(preflight)) throw new Error("must inspect pg_proc")
      if (!/prosecdef/.test(preflight)) throw new Error("must inspect prosecdef")
      if (!/proconfig/.test(preflight)) throw new Error("must inspect proconfig")
    }
  },
  {
    name: "199-POSTFLIGHT-1 read-only single grid",
    run() {
      if (!/^begin;/im.test(postflight)) throw new Error("BEGIN")
      if (!/^rollback;/im.test(postflight)) throw new Error("ROLLBACK")
      if (/^commit;/im.test(postflight)) throw new Error("no COMMIT")
      if (!/ready_after_199/.test(postflight)) throw new Error("ready_after_199")
      if (!/failed_total/.test(postflight)) throw new Error("failed_total")
      for (const { label, pattern } of REMOTE_FORBIDDEN) {
        if (pattern.test(sqlWithoutComments(postflight))) throw new Error(`postflight must not contain ${label}`)
      }
    }
  }
]

let failed = 0
for (const t of tests) {
  try {
    t.run()
    console.log(`PASS ${t.name}`)
  } catch (e) {
    failed += 1
    console.error(`FAIL ${t.name}: ${e.message}`)
  }
}
if (failed) process.exit(1)
console.log(`operationalStations199TestSql.selftest: ${tests.length} passed`)
