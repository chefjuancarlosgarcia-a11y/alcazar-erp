import { normalizeRole } from "./profilePermissions"
import {
  filterRunsWithoutCompletedDuplicate,
  getChecklistOperationalDate,
  isChecklistRunActive,
  isChecklistRunDateToday,
  isChecklistRunOverdueBucket,
  isChecklistRunOperationalTodayWork,
  isChecklistRunTodayWork,
  normalizeChecklistRunDate,
  normalizeChecklistRunStatus,
  hasChecklistReplacement
} from "./checklistOperationalStatus"

export { filterRunsWithoutCompletedDuplicate }

/** Roles that bypass area/responsibility filters and see every checklist run. */
export const CHECKLIST_SEE_ALL_ROLES = Object.freeze([
  "admin",
  "gerente_general",
  "gerente",
  "recursos_humanos",
  "rrhh"
])

export function canSeeAllChecklistModuleRuns(user) {
  const role = normalizeRole(user?.role)
  return CHECKLIST_SEE_ALL_ROLES.includes(role)
}

export function userChecklistArea(user) {
  return user?.area_name || user?.areaName || ""
}

export function checklistAreasMatch(left, right) {
  const a = normalizeChecklistAreaKey(left).toLowerCase()
  const b = normalizeChecklistAreaKey(right).toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  if (a === "cocina" && b.includes("cocina")) return true
  if (b === "cocina" && a.includes("cocina")) return true
  return false
}

function normalizeChecklistAreaKey(value) {
  if (!value) return ""
  return String(value).trim()
}

function isSupervisorScopedRole(role) {
  return role === "supervisor" || role === "encargado_area"
}

function runTemplateSupervisorId(run) {
  return run?.supervisor_profile_id || run?.checklist_templates?.supervisor_profile_id || null
}

export function canSeeChecklistRun(run, user, profiles, {
  seeAll = false,
  processChildRunIds = null
} = {}) {
  if (seeAll) return true
  if (!run || !user?.id) return false

  const role = normalizeRole(user?.role)
  const userArea = userChecklistArea(user)

  if (CHECKLIST_SEE_ALL_ROLES.includes(role)) return true
  if (processChildRunIds?.has?.(run.id)) return true
  if (run.assigned_profile_id === user.id) return true

  const replaced = hasChecklistReplacement(run)
  if (replaced && run.original_assigned_profile_id === user.id) return false

  const templateSupervisorId = runTemplateSupervisorId(run)
  if (templateSupervisorId && String(templateSupervisorId) === String(user.id)) return true
  if (run.supervisor_profile_id && String(run.supervisor_profile_id) === String(user.id)) return true

  if (!isSupervisorScopedRole(role)) {
    if (!run.assigned_profile_id && run.assigned_role && normalizeRole(run.assigned_role) === role) return true
    if (!run.assigned_profile_id && run.area && userArea && checklistAreasMatch(run.area, userArea)) return true
    return false
  }

  if (userArea && run.area && checklistAreasMatch(run.area, userArea)) return true

  if (
    !run.assigned_profile_id
    && run.assigned_role
    && normalizeRole(run.assigned_role) === role
    && userArea
    && run.area
    && checklistAreasMatch(run.area, userArea)
  ) {
    return true
  }

  const assigned = profiles.find((profile) => profile.id === run.assigned_profile_id)
  if (assigned) {
    if (String(assigned.supervisor_profile_id || "") === String(user.id)) return true
    if (userArea && assigned.area_name && checklistAreasMatch(assigned.area_name, userArea)) return true
  }

  return false
}

export function collectProcessChildRunIds(processRunDetails = []) {
  const ids = new Set()
  ;(processRunDetails || []).forEach((detail) => {
    ;(detail?.steps || []).forEach((step) => {
      if (step?.checklist_run_id) ids.add(step.checklist_run_id)
    })
  })
  return ids
}

