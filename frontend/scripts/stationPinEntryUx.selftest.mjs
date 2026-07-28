import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const stationEntry = fs.readFileSync(
  path.join(repoRoot, "frontend/src/pages/StationCashEntry.jsx"),
  "utf8"
)
const accessSvc = fs.readFileSync(
  path.join(repoRoot, "frontend/src/services/operationalStationAccessService.js"),
  "utf8"
)

const pinFormBlock = stationEntry.match(/<form className="station-cash-pin-form"[\s\S]*?<\/form>/)?.[0] || ""

const tests = [
  {
    name: "PINUX-1 four visible cells aria-hidden",
    run() {
      if (!/Array\.from\(\{ length: PIN_LENGTH \}/.test(stationEntry)) {
        throw new Error("four cells")
      }
      if (!/aria-hidden="true"/.test(pinFormBlock)) throw new Error("cells aria-hidden")
    }
  },
  {
    name: "PINUX-2 single password input attrs",
    run() {
      if (!/type="password"/.test(pinFormBlock)) throw new Error("password type")
      if (!/inputMode="numeric"/.test(pinFormBlock)) throw new Error("numeric inputMode")
      if (!/pattern="\[0-9\]\*"/.test(pinFormBlock)) throw new Error("digit pattern")
      if (!/maxLength=\{PIN_LENGTH\}/.test(pinFormBlock)) throw new Error("maxLength 4")
      if (!/aria-label="PIN operativo de 4 dígitos"/.test(pinFormBlock)) {
        throw new Error("aria-label")
      }
      if (!/autoComplete="off"/.test(pinFormBlock)) throw new Error("autocomplete off")
    }
  },
  {
    name: "PINUX-3 filled shows bullet not digit in DOM",
    run() {
      if (!/\{pin\[index\] \? "●" : ""\}/.test(pinFormBlock)) throw new Error("bullet mask")
      if (/pin\[index\]\}/.test(pinBlock.replace(/\{pin\[index\] \? "●" : ""\}/g, ""))) {
        throw new Error("must not render raw digit in cells")
      }
    }
  },
  {
    name: "PINUX-4 normalize digits and paste",
    run() {
      if (!/normalizePinDigits/.test(stationEntry)) throw new Error("normalize helper")
      if (!/onPaste=\{handlePinPaste\}/.test(pinFormBlock)) throw new Error("paste handler")
      if (!/replace\(\/\\D\/g/.test(stationEntry)) throw new Error("non-digits stripped")
    }
  },
  {
    name: "PINUX-5 no auto submit on fourth digit",
    run() {
      const onChangeBlock = stationEntry.match(/function handlePinChange[\s\S]*?\n  \}/)?.[0] || ""
      if (/submitPin/.test(onChangeBlock)) throw new Error("change handler must not verify")
      if (/next\.length === 4/.test(onChangeBlock)) throw new Error("no auto submit on fourth digit")
    }
  },
  {
    name: "PINUX-6 enter and button gated",
    run() {
      if (!/canSubmitPin/.test(stationEntry)) throw new Error("canSubmitPin gate")
      if (!/disabled=\{!canSubmitPin\}/.test(pinFormBlock)) throw new Error("submit disabled")
      if (!/event\.key !== "Enter"/.test(stationEntry)) throw new Error("Enter handler")
    }
  },
  {
    name: "PINUX-7 busy validating state",
    run() {
      if (!/Validando…/.test(pinFormBlock)) throw new Error("Validando copy")
      if (!/disabled=\{busy\}/.test(pinFormBlock)) throw new Error("input disabled while busy")
    }
  },
  {
    name: "PINUX-8 error clears and refocuses",
    run() {
      if (!/setPin\(""\)/.test(stationEntry.match(/submitPin[\s\S]*?\n  \}, \[busy/)?.[0] || "")) {
        throw new Error("clear pin on failure")
      }
      if (!/focusPinInput\(\)/.test(stationEntry)) throw new Error("refocus on error")
      if (!/GENERIC_PIN_ERROR/.test(stationEntry)) throw new Error("generic error constant")
    }
  },
  {
    name: "PINUX-9 progress aria live",
    run() {
      if (!/de 4 dígitos ingresados/.test(pinFormBlock)) throw new Error("progress text")
      if (!/aria-live="polite"/.test(pinFormBlock)) throw new Error("aria-live")
    }
  },
  {
    name: "PINUX-10 no pin in storage or logs",
    run() {
      if (/localStorage\.(set|get)Item\([^)]*pin/i.test(stationEntry)) {
        throw new Error("no localStorage pin")
      }
      if (/sessionStorage\.(set|get)Item\([^)]*pin/i.test(stationEntry)) {
        throw new Error("no sessionStorage pin in entry")
      }
      if (/console\.(log|debug|info)\([^)]*pin/i.test(stationEntry)) {
        throw new Error("no console pin")
      }
      if (/localStorage/.test(accessSvc.match(/verifyOperationalPin[\s\S]*?\n\}/)?.[0] || accessSvc)) {
        // verify path uses sessionStorage for token only — ensure no pin key
        if (/pin/i.test(accessSvc.match(/saveOperatorSession[\s\S]*?sessionStorage/)?.[0] || "")) {
          throw new Error("access service must not persist pin")
        }
      }
    }
  },
  {
    name: "PINUX-11 idle touch regression",
    run() {
      if (!/shouldSendOperatorTouch/.test(stationEntry)) throw new Error("idle touch preserved")
      if (/setInterval\s*\(\s*debouncedTouch/.test(stationEntry)) {
        throw new Error("no periodic touch interval")
      }
    }
  }
]

let failed = 0
for (const t of tests) {
  try {
    t.run()
    console.log(`PASS ${t.name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL ${t.name}: ${err.message}`)
  }
}

if (failed > 0) process.exit(1)
console.log(`stationPinEntryUx.selftest: ${tests.length} passed`)
