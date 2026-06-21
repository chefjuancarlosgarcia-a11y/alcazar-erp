import { normalizeRole } from "./profilePermissions"
import {
  getChecklistOperationalDate,
  isChecklistRunActive,
  isChecklistRunDateToday,
  isChecklistRunHistoricPending,
  isChecklistRunOperationalTodayWork,
  isChecklistRunTodayWork,
  normalizeChecklistRunDate,
  normalizeChecklistRunStatus,
  hasChecklistReplacement
} from "./checklistOperationalStatus"

export function canSeeAllChecklistModuleRuns(user, canViewChecklistLibrary = false) {
  if (canViewChecklistLibrary) return true
  const role = normalizeRole(user?.role)
  return ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh", "supervisor"].includes(role)
}

function userChecklistArea(user) {
  return user?.area_name || user?.areaName || ""
}

function normalizeChecklistAreaKey(value) {
  if (!value) return ""
  return String(value).trim()
}

function checklistAreasMatch(left, right) {
  if (!left || !right) return false
  return normalizeChecklistAreaKey(left).toLowerCase() === normalizeChecklistAreaKey(right).toLowerCase()
}

export function canSeeChecklistRun(run, user, profiles, { seeAll = false } = {}) {
  if (seeAll) return true
  const role = normalizeRole(user?.role)
  const userArea = userChecklistArea(user)
  if (["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"].includes(role)) return true
  if (run.assigned_profile_id === user?.id) return true

  const replaced = hasChecklistReplacement(run)
  if (replaced && run.original_assigned_profile_id === user?.id) return false

  if (!run.assigned_profile_id && run.assigned_role && normalizeRole(run.assigned_role) === role) return true
  if (!run.assigned_profile_id && run.area && userArea && checklistAreasMatch(run.area, userArea)) return true
  if (role === "supervisor") {
    if (run.supervisor_profile_id === user?.id) return true
    if (userArea && run.area && checklistAreasMatch(run.area, userArea)) return true
    const assigned = profiles.find((profile) => profile.id === run.assigned_profile_id)
    if (assigned && String(assigned.supervisor_profile_id || "") === String(user?.id || "")) return true
    return Boolean(userArea && assigned?.area_name && checklistAreasMatch(assigned.area_name, userArea))
  }
  return false
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

export function filterVisibleChecklistRuns(runs, user, profiles, { seeAll = false } = {}) {
  return (runs || []).filter((run) => (
    run?.status !== "cancelled" && canSeeChecklistRun(run, user, profiles, { seeAll })
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
  canViewChecklistLibrary = false,
  operationalToday = null,
  loadDiagnostics = null
} = {}) {
  const today = operationalToday || getChecklistOperationalDate()
  const seeAll = canSeeAllChecklistModuleRuns(user, canViewChecklistLibrary)
  const nonCancelled = (rawRuns || []).filter((run) => run?.status !== "cancelled")
  const visibleRuns = filterVisibleChecklistRuns(rawRuns, user, profiles, { seeAll })
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
      historicPending: visibleRuns.filter((run) => isChecklistRunHistoricPending(run)).length,
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
