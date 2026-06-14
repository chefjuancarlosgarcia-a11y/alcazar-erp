export const TEST_FLOW_FILTER = {
  REAL: "real",
  TEST: "test",
  ALL: "all"
}

export const TEST_FLOW_WARNING = "Esta es una prueba. No afecta inventario real ni reportes operativos."

export function canCreateTestFlow(user) {
  const role = String(user?.role || "").trim().toLowerCase()
  return role === "admin" || role === "gerente_general"
}

export function isTestRecord(record) {
  return Boolean(record?.is_test ?? record?.isTest ?? record?.data?.is_test)
}

export function matchesTestFlowFilter(record, filter = TEST_FLOW_FILTER.REAL) {
  const test = isTestRecord(record)
  if (filter === TEST_FLOW_FILTER.ALL) return true
  if (filter === TEST_FLOW_FILTER.TEST) return test
  return !test
}

export function filterOperationalRecords(records, filter = TEST_FLOW_FILTER.REAL) {
  return (records || []).filter((record) => matchesTestFlowFilter(record, filter))
}

export function operationalOnly(records) {
  return filterOperationalRecords(records, TEST_FLOW_FILTER.REAL)
}
