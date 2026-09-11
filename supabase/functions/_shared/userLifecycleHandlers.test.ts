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
  rpcErrors?: Array<Error | null>
  deleteErrors?: Array<Error | null>
} = {}) {
  const profileUpdates: UpdateCall[] = []
  const rpcCalls: RpcCall[] = []
  const deleteCalls: DeleteCall[] = []
  let profileUpdateClient: "actor" | "admin" | null = null
  let rpcCallIndex = 0
  let deleteCallIndex = 0

  const nextRpcError = () => {
    if (options.rpcErrors && rpcCallIndex < options.rpcErrors.length) {
      return options.rpcErrors[rpcCallIndex++] ?? null
    }
    return options.rpcError ?? null
  }

  const nextDeleteError = () => {
    if (options.deleteErrors && deleteCallIndex < options.deleteErrors.length) {
      return options.deleteErrors[deleteCallIndex++] ?? null
    }
    return options.deleteError ?? null
  }

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
            return Promise.resolve({ error: nextDeleteError() })
          }
          return Promise.resolve({ error: new Error(`unexpected delete/update ${table}`) })
        }
      }
    },
    delete() {
      return {
        eq(column: string, value: string) {
          deleteCalls.push({ table, column, value })
          return Promise.resolve({ error: nextDeleteError() })
        }
      }
    }
  })

  const actorClient = { from: makeFrom("actor") } as unknown as SupabaseClient
  const adminClient = {
    from: makeFrom("admin"),
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return Promise.resolve({ error: nextRpcError() })
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

Deno.test("deactivate already inactive still revokes sessions and deletes credentials (case A)", async () => {
  const { actorClient, adminClient, profileUpdates, rpcCalls, deleteCalls } = createTrackingClients({})
  const result = await executeDeactivateUser({
    admin: adminClient,
    actorClient,
    actor,
    target: targetInactive,
    targetId: targetInactive.id,
    reason: "motivo valido"
  })

  assertEquals(result.ok, true)
  if (!result.ok) throw new Error("expected success")
  assertEquals(result.body.already_inactive, true)
  assertEquals(result.body.deactivated, true)
  assertEquals(profileUpdates.length, 0)
  assertEquals(rpcCalls.length, 1)
  assertEquals(rpcCalls[0].name, "revoke_user_auth_sessions")
  assertEquals(rpcCalls[0].args.p_user_id, targetInactive.id)
  assertEquals(deleteCalls.length, 1)
  assertEquals(deleteCalls[0].table, "attendance_credentials")
  assertEquals(deleteCalls[0].value, targetInactive.id)
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

Deno.test("deactivate recovers after session revoke failure (case B)", async () => {
  const firstAttempt = createTrackingClients({ rpcErrors: [new Error("revoke failed")] })
  const failedResult = await executeDeactivateUser({
    admin: firstAttempt.adminClient,
    actorClient: firstAttempt.actorClient,
    actor,
    target: targetActive,
    targetId: targetActive.id,
    reason: "motivo valido"
  })

  assertEquals(failedResult.ok, false)
  assertEquals(failedResult.status, 400)
  assertEquals(firstAttempt.profileUpdates.length, 1)
  assertEquals(firstAttempt.profileUpdates[0].payload.status, "inactive")
  assertEquals(firstAttempt.rpcCalls.length, 1)
  assertEquals(firstAttempt.rpcCalls[0].name, "revoke_user_auth_sessions")
  assertEquals(firstAttempt.deleteCalls.length, 0)

  const targetNowInactive: ProfileRow = { ...targetActive, status: "inactive" }
  const retryAttempt = createTrackingClients({})
  const recoveredResult = await executeDeactivateUser({
    admin: retryAttempt.adminClient,
    actorClient: retryAttempt.actorClient,
    actor,
    target: targetNowInactive,
    targetId: targetNowInactive.id,
    reason: "motivo valido"
  })

  assertEquals(recoveredResult.ok, true)
  if (!recoveredResult.ok) throw new Error("expected recovery success")
  assertEquals(recoveredResult.body.already_inactive, true)
  assertEquals(recoveredResult.body.deactivated, true)
  assertEquals(retryAttempt.profileUpdates.length, 0)
  assertEquals(retryAttempt.rpcCalls.length, 1)
  assertEquals(retryAttempt.rpcCalls[0].name, "revoke_user_auth_sessions")
  assertEquals(retryAttempt.deleteCalls.length, 1)
  assertEquals(retryAttempt.deleteCalls[0].table, "attendance_credentials")
})

Deno.test("deactivate recovers after credential delete failure (case C)", async () => {
  const firstAttempt = createTrackingClients({ deleteErrors: [new Error("delete failed")] })
  const failedResult = await executeDeactivateUser({
    admin: firstAttempt.adminClient,
    actorClient: firstAttempt.actorClient,
    actor,
    target: targetInactive,
    targetId: targetInactive.id,
    reason: "motivo valido"
  })

  assertEquals(failedResult.ok, false)
  assertEquals(failedResult.status, 400)
  assertEquals(firstAttempt.profileUpdates.length, 0)
  assertEquals(firstAttempt.rpcCalls.length, 1)
  assertEquals(firstAttempt.rpcCalls[0].name, "revoke_user_auth_sessions")
  assertEquals(firstAttempt.deleteCalls.length, 1)

  const retryAttempt = createTrackingClients({})
  const recoveredResult = await executeDeactivateUser({
    admin: retryAttempt.adminClient,
    actorClient: retryAttempt.actorClient,
    actor,
    target: targetInactive,
    targetId: targetInactive.id,
    reason: "motivo valido"
  })

  assertEquals(recoveredResult.ok, true)
  if (!recoveredResult.ok) throw new Error("expected recovery success")
  assertEquals(recoveredResult.body.already_inactive, true)
  assertEquals(recoveredResult.body.deactivated, true)
  assertEquals(retryAttempt.profileUpdates.length, 0)
  assertEquals(retryAttempt.rpcCalls.length, 1)
  assertEquals(retryAttempt.rpcCalls[0].name, "revoke_user_auth_sessions")
  assertEquals(retryAttempt.deleteCalls.length, 1)
  assertEquals(retryAttempt.deleteCalls[0].table, "attendance_credentials")
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
  if (!result.ok) throw new Error("expected success")
  assertEquals(result.body.already_active, true)
  assertEquals(profileUpdates.length, 0)
})
