/**
 * F0A — POS order owner client helpers (offline selftest)
 * Run: node frontend/scripts/posOrderOwnerF0a.selftest.mjs
 */

const POS_ROLES_F0A = ["admin", "gerente_general", "supervisor", "mesero", "caja"]

function mapOrderOwnerFields(row) {
  if (!row) return row
  return {
    ownerProfileId: row.owner_profile_id || row.waiter_id || null,
    waiterId: row.waiter_id || null,
    usuarioNombre: row.waiter_name || "POS"
  }
}

function buildCreateOrderPayload(tableData, currentUser) {
  return {
    table_id: String(tableData.tableId || tableData.mesaId),
    waiter_id: currentUser.id,
    waiter_name: currentUser.name || currentUser.username || "POS",
    owner_profile_id: currentUser.id,
    status: "open"
  }
}

const tests = [
  {
    name: "mapOrder prefers owner_profile_id",
    run() {
      const mapped = mapOrderOwnerFields({ owner_profile_id: "o1", waiter_id: "w1", waiter_name: "Ana" })
      return mapped.ownerProfileId === "o1" && mapped.waiterId === "w1"
    }
  },
  {
    name: "mapOrder falls back to waiter_id",
    run() {
      const mapped = mapOrderOwnerFields({ waiter_id: "w1", waiter_name: "Ana" })
      return mapped.ownerProfileId === "w1"
    }
  },
  {
    name: "create payload sets owner and waiter to same user",
    run() {
      const payload = buildCreateOrderPayload({ tableId: "12" }, { id: "u1", name: "Mesero" })
      return payload.owner_profile_id === "u1" && payload.waiter_id === "u1"
    }
  },
  {
    name: "POS_ROLES excludes cajero and servicio (pre-F0A behavior)",
    run() {
      return !POS_ROLES_F0A.includes("cajero") && !POS_ROLES_F0A.includes("servicio")
    }
  }
]

let passed = 0
for (const test of tests) {
  const ok = Boolean(test.run())
  console.log(`${ok ? "OK" : "FAIL"} ${test.name}`)
  if (ok) passed += 1
}

console.log(`\n${passed}/${tests.length} passed`)
if (passed !== tests.length) process.exit(1)
