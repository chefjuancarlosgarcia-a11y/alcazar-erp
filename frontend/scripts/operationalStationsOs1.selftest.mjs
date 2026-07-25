import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

function grepOs1(rel, pattern) {
  const text = read(rel)
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "g")
  return [...text.matchAll(re)].map((m) => m[0])
}

const sql190 = read("supabase/schema/190_operational_stations_foundation.sql")
const edge = read("supabase/functions/operational-station-enroll/index.ts")
const svc = read("frontend/src/services/operationalStationsService.js")
const enrollPage = read("frontend/src/pages/StationEnroll.jsx")
const settingsPage = read("frontend/src/pages/OperationalStationsSettings.jsx")
const routes = read("frontend/src/routes/AppRoutes.jsx")
const pos = read("frontend/src/pages/POS.jsx")

const tests = [
  {
    name: "1 flag default off",
    run() {
      if (!/"enabled",\s*false/.test(sql190) && !/'enabled',\s*false/.test(sql190)) {
        throw new Error("default not false")
      }
    }
  },
  {
    name: "2 no createSession in edge",
    run() {
      if (/createSession/.test(edge)) throw new Error("forbidden createSession")
    }
  },
  {
    name: "3 authorize edge no createUser",
    run() {
      const authStart = edge.indexOf('if (action === "authorize")')
      const completeStart = edge.indexOf('if (action === "complete")')
      const authorizeBlock = edge.slice(authStart, completeStart)
      const completeBlock = edge.slice(completeStart)
      if (/createUser/.test(authorizeBlock)) throw new Error("authorize must not createUser")
      if (!/createUser/.test(completeBlock)) throw new Error("complete must createUser")
    }
  },
  {
    name: "4 password not persisted in SQL",
    run() {
      if (/ephemeral_sign_in_secret|take_enrollment_sign_in_secret|store_enrollment_sign_in_secret/.test(sql190)) {
        throw new Error("secret persistence RPC/column still present")
      }
    }
  },
  {
    name: "5 take_enrollment_sign_in_secret absent",
    run() {
      if (/take_enrollment_sign_in_secret/.test(edge + svc + sql190)) {
        throw new Error("take RPC referenced")
      }
    }
  },
  {
    name: "6 QR uses hash fragment token=",
    run() {
      if (!/#token=/.test(svc)) throw new Error("buildEnrollmentUrl must use #token=")
      if (/\?token=/.test(svc)) throw new Error("query token forbidden in service")
    }
  },
  {
    name: "7 token stripped from URL",
    run() {
      if (!/replaceState/.test(enrollPage)) throw new Error("missing replaceState")
      if (!/get\("token"\)/.test(enrollPage)) throw new Error("must read token from fragment")
    }
  },
  {
    name: "8 enrollment QR token not in web storage",
    run() {
      if (/localStorage\.(setItem|getItem).*token/i.test(enrollPage)) {
        throw new Error("enrollment token must not use localStorage")
      }
      if (/sessionStorage.*#token|sessionStorage.*enrollment_token/i.test(enrollPage + svc)) {
        throw new Error("enrollment token must not use sessionStorage")
      }
    }
  },
  {
    name: "9 Idempotency-Key required in edge",
    run() {
      if (!/requireIdempotencyKey/.test(edge)) throw new Error("missing idempotency helper")
      if (!/x-idempotency-key/.test(edge)) throw new Error("missing header check")
    }
  },
  {
    name: "10 rate limit in edge",
    run() {
      if (!/rateLimit/.test(edge)) throw new Error("missing rate limit")
    }
  },
  {
    name: "11 admin role server-side",
    run() {
      const authBlock = edge.slice(edge.indexOf('action === "authorize"'))
      if (!/is_operational_stations_admin/.test(authBlock)) {
        throw new Error("authorize must call is_operational_stations_admin RPC")
      }
    }
  },
  {
    name: "12 lifecycle authorized in SQL",
    run() {
      if (!/authorize_station_device_enrollment/.test(sql190)) throw new Error("missing authorize RPC")
      if (!/'authorized'/.test(sql190)) throw new Error("missing authorized status")
      if (!/finalize_station_device_enrollment/.test(sql190)) throw new Error("missing finalize RPC")
    }
  },
  {
    name: "13 reject sets blocked enrollment",
    run() {
      if (!/status = 'blocked'/.test(sql190)) throw new Error("reject must block enrollment")
    }
  },
  {
    name: "14 blocked device cannot complete (status gate)",
    run() {
      if (!/p_claim_secret_hash/.test(sql190)) throw new Error("status must require claim secret hash")
      if (!/device_claim_secret/.test(edge)) throw new Error("complete must send device_claim_secret")
      if (/ready_to_complete/.test(edge)) throw new Error("ready_to_complete must not gate complete")
      if (!/status !== "authorized"/.test(edge)) throw new Error("complete must require authorized status")
    }
  },
  {
    name: "15 revoked/inactive paths in authorize SQL",
    run() {
      if (!/inactive.*revoked/.test(sql190)) throw new Error("station inactive/revoked check expected")
    }
  },
  {
    name: "16 one active device index",
    run() {
      if (!/operational_station_devices_one_active_per_station_idx/.test(sql190)) {
        throw new Error("missing unique active index")
      }
    }
  },
  {
    name: "17 compensation deleteUser + fail enrollment",
    run() {
      const completeBlock = edge.slice(edge.indexOf('if (action === "complete")'))
      const signInPos = completeBlock.indexOf("signInWithPassword")
      const finalizePos = completeBlock.indexOf("finalize_station_device_enrollment")
      if (signInPos < 0 || finalizePos < 0 || signInPos > finalizePos) {
        throw new Error("order must be signIn before finalize")
      }
      if (!/fail_station_device_enrollment/.test(edge)) throw new Error("missing fail RPC calls")
      if (!/deleteUser/.test(edge)) throw new Error("missing deleteUser compensation")
    }
  },
  {
    name: "18 flag off default no POS hook",
    run() {
      if (/operational_stations|operational_station/.test(pos)) {
        throw new Error("POS should not reference OS1 yet")
      }
    }
  },
  {
    name: "19 POS/KDS unchanged gate",
    run() {
      if (/operational_credentials|open_pos_operator_session/.test(pos)) {
        throw new Error("POS touched for OS2+")
      }
    }
  },
  {
    name: "20 no service_role in frontend OS1",
    run() {
      if (/service_role|SERVICE_ROLE/i.test(svc + settingsPage + enrollPage)) {
        throw new Error("service role in frontend")
      }
    }
  },
  {
    name: "21 no console.log in edge enroll",
    run() {
      if (/console\.(log|debug|info)/.test(edge)) throw new Error("console logging in edge")
    }
  },
  {
    name: "22 admin routes and enroll public",
    run() {
      if (!routes.includes("/settings/operational-stations")) throw new Error("missing admin route")
      if (!routes.includes("/station-enroll")) throw new Error("missing enroll route")
      if (!/canManage|gerente_general/.test(settingsPage)) throw new Error("settings admin gate")
    }
  },
  {
    name: "rollback forward-only",
    run() {
      const rb = read("supabase/rollback/190_operational_stations_foundation.rollback.sql")
      if (/drop table/i.test(rb)) throw new Error("destructive rollback")
    }
  },
  {
    name: "CS1 status RPC requires claim_secret_hash param",
    run() {
      const block = sql190.slice(sql190.indexOf("get_device_enrollment_status"))
      if (!/p_claim_secret_hash text/.test(block.slice(0, 500))) {
        throw new Error("status signature must use claim secret hash")
      }
      if (/p_client_fingerprint/.test(block.slice(0, 500))) {
        throw new Error("fingerprint must not authenticate status")
      }
    }
  },
  {
    name: "CS2 finalize requires claim secret not fingerprint",
    run() {
      const fn = sql190.split("finalize_station_device_enrollment")[1]?.slice(0, 600) || ""
      if (!/p_claim_secret_hash text/.test(fn)) throw new Error("finalize must take claim secret hash")
      if (/p_client_fingerprint/.test(fn)) throw new Error("finalize must not use fingerprint auth")
    }
  },
  {
    name: "CS3 claim stores hash only in SQL",
    run() {
      if (!/claim_secret_hash/.test(sql190)) throw new Error("missing claim_secret_hash column")
      if (/claim_secret_plain|device_claim_secret text/.test(sql190)) throw new Error("plain claim secret column forbidden")
    }
  },
  {
    name: "CS4 edge claim returns device_claim_secret once",
    run() {
      if (!/device_claim_secret/.test(edge)) throw new Error("edge must return device_claim_secret")
      if (!/Uint8Array\(32\)/.test(edge)) throw new Error("edge must generate 256-bit secret")
    }
  },
  {
    name: "CS5 fingerprint not in status/complete body auth",
    run() {
      const statusBlock = edge.slice(edge.indexOf('action === "status"'), edge.indexOf('action === "authorize"'))
      const completeBlock = edge.slice(edge.indexOf('action === "complete"'))
      if (/client_fingerprint/.test(statusBlock)) throw new Error("status must not send fingerprint")
      if (/client_fingerprint/.test(completeBlock)) throw new Error("complete must not send fingerprint")
    }
  },
  {
    name: "CS6 sessionStorage for claim secret only",
    run() {
      if (!/sessionStorage/.test(enrollPage + svc)) throw new Error("claim secret must use sessionStorage")
      if (!/saveDeviceClaimSecret|loadDeviceClaimSecret|clearDeviceClaimSecret/.test(svc + enrollPage)) {
        throw new Error("missing claim secret storage helpers")
      }
    }
  },
  {
    name: "CS7 claim secret cleared after complete",
    run() {
      if (!/clearDeviceClaimSecret|clearClaimSession/.test(enrollPage)) {
        throw new Error("must clear claim secret after complete")
      }
    }
  },
  {
    name: "CS8 authorize response has no claim secret",
    run() {
      const authBlock = edge.slice(edge.indexOf('action === "authorize"'), edge.indexOf('action === "complete"'))
      if (/device_claim_secret|claim_secret/.test(authBlock)) throw new Error("authorize must not expose claim secret")
    }
  },
  {
    name: "CS9 complete Cache-Control no-store",
    run() {
      if (!/Cache-Control/.test(edge) || !/no-store/.test(edge)) throw new Error("missing Cache-Control no-store")
      if (!/Pragma/.test(edge)) throw new Error("missing Pragma no-cache")
    }
  },
  {
    name: "CS10 complete minimal response no session object",
    run() {
      const completeBlock = edge.slice(edge.indexOf('action === "complete"'))
      if (/session:\s*signInData\.session/.test(completeBlock)) throw new Error("must not return full session object")
    }
  },
  {
    name: "CS11 CORS Vary Origin",
    run() {
      if (!/Vary:\s*"Origin"|Vary: "Origin"/.test(edge)) throw new Error("missing Vary Origin")
    }
  },
  {
    name: "CS12 enroll page referrer no-referrer",
    run() {
      if (!/no-referrer/.test(enrollPage)) throw new Error("missing referrer policy on enroll page")
    }
  },
  {
    name: "CS13 persistent attempt lock in SQL",
    run() {
      if (!/device_claim_attempt_count/.test(sql190)) throw new Error("missing attempt counter")
      if (!/record_operational_enrollment_secret_attempt/.test(sql190)) throw new Error("missing attempt RPC")
    }
  },
  {
    name: "CS14 verify consumes claim secret on finalize",
    run() {
      if (!/claim_secret_consumed_at/.test(sql190)) throw new Error("missing consumed_at")
      if (!/claim_secret_hash = null/.test(sql190)) throw new Error("hash must be cleared on consume")
    }
  },
  {
    name: "CS15 status minimal public statuses",
    run() {
      if (!/waiting_authorization/.test(sql190)) throw new Error("missing waiting_authorization mapping")
      if (/ready_to_complete/.test(sql190)) throw new Error("ready_to_complete must not be in SQL response")
    }
  },
  {
    name: "CS16 get_operational_station_device_context requires active",
    run() {
      if (!/auth_user_id = auth\.uid\(\) and status = 'active'/.test(sql190)) throw new Error("device context must require active device")
      if (!/v_station\.status <> 'active'/.test(sql190)) throw new Error("device context must require active station")
    }
  },
  {
    name: "CS17 no legacy password RPC",
    run() {
      const bundle = sql190 + edge + svc + enrollPage
      if (/take_enrollment_sign_in_secret|store_enrollment_sign_in_secret|ephemeral_sign_in_secret/.test(bundle)) {
        throw new Error("legacy password persistence found")
      }
    }
  },
  {
    name: "CS18 enrollment token 128 bits",
    run() {
      if (!/gen_random_bytes\(16\)/.test(sql190)) throw new Error("enrollment token must be >=128 bits")
    }
  },
  {
    name: "CS19 complete requires device_claim_secret in service",
    run() {
      if (!/device_claim_secret/.test(svc)) throw new Error("service must pass device_claim_secret")
    }
  },
  {
    name: "CS20 status invalid without secret in edge",
    run() {
      const statusBlock = edge.slice(edge.indexOf('action === "status"'), edge.indexOf('action === "authorize"'))
      if (!/if \(!claimSecret\)/.test(statusBlock)) throw new Error("status must reject missing secret")
    }
  },
  {
    name: "CS21 complete invalid without secret in edge",
    run() {
      const completeBlock = edge.slice(edge.indexOf('action === "complete"'))
      if (!/if \(!claimSecret\)/.test(completeBlock)) throw new Error("complete must reject missing secret")
    }
  },
  {
    name: "CS22 finalize after signIn tokens only if finalize ok",
    run() {
      const completeBlock = edge.slice(edge.indexOf('action === "complete"'))
      const finalizePos = completeBlock.indexOf("finalize_station_device_enrollment")
      const returnTokenPos = completeBlock.indexOf("access_token")
      if (returnTokenPos < finalizePos) throw new Error("tokens must not be returned before finalize")
    }
  },
  {
    name: "CS23 unknown action rejected at end of edge handler",
    run() {
      if (!/return genericInvalid\(origin\)\s*\n\}\)/.test(edge.slice(-400))) {
        throw new Error("handler must fall through to genericInvalid")
      }
    }
  },
  {
    name: "CS24 authorize always getUser and is_operational_stations_admin",
    run() {
      const authorizeBlock = edge.slice(edge.indexOf('action === "authorize"'), edge.indexOf('action === "complete"'))
      if (!/auth\.getUser\(\)/.test(authorizeBlock)) throw new Error("authorize needs getUser")
      if (!/is_operational_stations_admin/.test(authorizeBlock)) {
        throw new Error("authorize needs admin RPC")
      }
    }
  },
  {
    name: "CS25 edge does not dynamic RPC name from payload",
    run() {
      if (/payload\.(rpc|function)/i.test(edge)) throw new Error("dynamic RPC selection forbidden")
      if (/\.rpc\(\s*String\(payload/.test(edge)) throw new Error("dynamic RPC forbidden")
    }
  },
  {
    name: "CS26 status and complete require claim secret",
    run() {
      const statusBlock = edge.slice(edge.indexOf('action === "status"'), edge.indexOf('action === "authorize"'))
      const completeBlock = edge.slice(edge.indexOf('action === "complete"'))
      if (!/device_claim_secret/.test(statusBlock)) throw new Error("status needs claim secret")
      if (!/device_claim_secret/.test(completeBlock)) throw new Error("complete needs claim secret")
    }
  },
  {
    name: "CS27 complete uses service adminClient rpc not client-selected RPC",
    run() {
      const completeBlock = edge.slice(edge.indexOf('action === "complete"'))
      if (!/adminClient\.rpc\(\s*["']finalize_station_device_enrollment["']/.test(completeBlock)) {
        throw new Error("finalize must be fixed name on adminClient")
      }
    }
  },
  {
    name: "CS28 runbook documents verify_jwt false and no-verify-jwt deploy",
    run() {
      const runbook = read("docs/os1-preproduction-application-runbook.md")
      if (!/verify_jwt = false/i.test(runbook)) throw new Error("runbook must document verify_jwt false")
      if (!/--no-verify-jwt/.test(runbook)) throw new Error("runbook must document --no-verify-jwt")
    }
  }
]

let passed = 0
for (const t of tests) {
  try {
    t.run()
    passed += 1
    console.log(`OK ${t.name}`)
  } catch (error) {
    console.error(`FAIL ${t.name}:`, error.message)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length}`)
if (process.exitCode) process.exit(process.exitCode)
