/**
 * Self-test manual: node frontend/scripts/checklistOperationalStatus.selftest.mjs
 */
import {
  CHECKLIST_OPERATIONAL_STATUS,
  getChecklistOperationalDate,
  getChecklistOperationalDisplayStatus,
  getChecklistRunContextBadgeLabels,
  isChecklistRunHistoricPending,
  isChecklistRunOperationalTodayWork,
  isChecklistRunOverdueBucket,
  isChecklistRunOverdueDisplay,
  isChecklistRunTodayWork,
  filterRunsWithoutCompletedDuplicate
} from "../src/utils/checklistOperationalStatus.js"

const due = { run_date: "2026-06-22", due_time: "10:00:00" }

function assert(label, condition) {
  if (!condition) {
    console.error("FAIL:", label)
    process.exitCode = 1
    return
  }
  console.log("OK:", label)
}

const pendingLate = { ...due, status: "pending" }
assert(
  "pending vencida → atrasada",
  getChecklistOperationalDisplayStatus(pendingLate, new Date("2026-06-22T16:00:00-06:00"))
    === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA
)

const completedLate = { ...due, status: "completed", completion_timing: "late", completed_at: "2026-06-22T11:00:00Z" }
assert(
  "completed tarde → completada tarde",
  getChecklistOperationalDisplayStatus(completedLate) === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_TARDE
)
assert(
  "completed tarde no es overdue",
  !isChecklistRunOverdueDisplay(completedLate)
)

const completedOnTime = { ...due, status: "completed", completion_timing: "on_time" }
assert(
  "completed a tiempo → completada a tiempo",
  getChecklistOperationalDisplayStatus(completedOnTime) === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_A_TIEMPO
)

const pendingReview = { ...due, status: "pending_review", submitted_at: "2026-06-22T11:00:00Z" }
assert(
  "pending_review tarde → pendiente revision",
  getChecklistOperationalDisplayStatus(pendingReview, new Date("2026-06-22T16:00:00-06:00"))
    === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_REVISION
)
assert(
  "pending_review no es overdue",
  !isChecklistRunOverdueDisplay(pendingReview, new Date("2026-06-22T16:00:00-06:00"))
)
assert(
  "pending_review badge",
  getChecklistRunContextBadgeLabels(pendingReview).includes("PENDIENTE REVISION")
)

const cancelled = { ...due, status: "cancelled" }
assert(
  "cancelled → cancelada",
  getChecklistOperationalDisplayStatus(cancelled) === CHECKLIST_OPERATIONAL_STATUS.CANCELADA
)
assert(
  "cancelled no es overdue",
  !isChecklistRunOverdueDisplay(cancelled)
)
assert(
  "cancelled badge",
  getChecklistRunContextBadgeLabels(cancelled).includes("CANCELADA")
)

const completedRun = { id: "a", template_id: "t1", ...due, status: "completed", completion_timing: "late" }
const duplicateActive = { id: "b", template_id: "t1", ...due, status: "in_progress" }
const filtered = filterRunsWithoutCompletedDuplicate([completedRun, duplicateActive])
assert(
  "oculta duplicado activo si existe completed misma plantilla/fecha",
  filtered.length === 1 && filtered[0].id === "a"
)

const overdueYesterday = {
  id: "overdue-yesterday",
  template_id: "t2",
  run_date: "2026-06-08",
  status: "overdue"
}
const nowAfterWindow = new Date("2026-06-09T10:00:00-06:00")
assert(
  "operationalToday-1 overdue → bucket Vencidas",
  getChecklistOperationalDate(nowAfterWindow) === "2026-06-09"
    && isChecklistRunOverdueBucket(overdueYesterday, nowAfterWindow)
)
assert(
  "operationalToday-1 overdue no es today work operativo",
  !isChecklistRunOperationalTodayWork(overdueYesterday, "2026-06-09", nowAfterWindow)
)
assert(
  "operationalToday-1 overdue excluido por historic pending antiguo",
  !isChecklistRunHistoricPending(overdueYesterday, nowAfterWindow)
)

const completedOverdue = { ...overdueYesterday, status: "completed", completion_timing: "late" }
assert(
  "completed no entra en bucket Vencidas",
  !isChecklistRunOverdueBucket(completedOverdue, nowAfterWindow)
)

const cancelledOverdue = { ...overdueYesterday, status: "cancelled" }
assert(
  "cancelled no entra en bucket Vencidas",
  !isChecklistRunOverdueBucket(cancelledOverdue, nowAfterWindow)
)

const pendingReviewOverdue = { ...overdueYesterday, status: "pending_review" }
assert(
  "pending_review no entra en bucket Vencidas",
  !isChecklistRunOverdueBucket(pendingReviewOverdue, nowAfterWindow)
)

const pendingWindowClosed = {
  id: "pending-closed",
  template_id: "t3",
  run_date: "2026-06-08",
  status: "pending"
}
assert(
  "pending con ventana cerrada → bucket Vencidas",
  isChecklistRunOverdueBucket(pendingWindowClosed, nowAfterWindow)
)

if (!process.exitCode) console.log("\nAll checklist operational status self-tests passed.")
