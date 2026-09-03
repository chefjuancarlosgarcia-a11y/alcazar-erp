import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { executeDeactivateUser, executeReactivateUser } from "./userLifecycleHandlers.ts"
import type { ProfileRow } from "./userLifecycle.ts"

type UpdateCall = { table: string; payload: Record<string, unknown>; id: string }
type RpcCall = { name: string; args: Record<string, unknown> }
type DeleteCall = { table: string; column: string; value: string }

function createTrackingClients(options: {
  profileUpdateError?: Error | null
  rpcError?: Error | null
  deleteError?: Error | null
}) {
  const profileUpdates: UpdateCall[] = []
  const rpcCalls: RpcCall[] = []
  const deleteCalls: DeleteCall[] = []
  let profileUpdateClient: "actor" | "admin" | null = null

  const makeFrom = (clientKind: "actor" | "admin") => (table: string) => ({
    update(payload: Record<string, unknown>) {
      return {
        eq(column: string, value: string) {
          if (table === "profiles" && column === "id") {
            profileUpdateClient = clientKind
            profileUpdates.push({ table, payload, id: value })
            return Promise.resolve({ error: options.profileUpdateError ?? null })
          }
          if (table === "attendance_credentials" && column === "employee_id") {
            deleteCalls.push({ table, column, value })
            return Promise.resolve({ error: options.deleteError ?? null })
          }
          return Promise.resolve({ error: new Error(`unexpected delete/update ${table}`) })
        }
      }
    },
    delete() {
      return {
        eq(column: string, value: string) {
          deleteCalls.push({ table, column, value })
          return Promise.resolve({ error: options.deleteError ?? null })
        }
      }
    }
  })

  const actorClient = { from: makeFrom("actor") } as unknown as SupabaseClient
  const adminClient = {
    from: makeFrom("admin"),
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return Promise.resolve({ error: options.rpcError ?? null })
    }
  } as unknown as SupabaseClient

  return { actorClient, adminClient, profileUpdates, rpcCalls, deleteCalls, getProfileUpdateClient: () => profileUpdateClient }
}

const actor: ProfileRow = { id: "actor-1", role: "admin", status: "active" }
const targetActive: ProfileRow = { id: "target-1", role: "colaborador", status: "active" }
const targetInactive: ProfileRow = { id: "target-2", role: "colaborador", status: "inactive" }

Deno.test("deactivate uses actor client for profiles update, not admin", async () => {
  const { actorClient, adminClient, profileUpdates, getProfileUpdateClient } = createTrackingClients({})
  const result = await executeDeactivateUser({
    admin: adminClient,
    actorClient,
    actor,
    target: targetActive,
    targetId: targetActive.id,
    reason: "motivo valido"
  })

  assertEquals(result.ok, true)
  assertEquals(getProfileUpdateClient(), "actor")
  assertEquals(profileUpdates.length, 1)
  assertEquals(profileUpdates[0].payload.status, "inactive")
  assertEquals(profileUpdates[0].payload.authorized_attendance_device, null)
})

Deno.test("deactivate idempotent when target already inactive", async () => {
  const { actorClient, adminClient, profileUpdates } = createTrackingClients({})
  const result = await executeDeactivateUser({
    admin: adminClient,
    actorClient,
    actor,
    target: targetInactive,
    targetId: targetInactive.id,
    reason: "motivo valido"
  })

  assertEquals(result.ok, true)
  assertEquals(result.body.already_inactive, true)
  assertEquals(profileUpdates.length, 0)
})

Deno.test("deactivate stops after profile update error", async () => {
  const { actorClient, adminClient, rpcCalls, deleteCalls } = createTrackingClients({
    profileUpdateError: new Error("trigger blocked")
  })
  const result = await executeDeactivateUser({
    admin: adminClient,
    actorClient,
    actor,
    target: targetActive,
    targetId: targetActive.id,
    reason: "motivo valido"
  })

  assertEquals(result.ok, false)
  assertEquals(result.status, 400)
  assertEquals(rpcCalls.length, 0)
  assertEquals(deleteCalls.length, 0)
})

Deno.test("deactivate surfaces attendance credential delete errors", async () => {
  const { actorClient, adminClient, deleteCalls } = createTrackingClients({
    deleteError: new Error("delete failed")
  })
  const result = await executeDeactivateUser({
    admin: adminClient,
    actorClient,
    actor,
    target: targetActive,
    targetId: targetActive.id,
    reason: "motivo valido"
  })

  assertEquals(result.ok, false)
  assertEquals(deleteCalls.length, 1)
})

Deno.test("reactivate uses actor client for profiles update", async () => {
  const { actorClient, profileUpdates, getProfileUpdateClient } = createTrackingClients({})
  const adminClient = { from: () => ({}) } as unknown as SupabaseClient
  const result = await executeReactivateUser({
    actorClient,
    actor,
    target: targetInactive,
    targetId: targetInactive.id
  })

  assertEquals(result.ok, true)
  assertEquals(getProfileUpdateClient(), "actor")
  assertEquals(profileUpdates[0].payload.status, "active")
})

Deno.test("reactivate idempotent when already active", async () => {
  const { actorClient, profileUpdates } = createTrackingClients({})
  const result = await executeReactivateUser({
    actorClient,
    actor: { ...actor, role: "gerente_general" },
    target: targetActive,
    targetId: targetActive.id
  })

  assertEquals(result.ok, true)
  assertEquals(result.body.already_active, true)
  assertEquals(profileUpdates.length, 0)
})
