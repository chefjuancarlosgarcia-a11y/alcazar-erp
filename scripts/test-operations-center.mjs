/**
 * ERP Operations Center V1 — browser automation checklist
 * Run: node scripts/test-operations-center.mjs
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE = "http://localhost:5173"
const DOWNLOAD_DIR = path.join(process.cwd(), "scripts", ".test-downloads")

const ADMIN_CANDIDATES = [
  { email: "admin@example.com", password: "admin", label: "admin@example.com / admin" },
  { email: "admin@alcazar.local", password: "admin", label: "admin@alcazar.local / admin" },
  { email: "admin@alcazar.local", password: "Admin123!", label: "admin@alcazar.local / Admin123!" },
]

const NON_ADMIN_CANDIDATES = [
  { email: "claudia@example.com", password: "admin", label: "claudia@example.com (gerente_general)" },
  { email: "kimberly@example.com", password: "admin", label: "kimberly@example.com (rrhh)" },
  { email: "claudia.barrios.07@gmail.com", password: "admin", label: "claudia.barrios.07@gmail.com" },
]

const results = []

function record(id, status, evidence) {
  results.push({ id, status, evidence })
  console.log(`[${status}] ${id}: ${evidence}`)
}

async function waitForAuth(page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const url = page.url()
    if (!url.includes("/login")) return true
    await page.waitForTimeout(400)
  }
  return false
}

async function tryLogin(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(800)
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2500)
  return !page.url().includes("/login")
}

async function collectConsoleErrors(page) {
  const errors = []
  page.on("pageerror", (err) => errors.push(String(err.message || err)))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  return errors
}

async function main() {
  await mkdir(DOWNLOAD_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  })

  // --- Unauthenticated baseline ---
  {
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (e) => errors.push(e.message))

    await page.goto(`${BASE}/operations-center`, { waitUntil: "networkidle", timeout: 20000 })
    const url = page.url()
    if (url.includes("/login")) {
      record("0-unauth-redirect", "PASS", `Unauthenticated /operations-center → ${url}`)
    } else {
      record("0-unauth-redirect", "FAIL", `Expected /login redirect, got ${url}`)
    }

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
    const homeOk = (await page.title()) || page.url().startsWith(BASE)
    record("0-home-loads", homeOk ? "PASS" : "FAIL", `Home loads: ${page.url()}, title="${await page.title()}"`)

    await page.close()
  }

  // --- Login as admin ---
  let adminPage = null
  let adminLoggedIn = false
  let adminLabel = ""

  for (const cred of ADMIN_CANDIDATES) {
    const page = await context.newPage()
    const ok = await tryLogin(page, cred)
    if (ok) {
      adminPage = page
      adminLoggedIn = true
      adminLabel = cred.label
      break
    }
    await page.close()
  }

  if (!adminLoggedIn) {
    record("1-admin-access", "BLOCKED", `Could not login with any admin candidate: ${ADMIN_CANDIDATES.map((c) => c.label).join("; ")}`)
    record("2-non-admin-blocked", "BLOCKED", "No admin session to compare; non-admin login also required")
    record("3-events-after-navigation", "BLOCKED", "Requires admin login")
    record("4-clear-local-logs", "BLOCKED", "Requires admin login")
    record("5-export-diagnostics", "BLOCKED", "Requires admin login")
    record("6-pos-loads", "BLOCKED", "Requires authenticated user with pos access")
    record("6-cash-loads", "BLOCKED", "Requires authenticated user with cash access")
    record("6-production-loads", "BLOCKED", "Requires authenticated user with production access")

    await browser.close()
    printSummary()
    return
  }

  record("login-admin", "PASS", `Logged in as ${adminLabel}`)

  // --- Test 1: Admin access ---
  {
    await adminPage.goto(`${BASE}/operations-center`, { waitUntil: "networkidle", timeout: 20000 })
    const url = adminPage.url()
    const hasHeading = await adminPage.locator("h1", { hasText: "ERP Operations Center" }).isVisible().catch(() => false)
    const hasClearBtn = await adminPage.getByRole("button", { name: "Limpiar logs locales" }).isVisible().catch(() => false)
    if (url.includes("/operations-center") && hasHeading && hasClearBtn) {
      record("1-admin-access", "PASS", `Admin at ${url}, heading + actions visible`)
    } else {
      record("1-admin-access", "FAIL", `url=${url}, heading=${hasHeading}, clearBtn=${hasClearBtn}`)
    }
  }

  // --- Test 2: Non-admin blocked ---
  {
    let nonAdminOk = false
    let nonAdminLabel = ""
    for (const cred of NON_ADMIN_CANDIDATES) {
      const page = await context.newPage()
      const ok = await tryLogin(page, cred)
      if (ok) {
        nonAdminOk = true
        nonAdminLabel = cred.label
        await page.goto(`${BASE}/operations-center`, { waitUntil: "networkidle", timeout: 20000 })
        await page.waitForTimeout(1000)
        const url = page.url()
        const onOpsCenter = url.includes("/operations-center")
        const hasOpsHeading = await page.locator("h1", { hasText: "ERP Operations Center" }).isVisible().catch(() => false)
        if (!onOpsCenter || !hasOpsHeading) {
          record("2-non-admin-blocked", "PASS", `${nonAdminLabel} redirected away from OC → ${url}`)
        } else {
          record("2-non-admin-blocked", "FAIL", `${nonAdminLabel} still on Operations Center at ${url}`)
        }
        await page.close()
        break
      }
      await page.close()
    }
    if (!nonAdminOk) {
      record("2-non-admin-blocked", "BLOCKED", `Could not login non-admin: ${NON_ADMIN_CANDIDATES.map((c) => c.label).join("; ")}`)
    }
  }

  // --- Test 3: Events after navigation ---
  {
    await adminPage.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 20000 })
    await adminPage.waitForTimeout(1500)
    await adminPage.goto(`${BASE}/inventory`, { waitUntil: "networkidle", timeout: 20000 })
    await adminPage.waitForTimeout(2000)
    await adminPage.goto(`${BASE}/operations-center`, { waitUntil: "networkidle", timeout: 20000 })
    await adminPage.waitForTimeout(2000)

    const eventRows = adminPage.locator(".operations-center-panel tbody tr")
    const emptyMsg = adminPage.locator(".operations-center-empty")
    const rowCount = await eventRows.count()
    const hasEmpty = await emptyMsg.isVisible().catch(() => false)
    const kpiText = await adminPage.locator(".operations-kpi").first().textContent().catch(() => "")

    if (rowCount > 0) {
      record("3-events-after-navigation", "PASS", `${rowCount} event row(s) in timeline after dashboard+inventory navigation`)
    } else if (!hasEmpty) {
      record("3-events-after-navigation", "PASS", `Events area populated (KPI section visible: "${kpiText?.trim().slice(0, 60)}")`)
    } else {
      const storageEvents = await adminPage.evaluate(() => {
        try {
          const raw = localStorage.getItem("alcazar:operations-center:v1")
          return raw ? JSON.parse(raw).length : 0
        } catch {
          return -1
        }
      })
      if (storageEvents > 0) {
        record("3-events-after-navigation", "FAIL", `localStorage has ${storageEvents} events but UI shows empty state`)
      } else {
        record("3-events-after-navigation", "FAIL", "No events in UI or localStorage after module navigation")
      }
    }
  }

  // --- Test 4: Clear local logs ---
  {
    await adminPage.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" })
    await adminPage.waitForTimeout(1000)
    await adminPage.goto(`${BASE}/operations-center`, { waitUntil: "networkidle" })
    await adminPage.waitForTimeout(1500)

    const beforeCount = await adminPage.evaluate(() => {
      try {
        const raw = localStorage.getItem("alcazar:operations-center:v1")
        return raw ? JSON.parse(raw).length : 0
      } catch {
        return 0
      }
    })

    await adminPage.getByRole("button", { name: "Limpiar logs locales" }).click()
    await adminPage.waitForTimeout(800)

    const afterCount = await adminPage.evaluate(() => {
      try {
        const raw = localStorage.getItem("alcazar:operations-center:v1")
        return raw ? JSON.parse(raw).length : 0
      } catch {
        return 0
      }
    })
    const emptyVisible = await adminPage.locator(".operations-center-empty").isVisible().catch(() => false)

    if (afterCount === 0 && (beforeCount > 0 || emptyVisible)) {
      record("4-clear-local-logs", "PASS", `localStorage events ${beforeCount} → ${afterCount}, empty UI=${emptyVisible}`)
    } else if (afterCount === 0) {
      record("4-clear-local-logs", "PASS", `localStorage cleared (${beforeCount} → 0)`)
    } else {
      record("4-clear-local-logs", "FAIL", `After clear: localStorage=${afterCount}, before=${beforeCount}`)
    }
  }

  // --- Test 5: Export diagnostics JSON ---
  {
    await adminPage.goto(`${BASE}/operations-center`, { waitUntil: "networkidle" })
    const downloadPromise = adminPage.waitForEvent("download", { timeout: 10000 }).catch(() => null)
    await adminPage.getByRole("button", { name: "Exportar diagnóstico JSON" }).click()
    const download = await downloadPromise

    if (download) {
      const filename = download.suggestedFilename()
      const savePath = path.join(DOWNLOAD_DIR, filename)
      await download.saveAs(savePath)
      const isJson = filename.endsWith(".json")
      record("5-export-diagnostics", isJson ? "PASS" : "FAIL", `Download triggered: ${filename}`)
    } else {
      record("5-export-diagnostics", "FAIL", "No download event after clicking export button")
    }
  }

  // --- Test 6: POS, Cash, Production load ---
  const moduleTests = [
    { id: "6-pos-loads", path: "/pos", marker: "pos" },
    { id: "6-cash-loads", path: "/cash", marker: "cash" },
    { id: "6-production-loads", path: "/production", marker: "production" },
  ]

  for (const mod of moduleTests) {
    const page = adminPage
    const errors = []
    const onError = (msg) => errors.push(msg)
    page.removeAllListeners("pageerror")
    page.removeAllListeners("console")
    page.on("pageerror", onError)
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })

    try {
      await page.goto(`${BASE}${mod.path}`, { waitUntil: "networkidle", timeout: 25000 })
      await page.waitForTimeout(2000)
      const url = page.url()
      const onLogin = url.includes("/login")
      const bodyText = await page.locator("body").innerText().catch(() => "")
      const hasFatal = /Cargando sesión|No tienes acceso|Error fatal/i.test(bodyText) && bodyText.length < 200
      const criticalErrors = errors.filter(
        (e) => !/favicon|404|Failed to load resource|net::ERR/i.test(e)
      )

      if (onLogin) {
        record(mod.id, "FAIL", `Redirected to login from ${mod.path}`)
      } else if (hasFatal) {
        record(mod.id, "FAIL", `${mod.path} shows blocking message: ${bodyText.slice(0, 120)}`)
      } else if (criticalErrors.length > 0) {
        record(mod.id, "FAIL", `${mod.path} console errors: ${criticalErrors.slice(0, 2).join(" | ")}`)
      } else {
        record(mod.id, "PASS", `${mod.path} loaded at ${url}, no critical console errors (${errors.length} filtered)`)
      }
    } catch (err) {
      record(mod.id, "FAIL", `${mod.path} navigation error: ${err.message}`)
    }
  }

  await browser.close()
  printSummary()
}

function printSummary() {
  console.log("\n=== ERP Operations Center V1 — Test Results ===\n")
  for (const r of results) {
    console.log(`${r.status.padEnd(7)} | ${r.id}`)
    console.log(`         ${r.evidence}\n`)
  }
  const pass = results.filter((r) => r.status === "PASS").length
  const fail = results.filter((r) => r.status === "FAIL").length
  const blocked = results.filter((r) => r.status === "BLOCKED").length
  console.log(`Totals: PASS=${pass} FAIL=${fail} BLOCKED=${blocked}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
