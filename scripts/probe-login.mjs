import { chromium } from "playwright"

const BASE = "http://localhost:5173"

const CANDIDATES = [
  ["admin@example.com", "admin"],
  ["admin@alcazar.local", "admin"],
  ["admin@alcazar.local", "Admin123!"],
  ["claudia@example.com", "admin"],
  ["claudia.barrios.07@gmail.com", "admin"],
  ["claudia.barrios.07@gmail.com", "Claudia123!"],
  ["aramirez046@gmail.com", "admin"],
  ["talento.rrhhxela@gmail.com", "admin"],
  ["ejemplo@gmail.com", "admin"],
]

async function probe() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`${BASE}/login`)
  await page.waitForTimeout(1000)

  const supabaseConfigured = await page.evaluate(() => {
    const url = import.meta?.env?.VITE_SUPABASE_URL
    return Boolean(url)
  }).catch(() => null)

  // Read env from page source / network - check debug panel visibility
  const hasDebug = await page.getByText("Probar Supabase Auth").isVisible().catch(() => false)

  for (const [email, password] of CANDIDATES) {
    await page.goto(`${BASE}/login`)
    await page.waitForTimeout(600)
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(3000)
    const url = page.url()
    const errorEl = page.locator('[style*="color"]').filter({ hasText: /credencial|sesión|contraseña|error|verificacion|Supabase/i })
    const errorText = await page.locator("p").allTextContents().then((txts) =>
      txts.find((t) => /credencial|contraseña|sesión|error|verificacion|bloqueado|Supabase/i.test(t)) || ""
    )
    console.log(JSON.stringify({ email, password, url, error: errorText.slice(0, 120), loggedIn: !url.includes("/login") }))
  }

  await browser.close()
}

probe()