export function buildSupervisorChecklistVisibilityAudit({
  rawRuns = [],
  user = null,
  profiles = [],
  processRunDetails = [],
  operationalToday = null
} = {}) {
  const role = normalizeRole(user?.role)
  if (!isSupervisorScopedRole(role)) return null

  const processChildRunIds = collectProcessChildRunIds(processRunDetails)
  const today = operationalToday || getChecklistOperationalDate()
  const nonCancelled = (rawRuns || []).filter((run) => run?.status !== "cancelled")
  const visible = nonCancelled.filter((run) => (
    canSeeChecklistRun(run, user, profiles, { seeAll: false, processChildRunIds })
  ))
  const hidden = nonCancelled.filter((run) => !visible.some((item) => item.id === run.id))

  const countBy = (runs, predicate) => runs.filter(predicate).length

  return {
    userId: user?.id || null,
    userName: user?.name || user?.full_name || null,
    userRole: role,
    userArea: userChecklistArea(user),
    operationalToday: today,
    processGroupsVisible: (processRunDetails || []).length,
    processChildRunIds: processChildRunIds.size,
    totals: {
      rawReceived: nonCancelled.length,
      visible: visible.length,
      hidden: hidden.length,
      visibleAssignedToSelf: countBy(visible, (run) => run.assigned_profile_id === user.id),
      visibleByArea: countBy(visible, (run) => (
        run.area && userChecklistArea(user) && checklistAreasMatch(run.area, userChecklistArea(user))
      )),
      visibleBySupervisorProfile: countBy(visible, (run) => (
        String(runTemplateSupervisorId(run) || run.supervisor_profile_id || "") === String(user.id)
      )),
      visibleByProcessChild: countBy(visible, (run) => processChildRunIds.has(run.id)),
      hiddenSamples: hidden.slice(0, 8).map((run) => ({
        id: run.id,
        title: run.checklist_templates?.title || null,
        area: run.area || null,
        assigned_profile_id: run.assigned_profile_id || null,
        assigned_role: run.assigned_role || null,
        status: run.status
      }))
    }
  }
}

export function checklistLogicalRunKey(run) {
  return [
    run?.template_id || "NO_TEMPLATE",
    normalizeChecklistRunDate(run?.run_date) || "NO_DATE",
    run?.assigned_profile_id || "NO_PROFILE",
    String(run?.assigned_role || "").trim() || "NO_ROLE",
    String(run?.area || "").trim() || "NO_AREA"
  ].join("|")
}

export function formatChecklistRunAssignee(run, profiles = []) {
  if (run?.assigned_profile_id) {
    const profile = profiles.find((item) => item.id === run.assigned_profile_id)
    return profile?.full_name || profile?.username || run.assigned_profile_id
  }
  if (run?.assigned_role) return `Rol: ${run.assigned_role}`
  if (run?.area) return `Área: ${run.area}`
  return "Sin asignar"
}

/** Solo elimina filas repetidas del mismo id (p. ej. merge de queries). Nunca colapsa ids distintos. */
export function dedupeChecklistRunsById(runs) {
  const merged = new Map()
  const order = []
  ;(runs || []).forEach((run) => {
    if (!run?.id) return
    if (!merged.has(run.id)) order.push(run.id)
    merged.set(run.id, run)
  })
  return order.map((id) => merged.get(id))
}

/** @deprecated Usar dedupeChecklistRunsById — ya no deduplica por clave lógica entre ids distintos. */
export function dedupeLogicalChecklistRuns(runs) {
  return dedupeChecklistRunsById(runs)
}

export function filterVisibleChecklistRuns(runs, user, profiles, { seeAll = false, processChildRunIds = null } = {}) {
  return (runs || []).filter((run) => (
    run?.status !== "cancelled" && canSeeChecklistRun(run, user, profiles, { seeAll, processChildRunIds })
  ))
}

