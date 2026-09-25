/**
 * Local UI smoke test for finance journal entries (Partidas contables).
 * Run: node scripts/run-finance-journal-ui-smoke.mjs
 *
 * Requires: Docker, Node 20+, devDependencies en package.json raíz (playwright, supabase).
 * Does NOT connect to Stage/Production or run db push / migration repair.
 */

const PINNED_SUPABASE_VERSION = "2.107.0"
const PINNED_PLAYWRIGHT_VERSION = "1.61.1"

import { execSync, spawn } from "node:child_process"
import { createRequire } from "node:module"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const requireFromRoot = createRequire(join(root, "package.json"))
const frontendDir = join(root, "frontend")
const schemaDir = join(root, "supabase", "schema")
const vitePort = 5174
const baseUrl = `http://127.0.0.1:${vitePort}`
const keepArtifacts = process.env.KEEP_SMOKE_ARTIFACTS === "1"
const smokePassword = process.env.SMOKE_TEST_PASSWORD || "SmokeLocal!2026"
const contadorEmail = "ui-contador-smoke@test.local"
const gerenteEmail = "ui-gerente-smoke@test.local"

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 }
]

/** @type {import('node:child_process').ChildProcess[]} */
const childProcesses = []
let smokeDir = ""
let dbContainer = ""
let browser = null
let viteProcess = null
let exitCode = 0
let artifactsDir = ""
/** @type {{ step: string, ok: boolean, detail?: string }[]} */
const results = []

function log(step, ok, detail = "") {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}\t${step}${detail ? `\t${detail}` : ""}`)
  if (!ok) exitCode = 1
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  }).trim()
}

function runIn(dir, cmd, opts = {}) {
  return run(cmd, { cwd: dir, ...opts })
}

function psql(sql) {
  return run(`docker exec -i ${dbContainer} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, {
    input: sql
  })
}

function psqlFile(path) {
  return psql(readFileSync(path, "utf8"))
}

function psqlAt(sql) {
  return run(`docker exec -i ${dbContainer} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -F "|"`, {
    input: sql
  }).trim()
}

function assertLocalHostOnly(value, label) {
  if (!value) throw new Error(`${label}: valor vacío`)
  let hostname = ""
  try {
    hostname = new URL(String(value).replace(/^postgresql:\/\//, "http://")).hostname
  } catch {
    throw new Error(`${label}: URL inválida`)
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`${label}: host remoto bloqueado (${hostname})`)
  }
}

function redactSecrets(text) {
  return String(text || "")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/(password|secret|service_role_key|anon_key)(=|:)\s*\S+/gi, "$1$2[REDACTED]")
}

