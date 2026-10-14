function blankAssignmentValue(value) {
  const text = String(value ?? "").trim()
  return text || null
}

export function checklistDueTimeKey(value) {
  const text = blankAssignmentValue(value)
  if (!text) return null
  const match = text.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return text
  return `${match[1].padStart(2, "0")}:${match[2]}`
}

export function checklistAssignmentMatchesRun(run, payload = {}) {
  return (run?.assigned_profile_id || null) === blankAssignmentValue(payload.assigned_profile_id)
    && blankAssignmentValue(run?.assigned_role) === blankAssignmentValue(payload.assigned_role)
    && blankAssignmentValue(run?.area) === blankAssignmentValue(payload.area)
    && checklistDueTimeKey(run?.due_time) === checklistDueTimeKey(payload.due_time)
}