export function buildTodayRunDedupeDetails(runs, operationalToday, profiles = []) {
  const operationalRuns = (runs || []).filter((run) => (
    isChecklistRunOperationalTodayWork(run, operationalToday)
  ))
  const idOccurrences = new Map()
  operationalRuns.forEach((run) => {
    if (!run?.id) return
    idOccurrences.set(run.id, (idOccurrences.get(run.id) || 0) + 1)
  })

  const seenIds = new Set()
  const idsByLogicalKey = new Map()

  operationalRuns.forEach((run) => {
    const key = checklistLogicalRunKey(run)
    if (!idsByLogicalKey.has(key)) idsByLogicalKey.set(key, [])
    idsByLogicalKey.get(key).push(run.id)
  })

  const runDetails = operationalRuns.map((run) => {
    const duplicateIdInList = seenIds.has(run.id)
    if (!duplicateIdInList && run.id) seenIds.add(run.id)
    const logicalKey = checklistLogicalRunKey(run)
    const siblingIds = (idsByLogicalKey.get(logicalKey) || []).filter((id) => id !== run.id)
    const assignedUserId = run.assigned_profile_id || null
    const assignedProfile = assignedUserId
      ? profiles.find((item) => item.id === assignedUserId)
      : null
    const sourceOccurrences = idOccurrences.get(run.id) || 1

    let rowDiagnosis = "CORRIDA_UNICA"
    if (sourceOccurrences > 1) {
      rowDiagnosis = duplicateIdInList
        ? "MISMA_CORRIDA_REPETIDA_EN_FUENTE (copia oculta por dedupe id)"
        : "MISMA_CORRIDA_REPETIDA_EN_FUENTE (copia visible)"
    } else if (siblingIds.length) {
      rowDiagnosis = "CORRIDA_DISTINTA_BD (misma clave lógica, otro run_id)"
    }

    return {
      run_id: run.id,
      template_id: run.template_id || null,
      template_name: run.checklist_templates?.title || "(sin título)",
      assigned_user_id: assignedUserId,
      assigned_user_name: assignedProfile?.full_name || assignedProfile?.username || null,
      assigned_role: run.assigned_role || null,
      assigned_area: run.area || null,
      run_date: normalizeChecklistRunDate(run.run_date),
      status: run.status,
      sourceOccurrences,
      displayed: !duplicateIdInList,
      removedByDedupe: duplicateIdInList,
      logicalDuplicateIds: siblingIds.length ? siblingIds : null,
      rowDiagnosis,
      // compat campos previos
      id: run.id,
      title: run.checklist_templates?.title || "(sin título)",
      assignee: formatChecklistRunAssignee(run, profiles)
    }
  })

  return runDetails
}

function deriveTemplateGroupDiagnosis(rows = []) {
  const uniqueRunIds = [...new Set(rows.map((row) => row.run_id).filter(Boolean))]
  const sourceRepeated = rows.some((row) => row.sourceOccurrences > 1)
  if (uniqueRunIds.length <= 1) {
    return sourceRepeated
      ? "MISMA_CORRIDA_REPETIDA_EN_FUENTE (mismo run_id cargado más de una vez)"
      : "UNA_SOLA_CORRIDA"
  }

  const assigneeKeys = new Set(rows.map((row) => (
    [row.assigned_user_id || "", row.assigned_role || "", row.assigned_area || ""].join("|")
  )))
  if (assigneeKeys.size > 1) {
    return "CORRIDAS_DISTINTAS_BD — distintos colaboradores / roles / áreas"
  }
  return "CORRIDAS_DISTINTAS_BD — mismo responsable, run_ids distintos (posible generación duplicada)"
}

export function buildTodayRunsGroupedByTemplate(runDetails = []) {
  const groups = new Map()
  ;(runDetails || []).forEach((row) => {
    const key = row.template_name || "(sin título)"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })

  return Array.from(groups.entries())
    .map(([template_name, rows]) => {
      const uniqueRunIds = [...new Set(rows.map((row) => row.run_id).filter(Boolean))]
      const responsibles = rows.map((row) => {
        const parts = []
        if (row.assigned_user_name) parts.push(row.assigned_user_name)
        else if (row.assigned_user_id) parts.push(row.assigned_user_id)
        if (row.assigned_role) parts.push(`rol:${row.assigned_role}`)
        if (row.assigned_area) parts.push(`área:${row.assigned_area}`)
        return parts.join(" · ") || "Sin asignar"
      })

      return {
        template_name,
        template_id: rows[0]?.template_id || null,
        runCount: rows.length,
        uniqueRunIdCount: uniqueRunIds.length,
        run_ids: uniqueRunIds,
        responsibles: [...new Set(responsibles)],
        assigneeDetails: rows.map((row) => ({
          run_id: row.run_id,
          assigned_user_id: row.assigned_user_id,
          assigned_user_name: row.assigned_user_name,
          assigned_role: row.assigned_role,
          assigned_area: row.assigned_area,
          status: row.status,
          rowDiagnosis: row.rowDiagnosis
        })),
        groupDiagnosis: deriveTemplateGroupDiagnosis(rows),
        isDuplicateName: rows.length > 1 || uniqueRunIds.length > 1
      }
    })
    .sort((left, right) => (
      Number(right.isDuplicateName) - Number(left.isDuplicateName)
      || right.runCount - left.runCount
      || left.template_name.localeCompare(right.template_name)
    ))
}

