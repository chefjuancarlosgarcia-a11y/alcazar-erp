import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8")

const mig200 = read("supabase/schema/200_fix_station_pos_audit_actor.sql")
const test200 = read("supabase/schema/200_test_station_pos_audit_actor.sql")
const lab200 = read("supabase/schema/200_lab_station_pos_audit_actor_runtime.sql")
const pre200 = read("supabase/schema/diagnose_station_pos_audit_actor_preflight_200.sql")
const post200 = read("supabase/schema/diagnose_station_pos_audit_actor_postflight_200.sql")
const rollback = read("supabase/rollback/200_fix_station_pos_audit_actor.rollback.sql")
const normalizeJs = read("frontend/src/utils/normalizeStationPosError.js")
const posOrders = read("frontend/src/services/posOrdersService.js")
const posPage = read("frontend/src/pages/POS.jsx")
const stationCss = read("frontend/src/pages/StationPosEntry.css")
const posCss = read("frontend/src/pages/POS.css")
const quickSearch = read("frontend/src/components/PosProductQuickSearch.jsx")

const tests = [
  {
    name: "200-1 single transaction",
    run() {
      if (!/^\s*begin;\s*$/im.test(mig200.split("\n").find((l) => /^begin;/i.test(l.trim())) ? "begin;" : "")) {
        if (!/^begin;/im.test(mig200)) throw new Error("transaction BEGIN")
      }
      if (!/commit;\s*$/im.test(mig200.trim())) throw new Error("transaction COMMIT")
    }
  },
  {
    name: "200-2 actor helper internal",
    run() {
      if (!/pos_order_event_actor_profile/.test(mig200)) throw new Error("helper")
      if (!/revoke all on function public\.pos_order_event_actor_profile/.test(mig200)) throw new Error("revoke")
      if (!/STATION_POS_AUDIT_ACTOR_INVALID/.test(mig200)) throw new Error("error code")
    }
  },
  {
    name: "200-3 audit uses order owner",
    run() {
      if (!/owner_profile_id/.test(mig200)) throw new Error("owner_profile_id")
      if (!/waiter_id/.test(mig200)) throw new Error("waiter_id")
      if (/create table public\.profiles/.test(mig200)) throw new Error("no profile creation")
    }
  },
  {
    name: "200-4 remote test safe",
    run() {
      if (/session_replication_role/.test(test200)) throw new Error("no replication role in remote test")
      if (/insert into auth\.users/.test(test200)) throw new Error("no auth.users in remote test")
      if (!/rollback;/.test(test200)) throw new Error("ROLLBACK")
      if (!/failed_total/.test(test200)) throw new Error("summary grid")
    }
  },
  {
    name: "200-5 lab asserts no technical profile",
    run() {
      if (!/no_technical_profile/.test(lab200)) throw new Error("lab assertion")
      if (!/delete from public\.profiles where id = v_technical/.test(lab200)) throw new Error("explicit delete")
    }
  },
  {
    name: "200-6 pre/postflight grid",
    run() {
      if (!/gate_code/.test(pre200) || !/ready_to_apply_200/.test(pre200)) throw new Error("preflight")
      if (!/ready_after_200/.test(post200)) throw new Error("postflight")
    }
  },
  {
    name: "200-7 rollback restores auth.uid audit",
    run() {
      if (!/auth\.uid\(\)/.test(rollback)) throw new Error("rollback auth.uid")
    }
  },
  {
    name: "200-8 frontend normalizer",
    run() {
      if (!/normalizeStationPosError/.test(normalizeJs)) throw new Error("normalizer")
      if (!/STATION_POS_AUDIT_ACTOR_INVALID/.test(normalizeJs)) throw new Error("audit code mapping")
      if (!/extractRpcErrorText/.test(posOrders)) throw new Error("no formatSupabaseError wrap in mapper")
    }
  },
  {
    name: "200-9 POS uses normalizer",
    run() {
      if (!/stationPosErrorMessage/.test(posPage)) throw new Error("POS normalizer")
      if (/formatSupabaseError\(created\.error\)/.test(posPage)) throw new Error("no formatSupabaseError in add path")
    }
  },
  {
    name: "200-10 scroll single owner",
    run() {
      if (!/height:\s*100dvh/.test(stationCss)) throw new Error("shell height")
      if (!/overflow-y:\s*auto/.test(stationCss)) throw new Error("shell scroll")
      const stationWorkspace = posCss.match(/\.station-pos-entry--active \.pos-classic-workspace-body\s*\{[^}]+\}/)
      if (!stationWorkspace) throw new Error("station workspace rule")
      if (/overflow-y:\s*auto/.test(stationWorkspace[0])) throw new Error("nested scroll")
      if (!/overflow:\s*visible/.test(stationWorkspace[0])) throw new Error("visible flow")
    }
  },
  {
    name: "200-11 search input controlled",
    run() {
      if (!/type="text"/.test(quickSearch)) throw new Error("text input not search type")
      if (!/stationMode/.test(quickSearch)) throw new Error("stationMode prop")
      if (!/setQuery\(""\)/.test(quickSearch)) throw new Error("reset on mount")
    }
  },
  {
    name: "200-12 no session_replication in 200 forward",
    run() {
      if (/session_replication_role/.test(mig200)) throw new Error("no replication in forward fix")
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
console.log(`operationalStations200AuditActor.selftest: ${tests.length} passed`)
