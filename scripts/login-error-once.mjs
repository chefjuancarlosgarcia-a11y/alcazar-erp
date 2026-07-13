import { chromium } from "playwright"
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto("http://localhost:5173/login")
await page.fill('input[type="email"]', "admin@example.com")
await page.fill('input[type="password"]', "admin")
await page.click('button[type="submit"]')
await page.waitForTimeout(4000)
const errors = await page.locator("p").evaluateAll((els) =>
  els.map((e) => e.textContent?.trim()).filter(Boolean)
)
console.log("All p texts:", errors)
console.log("URL:", page.url())
await browser.close()
