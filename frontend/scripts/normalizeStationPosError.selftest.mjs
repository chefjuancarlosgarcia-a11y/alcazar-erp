import {
  normalizeStationPosError,
  isNormalizedStationPosError,
  stationPosErrorMessage
} from "../src/utils/normalizeStationPosError.js"

const tests = [
  {
    name: "NORM-1 idempotent",
    run() {
      const raw = { message: "STATION_POS_ORDER_OWNER_MISMATCH", code: "P0001" }
      const once = normalizeStationPosError(raw)
      const twice = normalizeStationPosError(once)
      const thrice = normalizeStationPosError(twice)
      if (!isNormalizedStationPosError(once)) throw new Error("not marked normalized")
      if (twice !== once || thrice !== once) throw new Error("must return same object")
      if (once.userMessage !== "Esta mesa está siendo atendida por otro mesero.") {
        throw new Error("owner mismatch message")
      }
    }
  },
  {
    name: "NORM-2 strips nested formatSupabaseError",
    run() {
      const nested = {
        message: "message: message: Operacion no permitida. | details: Sin detalles | hint: Sin sugerencia | code: P0001",
        code: "P0001"
      }
      const out = normalizeStationPosError(nested)
      if (out.userMessage.includes("message:")) throw new Error("nested message prefix leaked")
      if (out.userMessage.includes("| details:")) throw new Error("details leaked")
    }
  },
  {
    name: "NORM-3 audit actor code",
    run() {
      const out = stationPosErrorMessage({ message: "STATION_POS_AUDIT_ACTOR_INVALID", code: "P0001" })
      if (!/mesero/.test(out)) throw new Error("audit actor user message")
    }
  },
  {
    name: "NORM-4 triple apply stable message",
    run() {
      let err = { message: "STATION_POS_FORBIDDEN", code: "P0001" }
      const m1 = stationPosErrorMessage(err)
      err = normalizeStationPosError(err)
      const m2 = stationPosErrorMessage(err)
      err = normalizeStationPosError(err)
      const m3 = stationPosErrorMessage(err)
      if (m1 !== m2 || m2 !== m3) throw new Error(`messages differ: ${m1} / ${m2} / ${m3}`)
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
console.log(`normalizeStationPosError.selftest: ${tests.length} passed`)