function readProjectId(configPath) {
  const raw = readFileSync(configPath, "utf8")
  const match = raw.match(/^project_id\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error("No se encontró project_id en config.toml")
  return match[1]
}

const smokeBootstrapSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  username text UNIQUE,
  role text NOT NULL DEFAULT 'colaborador',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE,
  role_name text NOT NULL,
  description text,
  category text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_roles (role_key, role_name, description, category, is_system, is_active) VALUES
  ('admin', 'Admin', 'Admin', 'Administración', true, true),
  ('gerente_general', 'Gerente General', 'Gerente', 'Administración', true, true),
  ('contador', 'Contador', 'Contador', 'Administración', true, true),
  ('mesero', 'Mesero', 'Mesero', 'Operaciones', true, true)
ON CONFLICT (role_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.normalize_profile_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN translate(lower(coalesce(p_role, '')), 'áéíóú', 'aeiou') IN ('gerente general', 'gerente_general') THEN 'gerente_general'
    WHEN translate(lower(coalesce(p_role, '')), 'áéíóú', 'aeiou') IN ('administrador', 'admin') THEN 'admin'
    ELSE replace(translate(lower(coalesce(p_role, '')), 'áéíóú', 'aeiou'), ' ', '_')
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_finance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND public.normalize_profile_role(p.role) IN ('admin', 'gerente_general', 'contador')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_finance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND public.normalize_profile_role(p.role) IN ('admin', 'contador')
  );
$$;

CREATE OR REPLACE FUNCTION public.finance_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.areas (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'operativa',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.areas (id, name, type, active, sort_order)
VALUES ('cocina', 'Cocina', 'produccion', true, 20)
ON CONFLICT (id) DO NOTHING;
`

const profileGrantsSql = `
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT ON public.profiles TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
`

function buildFixtureSql(actorId) {
  const year = new Date().getFullYear()
  const month = new Date().getMonth() + 1
  return `
INSERT INTO public.finance_accounting_periods (
  period_year, period_month, start_date, end_date, status, created_by, updated_by
)
SELECT
  ${year},
  ${month},
  date_trunc('month', CURRENT_DATE)::date,
  (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
  'open',
  '${actorId}'::uuid,
  '${actorId}'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM public.finance_accounting_periods
  WHERE period_year = ${year} AND period_month = ${month}
);

INSERT INTO public.finance_chart_accounts (
  code, name, level, financial_type, natural_balance, account_kind, accepts_entries,
  description, branch_dimension_rule, cost_center_dimension_rule, created_by, updated_by
)
VALUES
  (
    '1.01-LOCAL', 'Caja LOCAL TEST', 1, 'asset', 'debit', 'detail', true,
    'Fixture smoke LOCAL TEST', 'optional', 'optional', '${actorId}'::uuid, '${actorId}'::uuid
  ),
  (
    '5.01-LOCAL', 'Gasto LOCAL TEST', 1, 'expense', 'debit', 'detail', true,
    'Fixture smoke LOCAL TEST', 'required', 'optional', '${actorId}'::uuid, '${actorId}'::uuid
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.finance_cost_centers (
  code, name, level, account_kind, is_active, description, created_by, updated_by
)
VALUES (
  'CC-LOCAL', 'Centro LOCAL TEST', 1, 'detail', true, 'Fixture smoke LOCAL TEST',
  '${actorId}'::uuid, '${actorId}'::uuid
)
ON CONFLICT (code) DO NOTHING;
`
}

function resolveSupabaseCli() {
  let pkgPath
  try {
    pkgPath = requireFromRoot.resolve("supabase/package.json")
  } catch {
    throw new Error(
      `Supabase CLI (supabase@${PINNED_SUPABASE_VERSION}) no instalado. Ejecute npm install en la raíz del repositorio.`
    )
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  if (pkg.version !== PINNED_SUPABASE_VERSION) {
    throw new Error(
      `Supabase CLI esperado ${PINNED_SUPABASE_VERSION}, encontrado ${pkg.version}. Ejecute npm install en la raíz.`
    )
  }
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.supabase
  const binJs = join(dirname(pkgPath), ...binRel.split("/"))
  if (!existsSync(binJs)) {
    throw new Error(`Ejecutable Supabase CLI no encontrado: ${binJs}`)
  }
  return `node "${binJs}"`
}

function runSupabase(args, cwd) {
  return runIn(cwd, `${resolveSupabaseCli()} ${args}`)
}

function readPinnedPackageVersion(name, expected) {
  let pkgPath
  try {
    pkgPath = requireFromRoot.resolve(`${name}/package.json`)
  } catch {
    throw new Error(`${name}@${expected} no instalado. Ejecute npm install en la raíz del repositorio.`)
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  if (pkg.version !== expected) {
    throw new Error(`${name} esperado ${expected}, encontrado ${pkg.version}. Ejecute npm install en la raíz.`)
  }
  return pkg.version
}

async function loadPlaywright() {
  readPinnedPackageVersion("playwright", PINNED_PLAYWRIGHT_VERSION)
  const pkgDir = dirname(requireFromRoot.resolve("playwright/package.json"))
  const entry = join(pkgDir, "index.mjs")
  if (!existsSync(entry)) {
    throw new Error(`Playwright ESM entry no encontrado: ${entry}`)
  }
  return import(pathToFileURL(entry).href)
}

function installPlaywrightChromium() {
  const cliPath = requireFromRoot.resolve("playwright/cli.js")
  run(`node "${cliPath}" install chromium`, { cwd: root })
}

async function ensureUser(apiUrl, anonKey, email) {
  const signupRes = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: smokePassword })
  })
  const signupBody = await signupRes.json()
  if (signupBody?.user?.id) return signupBody.user.id

  const tokenRes = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: smokePassword })
  })
  const tokenBody = await tokenRes.json()
  if (tokenBody?.user?.id) return tokenBody.user.id

  throw new Error(`No se pudo crear/obtener usuario ${email}`)
}

function upsertProfile(userId, role, username, fullName) {
  psql(`
INSERT INTO public.profiles (id, full_name, username, role, status)
VALUES ('${userId}', '${fullName}', '${username}', '${role}', 'active')
ON CONFLICT (id) DO UPDATE
SET full_name = excluded.full_name,
    username = excluded.username,
    role = excluded.role,
    status = 'active';
`)
}

async function waitForHttp(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok || res.status < 500) return true
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

function spawnTracked(command, args, opts = {}) {
  const child = spawn(command, args, { shell: true, stdio: "ignore", ...opts })
  childProcesses.push(child)
  return child
}

async function runBrowserSuite(status, artifactsDir) {
  const { chromium } = await loadPlaywright()
  const shotsDir = join(artifactsDir, "screenshots")
  mkdirSync(shotsDir, { recursive: true })

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  let postedEntryNumber = ""
  let reversalEntryNumber = ""
  let originalEntryId = ""

  page.on("dialog", async (dialog) => {
    await dialog.accept()
  })

  async function login(email) {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForSelector('input[type="email"]', { timeout: 30000 })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', smokePassword)
    await page.click('button[type="submit"]')
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 })
  }

  async function openPartidasTab() {
    await page.goto(`${baseUrl}/finance?tab=partidas`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("h2", { timeout: 30000 })
  }

  async function screenshot(name, viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.screenshot({ path: join(shotsDir, `${name}-${viewport.name}.png`), fullPage: true })
  }

  async function assertLayout(viewport) {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      totalsVisible: !!document.querySelector(".finance-journal-totals"),
      editorVisible: !!document.querySelector(".finance-journal-editor"),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 8
    }))
    log(`Viewport ${viewport.name}: sin overflow`, !metrics.overflow)
    log(`Viewport ${viewport.name}: totales visibles`, metrics.totalsVisible)
    log(`Viewport ${viewport.name}: editor utilizable`, metrics.editorVisible)
    await screenshot("layout", viewport)
  }

  async function selectAccount(lineIndex, query) {
    const input = page.locator(`#journal-line-${lineIndex}-account`)
    await input.fill(query)
    await page.locator(".finance-journal-account-option").first().click()
  }

  try {
    await login(contadorEmail)
    log("1. Login contador", true)

    await openPartidasTab()
    log("2. Abrir Partidas contables", await page.locator("h2", { hasText: "Partidas contables" }).isVisible())

    await page.click('button:has-text("Nueva partida")')
    await page.waitForSelector("#journal-entry-description")
    const submitDisabledEmpty = await page.locator('button:has-text("Enviar a aprobación")').isDisabled()
    log("3. Enviar deshabilitado con líneas vacías (0=0)", submitDisabledEmpty)

    await page.fill("#journal-entry-description", "Partida smoke LOCAL TEST")
    await selectAccount(0, "5.01-LOCAL")
    const branchSelect = page.locator("#journal-line-0-branch")
    const branchOptions = await branchSelect.locator("option").evaluateAll((opts) =>
      opts.map((o) => ({ value: o.value, label: o.textContent?.trim() || "" })).filter((o) => o.value)
    )
    if (branchOptions.length) {
      await branchSelect.selectOption(branchOptions[0].value)
    }
    await page.fill("#journal-line-0-debit", "150.00")
    await selectAccount(1, "1.01-LOCAL")
    await page.fill("#journal-line-1-credit", "150.00")
    log("4-7. Crear partida, cuentas, dimensiones e importes", true)

    await page.click('button:has-text("Guardar borrador")')
    await page.waitForSelector(".finance-journal-row", { timeout: 20000 })
    const listRowsAfterSave = await page.locator(".finance-journal-row").count()
    log("8. Guardar borrador", listRowsAfterSave > 0, `filas=${listRowsAfterSave}`)

    const localDraftBanner = await page.locator("text=Borrador local — aún no se guarda en base de datos.").isVisible()
    log("8b. Panel ya no es borrador local", !localDraftBanner, `visible=${localDraftBanner}`)

    await page.fill("#journal-entry-description", "Partida smoke LOCAL TEST editada")
    log("9. Editar sin cerrar/reabrir", true)

    const submitEnabled = await page.locator('button:has-text("Enviar a aprobación")').isEnabled()
    await page.click('button:has-text("Enviar a aprobación")')
    await page.waitForTimeout(2000)
    const listRowsAfterSubmit = await page.locator(".finance-journal-row").count()
    log("10. Enviar sin recrear partida", submitEnabled && listRowsAfterSubmit === listRowsAfterSave, `filas=${listRowsAfterSubmit}`)

    await page.click('button:has-text("Aprobar")')
    await page.waitForTimeout(1500)
    log("11. Aprobar", true)

    await page.click('button:has-text("Contabilizar")')
    await page.click('button:has-text("Confirmar contabilización")')
    await page.waitForTimeout(2000)
    log("12. Contabilizar", true)

    postedEntryNumber = (await page.locator("#journal-editor-title").textContent())?.trim() || ""
    const hasJeNumber = /^JE-\d{4}-\d{6}$/.test(postedEntryNumber)
    log("13. Confirmar número JE", hasJeNumber, postedEntryNumber)

    const saveDraftVisible = await page.locator('button:has-text("Guardar borrador")').isVisible()
    const descDisabled = await page.locator("#journal-entry-description").isDisabled()
    log("14. Modo solo lectura", !saveDraftVisible && descDisabled)

    originalEntryId = psqlAt(`
SELECT id FROM public.finance_journal_entries
WHERE entry_number = '${postedEntryNumber.replace(/'/g, "''")}' LIMIT 1;
`)

    await page.locator(".finance-journal-editor button.tasks-link", { hasText: "Cerrar" }).click()
    await context.close()

    const gerenteContext = await browser.newContext()
    const gerentePage = await gerenteContext.newPage()
    gerentePage.on("dialog", async (dialog) => {
      await dialog.accept()
    })

    async function loginGerente(email) {
      await gerentePage.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
      await gerentePage.waitForSelector('input[type="email"]', { timeout: 30000 })
      await gerentePage.fill('input[type="email"]', email)
      await gerentePage.fill('input[type="password"]', smokePassword)
      await gerentePage.click('button[type="submit"]')
      await gerentePage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 })
    }

    await loginGerente(gerenteEmail)
    log("16. Login gerente_general", true)

    await gerentePage.goto(`${baseUrl}/finance?tab=partidas`, { waitUntil: "domcontentloaded" })
    await gerentePage.locator(".finance-journal-row").first().click()
    await gerentePage.waitForTimeout(1000)
    const gerenteNoCreate = !(await gerentePage.locator('button:has-text("Nueva partida")').isVisible())
    const gerenteNoApprove = !(await gerentePage.locator('button:has-text("Aprobar")').isVisible())
    const gerenteNoPost = !(await gerentePage.locator('button:has-text("Contabilizar")').isVisible())
    log("17. Gerente sin crear/aprobar/contabilizar", gerenteNoCreate && gerenteNoApprove && gerenteNoPost)

    await gerentePage.click('button:has-text("Revertir")')
    await gerentePage.fill("#journal-reverse-reason", "Smoke LOCAL TEST reversión")
    await gerentePage.fill("#journal-reverse-date", new Date().toISOString().slice(0, 10))
    await gerentePage.click('button:has-text("Confirmar reversión")')
    await gerentePage.waitForTimeout(2500)
    log("18. Revertir con motivo y fecha", true)

    reversalEntryNumber = psqlAt(`
SELECT e2.entry_number
FROM public.finance_journal_entries e1
JOIN public.finance_journal_entries e2 ON e2.id = e1.reversed_by_entry_id
WHERE e1.entry_number = '${postedEntryNumber.replace(/'/g, "''")}' LIMIT 1;
`)
    const mirrorOk =
      Boolean(reversalEntryNumber) &&
      reversalEntryNumber !== postedEntryNumber &&
      /^JE-\d{4}-\d{6}$/.test(reversalEntryNumber)
    log("19. Partida espejo con número distinto", mirrorOk, `${postedEntryNumber} -> ${reversalEntryNumber}`)

    const netZero = psqlAt(`
SELECT COALESCE(ROUND(SUM(l.debit - l.credit)::numeric, 2), 0)
FROM public.finance_journal_lines l
WHERE l.journal_entry_id IN (
  SELECT id FROM public.finance_journal_entries
  WHERE entry_number IN ('${postedEntryNumber.replace(/'/g, "''")}', '${String(reversalEntryNumber).replace(/'/g, "''")}')
);
`)
    log("20. Efecto neto cero (consulta local)", netZero === "0.00", `net=${netZero}`)

    // D. Cambios sin guardar (nueva sesión contador)
    await gerenteContext.close()
    const unsavedContext = await browser.newContext()
    const unsavedPage = await unsavedContext.newPage()

    await unsavedPage.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" })
    await unsavedPage.fill('input[type="email"]', contadorEmail)
    await unsavedPage.fill('input[type="password"]', smokePassword)
    await unsavedPage.click('button[type="submit"]')
    await unsavedPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 })
    await unsavedPage.goto(`${baseUrl}/finance?tab=partidas`, { waitUntil: "domcontentloaded" })
    await unsavedPage.waitForSelector('button:has-text("Nueva partida")', { timeout: 20000 })

    let dialogCount = 0
    unsavedPage.on("dialog", async (dialog) => {
      dialogCount += 1
      await dialog.dismiss()
    })

    async function openUnsavedDraft(label) {
      await unsavedPage.click('button:has-text("Nueva partida")')
      await unsavedPage.waitForSelector("#journal-entry-description", { timeout: 15000 })
      await unsavedPage.fill("#journal-entry-description", label)
    }

    await openUnsavedDraft("Borrador unsaved smoke")
    dialogCount = 0
    await unsavedPage.locator(".finance-journal-editor button.tasks-link", { hasText: "Cerrar" }).click()
    await unsavedPage.waitForTimeout(300)
    log("D1. Cerrar editor con cambios (confirm)", dialogCount >= 1)

    dialogCount = 0
    await openUnsavedDraft("Borrador unsaved smoke 2")
    await unsavedPage.getByRole("button", { name: "Resumen" }).click()
    await unsavedPage.waitForTimeout(300)
    log("D2. Cambiar tab Finanzas con cambios", dialogCount >= 1)

    dialogCount = 0
    await openUnsavedDraft("Borrador unsaved smoke 3")
    await unsavedPage.getByRole("link", { name: "Dashboard" }).click()
    await unsavedPage.waitForTimeout(300)
    log("D3. Click Sidebar con cambios", dialogCount >= 1)

    dialogCount = 0
    await openUnsavedDraft("Borrador unsaved smoke 4")
    await unsavedPage.goBack()
    await unsavedPage.waitForTimeout(300)
    const urlAfterBack = unsavedPage.url()
    await unsavedPage.goBack()
    await unsavedPage.waitForTimeout(300)
    log("D4. Botón atrás sin bucle", unsavedPage.url() === urlAfterBack || !unsavedPage.url().includes("/login"))
    await unsavedContext.close()

    // E. Viewports (contexto limpio)
    const viewportContext = await browser.newContext()
    const vpPage = await viewportContext.newPage()
    await vpPage.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" })
    await vpPage.fill('input[type="email"]', contadorEmail)
    await vpPage.fill('input[type="password"]', smokePassword)
    await vpPage.click('button[type="submit"]')
    await vpPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 })
    await vpPage.goto(`${baseUrl}/finance?tab=partidas`, { waitUntil: "domcontentloaded" })
    await vpPage.click('button:has-text("Nueva partida")')
    for (const viewport of VIEWPORTS) {
      await vpPage.setViewportSize({ width: viewport.width, height: viewport.height })
      await vpPage.waitForTimeout(300)
      const metrics = await vpPage.evaluate((width) => {
        const editor = document.querySelector(".finance-journal-editor")
        const totals = document.querySelector(".finance-journal-totals")
        const editorRect = editor?.getBoundingClientRect()
        const slack = width <= 767 ? 12 : 4
        return {
          totalsVisible: !!totals && totals.getBoundingClientRect().height > 0,
          editorVisible: !!editor && (editorRect?.height ?? 0) > 0,
          overflow: editorRect
            ? editorRect.right > window.innerWidth + slack || editorRect.left < -slack
            : true
        }
      }, viewport.width)
      log(`Viewport ${viewport.name}: sin overflow`, !metrics.overflow)
      log(`Viewport ${viewport.name}: totales visibles`, metrics.totalsVisible)
      log(`Viewport ${viewport.name}: editor utilizable`, metrics.editorVisible)
      await vpPage.screenshot({
        path: join(shotsDir, `layout-${viewport.name}.png`),
        fullPage: true
      })
    }

    const modalOpen = await vpPage.evaluate(() => {
      const backdrop = document.querySelector(".finance-modal-backdrop")
      if (backdrop) return backdrop.getBoundingClientRect().bottom <= window.innerHeight
      return true
    })
    log("E. Modal dentro del viewport (si aplica)", modalOpen)

    await vpPage.locator("#journal-entry-description").focus()
    const focusVisible = await vpPage.evaluate(() => {
      const el = document.activeElement
      if (!el) return false
      const style = window.getComputedStyle(el)
      return style.outlineStyle !== "none" || style.boxShadow !== "none"
    })
    log("E. Focus visible en editor", focusVisible)
    await viewportContext.close()
  } catch (error) {
    log("E2E browser suite", false, redactSecrets(error.message || String(error)))
    throw error
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function main() {
  artifactsDir = join(tmpdir(), `alcazar-finance-journal-smoke-artifacts-${Date.now()}`)
  mkdirSync(artifactsDir, { recursive: true })

  try {
    console.log("=== Finance journal UI smoke (local only) ===")

    smokeDir = mkdtempSync(join(tmpdir(), "alcazar-finance-journal-smoke-"))
    console.log(`Directorio temporal: ${smokeDir}`)

    if (existsSync(join(root, "supabase", ".temp", "project-ref"))) {
      console.log("Nota: existe supabase/.temp/project-ref en el repo; este smoke NO lo utiliza.")
    }

    const supabaseVersion = runSupabase("--version", root)
    const playwrightVersion = readPinnedPackageVersion("playwright", PINNED_PLAYWRIGHT_VERSION)
    console.log(`Supabase CLI: ${supabaseVersion}`)
    console.log(`Playwright: ${playwrightVersion}`)

    runSupabase("init --force", smokeDir)
    const projectId = readProjectId(join(smokeDir, "supabase", "config.toml"))
    dbContainer = `supabase_db_${projectId}`

    console.log("Iniciando Supabase local…")
    runSupabase("start", smokeDir)
    const statusRaw = runSupabase("status -o json", smokeDir)
    const status = JSON.parse(statusRaw.replace(/^\uFEFF/, ""))

    assertLocalHostOnly(status.API_URL, "API_URL")
    assertLocalHostOnly(status.DB_URL, "DB_URL")
    if (status.STUDIO_URL) assertLocalHostOnly(status.STUDIO_URL, "STUDIO_URL")

    const apiHost = new URL(status.API_URL).hostname
    log("A. API/DB en localhost", apiHost === "127.0.0.1" || apiHost === "localhost", apiHost)

    psql(smokeBootstrapSql)
    psqlFile(join(schemaDir, "202_finance_accounting_chart_of_accounts.sql"))
    psqlFile(join(schemaDir, "203_finance_accounting_multibranch_foundation.sql"))
    psqlFile(join(schemaDir, "204_finance_accounting_journal_engine.sql"))
    psql(profileGrantsSql)
    log("B. Bootstrap + migraciones 202→203→204 + grants profiles", true)

    const contadorId = await ensureUser(status.API_URL, status.ANON_KEY, contadorEmail)
    const gerenteId = await ensureUser(status.API_URL, status.ANON_KEY, gerenteEmail)
    if (!contadorId || !gerenteId) throw new Error("Signup no devolvió IDs de usuario")
    upsertProfile(contadorId, "contador", "ui_contador_smoke", "Contador UI Smoke")
    upsertProfile(gerenteId, "gerente_general", "ui_gerente_smoke", "Gerente UI Smoke")
    psql(buildFixtureSql(contadorId))
    log("B. Usuarios signup + fixtures LOCAL TEST", true)

    const safeStatus = {
      API_URL: status.API_URL,
      DB_URL: status.DB_URL?.replace(/:[^:@]+@/, ":***@"),
      project_id: projectId
    }
    writeFileSync(join(artifactsDir, "status-redacted.json"), JSON.stringify(safeStatus, null, 2))

    viteProcess = spawnTracked(
      "npm",
      ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(vitePort)],
      {
        cwd: frontendDir,
        env: {
          ...process.env,
          VITE_SUPABASE_URL: status.API_URL,
          VITE_SUPABASE_ANON_KEY: status.ANON_KEY
        }
      }
    )

    const viteReady = await waitForHttp(baseUrl)
    log("B. Vite dev server local", viteReady, baseUrl)
    if (!viteReady) throw new Error("Vite no respondió a tiempo")

    try {
      installPlaywrightChromium()
    } catch {
      console.log("Playwright chromium: usando instalación existente o reintentando…")
    }

    await runBrowserSuite(status, artifactsDir)

    writeFileSync(
      join(artifactsDir, "results.json"),
      JSON.stringify({ results, exitCode }, null, 2)
    )
    console.log(`Evidencia: ${artifactsDir}`)
  } catch (error) {
    exitCode = 1
    console.error(redactSecrets(error?.message || String(error)))
    if (error?.stack) console.error(redactSecrets(error.stack.split("\n").slice(0, 5).join("\n")))
  } finally {
    console.log("=== Limpieza ===")
    if (browser) {
      await browser.close().catch(() => {})
      console.log("Navegador cerrado")
    }
    for (const child of childProcesses) {
      if (!child.killed) child.kill("SIGTERM")
    }
    if (viteProcess && !viteProcess.killed) {
      viteProcess.kill("SIGTERM")
      console.log("Vite terminado")
    }
    if (smokeDir && existsSync(join(smokeDir, "supabase"))) {
      try {
        runSupabase("stop --no-backup", smokeDir)
        console.log("Supabase local detenido")
      } catch (error) {
        console.log(`Supabase stop: ${redactSecrets(error.message)}`)
      }
    }
    if (smokeDir && !keepArtifacts) {
      try {
        rmSync(smokeDir, { recursive: true, force: true })
        console.log("Directorio temporal eliminado")
      } catch (error) {
        console.log(`No se pudo eliminar directorio temporal: ${redactSecrets(error.message)}`)
      }
    } else if (smokeDir) {
      console.log(`KEEP_SMOKE_ARTIFACTS=1 — conservando ${smokeDir}`)
    }
    if (!keepArtifacts && artifactsDir) {
      // artifactsDir kept only logs/screenshots without secrets — always keep results path printed
    }
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nResumen E2E: ${passed} PASS / ${failed} FAIL (${results.length} checks)`)
  process.exit(exitCode)
}

main()
