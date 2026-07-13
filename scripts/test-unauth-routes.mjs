/**
 * Unauthenticated + login diagnostic (no credential brute-force)
 */
import { chromium } from "playwright"

const BASE = "http://localhost:5173"
const results = []

function record(id, status, evidence) {
  results.push({ id, status, evidence })
  console.log(`[${status}] ${id}: ${evidence}`)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  for (const path of ["/pos", "/cash", "/production", "/dashboard"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 15000 })
    await page.waitForTimeout(1200)
    const url = page.url()
    record(`unauth-${path}`, url.includes("/login") ? "PASS" : "FAIL", `${path} → ${url}`)
  }

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(800)
  const loginTitle = await page.locator("h1").first().textContent().catch(() => "")
  record("login-page", loginTitle ? "PASS" : "FAIL", `Login form visible: "${loginTitle?.trim()}"`)

  // Single login attempt with documented test account from IMPLEMENTATION_CHECKLIST
  await page.fill('input[type="email"]', "admin@example.com")
  await page.fill('input[type="password"]', "admin")
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3500)
  const afterUrl = page.url()
  const bodyText = await page.locator("body").innerText()
  const errorLine = bodyText
    .split("\n")
    .find((l) => /credencial|contraseña|sesión|error|verificacion|Supabase|bloqueado/i.test(l)) || "(no error message visible)"
  record(
    "login-attempt",
    afterUrl.includes("/login") ? "BLOCKED" : "PASS",
    afterUrl.includes("/login")
      ? `Login failed — stayed on /login. Message: ${errorLine.slice(0, 100)}`
      : `Login succeeded → ${afterUrl}`
  )

  await browser.close()

  console.log("\n--- Supplementary results ---")
  for (const r of results) console.log(`${r.status.padEnd(7)} | ${r.id}\n         ${r.evidence}`)
}

main()
