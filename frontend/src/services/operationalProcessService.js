import { supabase } from "../lib/supabase"
import { getChecklistOperationalDate } from "../utils/checklistOperationalStatus"

function rpcError(error) {
  return error?.message || "Error en procesos operativos."
}

export async function getOperationalProcessTemplatesLibrary() {
  const { data, error } = await supabase.rpc("get_operational_process_templates_library")
  if (error) return { data: [], error: rpcError(error) }
  return { data: data || [], error: null }
}

export async function getOperationalProcessTemplateDetail(processTemplateId) {
  const { data, error } = await supabase.rpc("get_operational_process_template_detail", {
    p_process_template_id: processTemplateId
  })
  if (error) return { data: null, error: rpcError(error) }
  return { data, error: null }
}

export async function upsertOperationalProcessTemplate(payload, steps = []) {
  const { data, error } = await supabase.rpc("upsert_operational_process_template", {
    p_payload: payload,
    p_steps: steps
  })
  if (error) return { data: null, error: rpcError(error) }
  return { data, error: null }
}

export async function deactivateOperationalProcessTemplate(processTemplateId) {
  const { data, error } = await supabase.rpc("deactivate_operational_process_template", {
    p_process_template_id: processTemplateId
  })
  if (error) return { data: null, error: rpcError(error) }
  return { data, error: null }
}

export async function generateDueOperationalProcessRuns(date = getChecklistOperationalDate()) {
  const result = await supabase.rpc("generate_due_operational_process_runs", { p_target_date: date })
  return result
}

export async function createOperationalProcessRun(processTemplateId, {
  runDate = getChecklistOperationalDate(),
  area = null,
  notes = null
} = {}) {
  const { data, error } = await supabase.rpc("create_operational_process_run", {
    p_process_template_id: processTemplateId,
    p_run_date: runDate,
    p_area: area,
    p_notes: notes
  })
  if (error) return { data: null, error: rpcError(error) }
  return { data, error: null }
}

export async function getOperationalProcessRunDetail(processRunId) {
  const { data, error } = await supabase.rpc("get_operational_process_run_detail", {
    p_process_run_id: processRunId
  })
  if (error) return { data: null, error: rpcError(error) }
  return { data, error: null }
}

export async function getOperationalProcessRunsForDate(runDate = getChecklistOperationalDate()) {
  const { data, error } = await supabase.rpc("get_operational_process_runs_for_date", {
    p_run_date: runDate
  })
  if (error) return { data: [], error: rpcError(error) }
  return { data: data || [], error: null }
}

export async function loadOperationalProcessDetailsForDates(dates = []) {
  const uniqueDates = [...new Set((dates || []).filter(Boolean))].slice(0, 20)
  if (!uniqueDates.length) return { data: [], error: null }

  const results = await Promise.all(uniqueDates.map((runDate) => getOperationalProcessRunsForDate(runDate)))
  const failed = results.find((result) => result.error)
  if (failed?.error) return { data: [], error: failed.error }

  const merged = new Map()
  results.forEach((result) => {
    ;(result.data || []).forEach((detail) => {
      const id = detail?.process_run?.id
      if (id) merged.set(id, detail)
    })
  })
  return { data: Array.from(merged.values()), error: null }
}
