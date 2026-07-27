import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const sql193 = read("supabase/schema/193_operational_operator_access_foundation.sql")
const preflight = read("supabase/schema/diagnose_operational_operator_access_preflight_193.sql")
const postflight = read("supabase/schema/diagnose_operational_operator_access_postflight_193.sql")
const app043 = read("supabase/schema/043_app_settings_branding.sql")
const app175 = read("supabase/schema/175_rls_active_profile_guard.sql")
const appSettingsSvc = read("frontend/src/services/appSettingsService.js")
const stationsSvc = read("frontend/src/services/operationalStationsService.js")

const tests = [
  {
    name: "SEC-1 pepper not inserted into app_settings",
    run() {
      if (/insert into public\.app_settings[\s\S]*operational_pin_pepper/.test(sql193)) {
        throw new Error("193 must not store pepper in app_settings")
      }
    }
  },
  {
    name: "SEC-2 operational_security_secrets table",
    run() {
      if (!/create table if not exists public\.operational_security_secrets/.test(sql193)) {
        throw new Error("missing secrets table")
      }
      if (!/revoke all on table public\.operational_security_secrets/.test(sql193)) {
        throw new Error("must revoke client access on secrets table")
      }
    }
  },
  {
    name: "SEC-3 pepper helper reads secrets table",
    run() {
      const fn = sql193.match(/operational_pin_pepper_value[\s\S]*?\$\$;/)?.[0] || ""
      if (!/operational_security_secrets/.test(fn)) throw new Error("pepper from secrets table")
      if (/app_settings/.test(fn)) throw new Error("pepper must not read app_settings")
    }
  },
  {
    name: "SEC-4 lookup uses hmac",
    run() {
      if (!sql193.includes("extensions.hmac")) throw new Error("pin_lookup must use extensions.hmac")
      if (/public\.hmac/.test(sql193)) throw new Error("no public.hmac")
    }
  },
  {
    name: "SEC-4b canonical 193 no public pgcrypto",
    run() {
      if (/public\.(digest|crypt|gen_salt)\s*\(/i.test(sql193)) {
        throw new Error("193 must use extensions.* for digest/crypt/gen_salt")
      }
    }
  },
  {
    name: "SEC-5 admin_set_operational_pin omits pin in JSON",
    run() {
      const fn = sql193.match(/admin_set_operational_pin[\s\S]*?\$\$;/)?.[0] || ""
      if (/'pin',\s*v_pin/.test(fn)) throw new Error("admin must not return plaintext pin")
    }
  },
  {
    name: "SEC-6 preflight blocks app_settings pepper key",
    run() {
      if (!/app_settings_no_operational_pin_pepper/.test(preflight)) {
        throw new Error("preflight gate missing")
      }
    }
  },
  {
    name: "SEC-7 postflight secret ACL gates",
    run() {
      for (const g of [
        "secret_storage_table_exists",
        "secret_storage_clients_denied",
        "app_settings_no_operational_pin_pepper"
      ]) {
        if (!postflight.includes(g)) throw new Error(`missing postflight gate ${g}`)
      }
    }
  },
  {
    name: "SEC-8 app_settings authenticated SELECT policy exists",
    run() {
      if (!/app_settings_read_authenticated/.test(app043 + app175)) {
        throw new Error("expected authenticated read policy on app_settings")
      }
      if (!/grant select on public\.app_settings to authenticated/.test(app043)) {
        throw new Error("grant select authenticated")
      }
    }
  },
  {
    name: "SEC-9 frontend branding reads single key only",
    run() {
      if (!/BRANDING_SETTINGS_KEY/.test(appSettingsSvc)) throw new Error("branding key constant")
      if (/operational_pin/.test(appSettingsSvc)) throw new Error("frontend must not query pepper")
    }
  },
  {
    name: "SEC-10 operational_stations_enabled via RPC",
    run() {
      if (!/rpc\("operational_stations_enabled"\)/.test(stationsSvc)) {
        throw new Error("flag via RPC not direct table")
      }
    }
  }
]

let passed = 0
for (const t of tests) {
  try {
    t.run()
    passed++
    console.log(`OK ${t.name}`)
  } catch (e) {
    console.error(`FAIL ${t.name}: ${e.message}`)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length}`)
