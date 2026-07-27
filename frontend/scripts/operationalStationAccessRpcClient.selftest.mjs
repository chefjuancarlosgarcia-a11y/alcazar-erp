import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const accessSvc = read("frontend/src/services/operationalStationAccessService.js")
const accessUi = read("frontend/src/components/OperationalAccessSection.jsx")

const tests = [
  {
    name: "OS2-RPC-1 static singleton supabase import",
    run() {
      if (!/^import \{[^\n]*\bsupabase\b[^\n]*\} from "\.\.\/lib\/supabase"/m.test(accessSvc)) {
        throw new Error("operationalStationAccessService must import supabase from ../lib/supabase")
      }
      if (/await import\("\.\.\/lib\/supabase"\)/.test(accessSvc)) {
        throw new Error("dynamic import leaves supabase undefined for .rpc in preview")
      }
    }
  },
  {
    name: "OS2-RPC-2 admin helpers call supabase.rpc on client",
    run() {
      for (const fn of ["adminSetOperationalPin", "adminAssignOperationalStation", "adminGetOperationalAccessSummary"]) {
        const block = accessSvc.match(new RegExp(`export async function ${fn}\\([\\s\\S]*?^}`, "m"))
        if (!block?.[0]?.includes("supabase.rpc")) {
          throw new Error(`${fn} must invoke supabase.rpc`)
        }
        if (!block[0].includes("ensureRpcClient")) {
          throw new Error(`${fn} must guard RPC client before .rpc`)
        }
      }
    }
  },
  {
    name: "OS2-RPC-3 UI does not expect PIN in RPC response",
    run() {
      if (/data\?\.pin/.test(accessUi)) {
        throw new Error("OperationalAccessSection must not read pin from RPC payload")
      }
      if (!/setGeneratedPin\(pin\)/.test(accessUi)) {
        throw new Error("show client-generated pin once")
      }
    }
  },
  {
    name: "OS2-RPC-4 UI surfaces RPC errors",
    run() {
      if (!/handleGeneratePin[\s\S]*setError/.test(accessUi)) {
        throw new Error("generate pin must set visible error")
      }
      if (!/finally[\s\S]*setBusy\(false\)/.test(accessUi)) {
        throw new Error("handlers must clear busy in finally")
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