export function buildChecklistDisplayPipelineAudit({
  rawRuns = [],
  user = null,
  profiles = [],
  processRunDetails = [],
  operationalToday = null,
  loadDiagnostics = null
} = {}) {
  const today = operationalToday || getChecklistOperationalDate()
  const seeAll = canSeeAllChecklistModuleRuns(user)
  const processChildRunIds = collectProcessChildRunIds(processRunDetails)
  const nonCancelled = (rawRuns || []).filter((run) => run?.status !== "cancelled")
  const visibleRuns = filterVisibleChecklistRuns(rawRuns, user, profiles, { seeAll, processChildRunIds })
  const hiddenByVisibility = nonCancelled.filter((run) => !visibleRuns.some((item) => item.id === run.id))
  const operationalMatches = visibleRuns.filter((run) => (
    normalizeChecklistRunDate(run?.run_date) === today
  ))
  const todayDateMatches = visibleRuns.filter((run) => isChecklistRunDateToday(run?.run_date))
  const todayOperationalRuns = visibleRuns.filter((run) => isChecklistRunOperationalTodayWork(run, today))
  const todayWorkRuns = visibleRuns.filter((run) => isChecklistRunTodayWork(run))
  const inactiveTodayDateMatches = todayDateMatches.filter((run) => !isChecklistRunActive(run))
  const hiddenByTodayWork = todayDateMatches.filter((run) => (
    isChecklistRunActive(run) && !isChecklistRunOperationalTodayWork(run, today)
  ))
  const dedupedTodayRuns = dedupeChecklistRunsById(todayOperationalRuns)
  const removedByDedupe = todayOperationalRuns.length - dedupedTodayRuns.length
  const dedupeDetails = buildTodayRunDedupeDetails(visibleRuns, today, profiles)
  const templateGroups = buildTodayRunsGroupedByTemplate(dedupeDetails.filter((row) => row.displayed))
  const duplicateTemplateGroups = templateGroups.filter((group) => group.isDuplicateName)

  return {
    userRole: normalizeRole(user?.role) || "(sin rol)",
    userId: user?.id || null,
    seeAllModuleRuns: seeAll,
    loadDiagnostics,
    operationalToday: today,
    counts: {
      rawFromService: rawRuns.length,
      nonCancelled: nonCancelled.length,
      hiddenByVisibility: hiddenByVisibility.length,
      visibleRuns: visibleRuns.length,
      operationalDateMatches: operationalMatches.length,
      todayDateMatches: todayDateMatches.length,
      todayPendingActive: todayOperationalRuns.filter((run) => run.status === "pending").length,
      todayOperationalActive: todayOperationalRuns.length,
      todayWorkRunsBroad: todayWorkRuns.length,
      inactiveOnTodayDates: inactiveTodayDateMatches.length,
      hiddenByTodayWorkFilter: hiddenByTodayWork.length,
      removedByDedupe,
      finalTodayCards: dedupedTodayRuns.length,
      overdueBucket: visibleRuns.filter((run) => isChecklistRunOverdueBucket(run)).length,
      duplicateTemplateNameCount: duplicateTemplateGroups.length
    },
    dedupeDetails,
    templateGroups,
    duplicateTemplateGroups,
    samples: {
      hiddenByVisibility: hiddenByVisibility.slice(0, 3).map((run) => ({
        id: run.id,
        title: run.checklist_templates?.title,
        run_date: run.run_date,
        status: run.status,
        assigned_profile_id: run.assigned_profile_id
      })),
      todayWorkRuns: dedupedTodayRuns.slice(0, 5).map((run) => ({
        id: run.id,
        title: run.checklist_templates?.title,
        run_date: run.run_date,
        status: run.status
      }))
    }
  }
}
