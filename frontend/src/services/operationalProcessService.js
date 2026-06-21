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
