/**
 * Static checks for 199_test_operational_station_pos_catalog_parity.sql
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const testSql = fs.readFileSync(
  path.join(root, "supabase/schema/199_test_operational_station_pos_catalog_parity.sql"),
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
    name: "199-TEST-2 P0001 repro scenario",
    run() {
      if (!/remote_p0001_owner_mismatch_repro/.test(testSql)) throw new Error("repro scenario")
      if (!/station_pos_assert_order_open_for_drafts/.test(testSql)) throw new Error("assert function")
    }
  },
  {
    name: "199-TEST-3 lab flags local only",
    run() {
      if (!/operational_stations_enabled/.test(testSql)) throw new Error("flags in lab")
      if (!/lab_flags_enabled/.test(testSql)) throw new Error("flag scenario")
    }
  },
  {
    name: "199-TEST-4 cleanup fixture ids",
    run() {
      if (!/delete from public.pos_orders/.test(testSql)) throw new Error("order cleanup")
      if (!/19900000-0000-4000-8000-000000000010/.test(testSql)) throw new Error("fixture order id")
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
    name: "199-TEST-5 service_opened static and runtime scenarios",
    run() {
      for (const s of [
        "open_service_opened_insert_static",
        "open_service_opened_type_static",
        "open_service_opened_created_by_operator",
        "open_new_service_opened_once",
        "open_idempotency_replay_no_duplicate_event",
        "open_valid_reuse_no_second_event"
      ]) {
        if (!new RegExp(s).test(testSql)) throw new Error(`missing ${s}`)
      }
      if (!/test_operational_station_pos_open_runtime_199/.test(testSql)) {
        throw new Error("runtime open test function")
      }
      if (!/set_config\('request\.jwt\.claim\.sub', '19900000-0000-4000-8000-000000000030'/.test(testSql)) {
        throw new Error("device jwt for open runtime")
      }
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
