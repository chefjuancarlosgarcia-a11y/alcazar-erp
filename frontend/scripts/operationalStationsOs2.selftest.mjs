import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const sql193 = read("supabase/schema/193_operational_operator_access_foundation.sql")
const edgeAccess = read("supabase/functions/operational-station-access/index.ts")
const authCtx = read("frontend/src/context/AuthContext.jsx")
const stationCash = read("frontend/src/pages/StationCashEntry.jsx")
const accessSvc = read("frontend/src/services/operationalStationAccessService.js")
const auditDoc = read("docs/os2-cash-operator-audit-and-design.md")

const tests = [
  {
    name: "OS2-1 migration tables",
    run() {
      for (const t of [
        "operational_credentials",
        "operational_station_assignments",
        "operational_operator_sessions",
        "operational_pin_attempt_buckets"
      ]) {
        if (!new RegExp(`create table if not exists public.${t}`).test(sql193)) {
          throw new Error(`missing table ${t}`)
        }
      }
    }
  },
  {
    name: "OS2-2 pin never plain in credentials table",
    run() {
      if (/pin_plain|plain_pin/.test(sql193)) throw new Error("plain pin column forbidden")
      if (!/pin_hash/.test(sql193) || !/pin_lookup/.test(sql193)) throw new Error("hash+lookup required")
    }
  },
  {
    name: "OS2-2b pepper in server-only secrets table",
    run() {
      if (/insert into public\.app_settings[\s\S]*operational_pin_pepper/.test(sql193)) {
        throw new Error("pepper must not use app_settings")
      }
      if (!/operational_security_secrets/.test(sql193)) throw new Error("operational_security_secrets required")
    }
  },
  {
    name: "OS2-3 verify derives device auth.uid not client station",
    run() {
      if (!/resolve_operational_device_for_auth_user/.test(sql193)) throw new Error("device resolver")
      if (/p_station_id/.test(sql193.match(/verify_operational_pin_for_device[\s\S]*?\$\$;/)?.[0] || "")) {
        throw new Error("verify must not accept p_station_id")
      }
    }
  },
  {
    name: "OS2-4 idle 90 seconds cash module",
    run() {
      if (!/v_idle_seconds int := 90/.test(sql193)) throw new Error("90s idle")
    }
  },
  {
    name: "OS2-5 edge verify_jwt path requires Authorization",
    run() {
      if (!/Bearer /.test(edgeAccess)) throw new Error("edge requires bearer")
      if (!/verify_pin/.test(edgeAccess)) throw new Error("verify_pin action")
    }
  },
  {
    name: "OS2-6 operator token sessionStorage only",
    run() {
      if (!/sessionStorage/.test(accessSvc)) throw new Error("sessionStorage")
      if (/localStorage/.test(accessSvc)) throw new Error("no localStorage for operator token")
    }
  },
  {
    name: "OS2-7 AuthContext station device context",
    run() {
      if (!/stationDeviceContext/.test(authCtx)) throw new Error("stationDeviceContext state")
      if (!/get_operational_station_device_context/.test(authCtx)) throw new Error("RPC on missing profile")
    }
  },
  {
    name: "OS2-8 station cash PIN UI no name before verify",
    run() {
      if (!/Ingrese su PIN/.test(stationCash)) throw new Error("PIN prompt")
      if (/Operando como/.test(stationCash.split("sessionToken &&")[0] || stationCash)) {
        throw new Error("operator name must not show before auth")
      }
    }
  },
  {
    name: "OS2-9 audit doc present",
    run() {
      if (!/operational_operator_sessions/.test(auditDoc)) throw new Error("design doc")
    }
  },
  {
    name: "OS2-10 generic pin failure message",
    run() {
      if (!/PIN o acceso no valido/i.test(sql193)) throw new Error("generic SQL message")
    }
  },
  {
    name: "OS2-11 access edge deno lock reproducible",
    run() {
      const lock = read("supabase/functions/operational-station-access/deno.lock")
      const readme = read("supabase/functions/operational-station-access/README.md")
      if (!/"version": "4"/.test(lock)) throw new Error("deno.lock v4 for Deno 2.2.3")
      if (!/deno check index.ts/.test(readme) || /--no-lock/.test(readme)) {
        throw new Error("README must document lock-enabled check")
      }
      if (!/supabase-js@2\.106\.1/.test(read("supabase/functions/operational-station-access/deno.json"))) {
        throw new Error("pinned supabase-js")
      }
    }
  }
]

let passed = 0
for (const t of tests) {
  try {
    t.run()
    passed += 1
    console.log(`OK ${t.name}`)
  } catch (e) {
    console.error(`FAIL ${t.name}:`, e.message)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length}`)
if (process.exitCode) process.exit(process.exitCode)
