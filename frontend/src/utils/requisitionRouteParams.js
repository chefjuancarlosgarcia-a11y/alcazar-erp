import { TEST_FLOW_FILTER } from "./testFlowMode.js"

/** Consumed by RequisitionsSupabase via parseRequisitionRouteSearchParams. */
export const REQUISITION_DEEP_LINK_KEYS = ["id", "tab", "approve", "testFlow", "focus"]

/** Build canonical /requisitions URL preserving deep-link query params. */
export function buildRequisitionUrl(params = {}) {
  const search = new URLSearchParams()
  REQUISITION_DEEP_LINK_KEYS.forEach((key) => {
    const value = params[key]
    if (value != null && value !== "") search.set(key, String(value))
  })
  const query = search.toString()
  return query ? `/requisitions?${query}` : "/requisitions"
}

export function buildRequisitionUrlFromInventorySearchParams(searchParams) {
  const testFlowParam = searchParams.get("testFlow") || ""
  return buildRequisitionUrl({
    id: searchParams.get("id") || "",
    tab: searchParams.get("tab") || "",
    approve: searchParams.get("approve") || "",
    testFlow: testFlowParam,
    focus: searchParams.get("focus") === "1" ? "1" : ""
  })
}

export function parseRequisitionRouteSearchParams(searchParams) {
  const testFlowParam = searchParams.get("testFlow") || ""
  const initialTestFlowFilter =
    testFlowParam === "test"
      ? TEST_FLOW_FILTER.TEST
      : testFlowParam === "all"
        ? TEST_FLOW_FILTER.ALL
        : ""

  return {
    initialRequisitionId: searchParams.get("id") || "",
    initialTab: searchParams.get("tab") || "",
    initialApproveId: searchParams.get("approve") || "",
    initialTestFlowFilter: initialTestFlowFilter || TEST_FLOW_FILTER.REAL,
    initialFocus: searchParams.get("focus") === "1"
  }
}
