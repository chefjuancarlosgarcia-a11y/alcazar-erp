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
      if (!/gates_base\s*\(\s*gate_code,\s*gate_passed,\s*blocker_when_failed,\s*detail\s*\)/.test(pre200)) {
        throw new Error("preflight gates_base")
      }
      if (!/blocker_when_failed and not gate_passed/.test(pre200)) throw new Error("preflight is_blocker formula")
      if (!/cross join ready r/.test(pre200)) throw new Error("preflight ready cross join")
      if (!/bool_and\(gate_passed\)/.test(pre200)) throw new Error("preflight ready bool_and")
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
  },
  {
    name: "200-13 preflight no constant is_blocker",
    run() {
      if (/\btrue\s+as\s+is_blocker\b/i.test(pre200)) throw new Error("constant true is_blocker")
      if (/\bfalse\s+as\s+is_blocker\b/i.test(pre200)) throw new Error("constant false is_blocker")
      if (/\'ready_to_apply_200\'/.test(pre200) && /union all[\s\S]*ready_to_apply_200[\s\S]*gates_base/.test(pre200)) {
        throw new Error("ready must not be a gate row")
      }
    }
  },
  {
    name: "200-14 preflight ready not migration_state only",
    run() {
      if (/ready_to_apply_200[\s\S]*migration_state[\s\S]*= 'needs_200'[\s\S]*;\s*$/.test(pre200)) {
        throw new Error("ready only migration_state")
      }
      if (!/200-P6-audit_safe_search_path/.test(pre200)) throw new Error("search_path gate")
      const searchPathGate = pre200.match(/200-P6-audit_safe_search_path[\s\S]*?(?=union all|,\s*\n\s*gates as)/i)?.[0] || ""
      if (!/true,/.test(searchPathGate) || !/unsafe or missing empty search_path/.test(searchPathGate)) {
        throw new Error("search_path must be blocker")
      }
      if (!/200-P4-migration_state_not_partial/.test(pre200)) throw new Error("partial blocker gate")
    }
  },
  {
    name: "200-15 postflight gate-safe ready",
    run() {
      if (/\btrue\s+as\s+is_blocker\b/i.test(post200)) throw new Error("constant true is_blocker")
      if (!/gates_base/.test(post200)) throw new Error("postflight gates_base")
      if (!/blocker_when_failed and not gate_passed/.test(post200)) throw new Error("postflight is_blocker formula")
      if (!/cross join ready r/.test(post200)) throw new Error("postflight ready cross join")
      if (!/bool_and\(gate_passed\)/.test(post200)) throw new Error("postflight ready bool_and")
      if (!/200-F7-audit_security_definer_search_path/.test(post200)) throw new Error("audit search_path gate")
      if (!/200-F8-actor_security_definer_search_path/.test(post200)) throw new Error("actor search_path gate")
      if (!/200-F10-audit_signature_preserved/.test(post200)) throw new Error("audit signature gate")
    }
  },
  {
    name: "200-16 preflight already_applied not blocker",
    run() {
      if (!/200-P3-migration_state_needs_200/.test(pre200)) throw new Error("needs_200 gate")
      if (!/Already applied — do not reapply/.test(pre200)) throw new Error("already applied detail")
      const needsGate = pre200.match(/200-P3-migration_state_needs_200[\s\S]*?(?=union all)/i)?.[0] || ""
      if (!/=\s*'needs_200',\s*\n\s*false,/.test(needsGate)) {
        throw new Error("needs_200 gate must not block when already applied")
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
console.log(`operationalStations200AuditActor.selftest: ${tests.length} passed`)
