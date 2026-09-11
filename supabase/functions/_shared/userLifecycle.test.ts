import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { canManageTarget, normalizeRole } from "./userLifecycle.ts"

Deno.test("admin can manage colaborador", () => {
  assertEquals(canManageTarget("admin", "colaborador"), true)
})

Deno.test("gerente_general can manage colaborador", () => {
  assertEquals(canManageTarget("gerente_general", "colaborador"), true)
})

Deno.test("gerente_general cannot manage admin", () => {
  assertEquals(canManageTarget("gerente_general", "admin"), false)
})

Deno.test("recursos_humanos cannot manage gerente_general", () => {
  assertEquals(canManageTarget("recursos_humanos", "gerente_general"), false)
})

Deno.test("recursos_humanos can manage colaborador", () => {
  assertEquals(canManageTarget("recursos_humanos", "colaborador"), true)
})

Deno.test("normalizeRole maps gerente general alias", () => {
  assertEquals(normalizeRole("Gerente General"), "gerente_general")
})
