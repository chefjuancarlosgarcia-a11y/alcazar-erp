import { supabase } from "../lib/supabase"

export const PRINT_JOB_TYPES = ["test", "prebill", "receipt", "delivery_order"]

export async function getPosPrinters() {
  const { data, error } = await supabase
    .from("pos_printers")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name", { ascending: true })
  return { data: data || [], error }
}

export async function savePosPrinter(printer) {
  const payload = {
    name: printer.name?.trim(),
    windows_printer_name: printer.windows_printer_name?.trim(),
    location: printer.location?.trim() || null,
    printer_type: printer.printer_type || "windows_usb",
    ip_address: printer.ip_address?.trim() || null,
    port: Number(printer.port || 9100),
    paper_width: printer.paper_width || "80mm",
    supported_job_types: Array.isArray(printer.supported_job_types) && printer.supported_job_types.length
      ? printer.supported_job_types
      : ["test"],
    is_active: printer.is_active !== false
  }

  const query = printer.id
    ? supabase.from("pos_printers").update(payload).eq("id", printer.id).select("*").single()
    : supabase.from("pos_printers").insert(payload).select("*").single()

  const { data, error } = await query
  return { data, error }
}

export async function setPosPrinterActive(id, isActive) {
  const { data, error } = await supabase
    .from("pos_printers")
    .update({ is_active: Boolean(isActive) })
    .eq("id", id)
    .select("*")
    .single()
  return { data, error }
}

export async function createPrintJob({ printerId, jobType = "test", payload = {} }) {
  const { data, error } = await supabase.rpc("create_print_job", {
    p_printer_id: printerId,
    p_job_type: jobType,
    p_payload: payload
  })
  return { data, error }
}

export function buildTestPrintPayload(printer) {
  return {
    title: "PRUEBA DE IMPRESIÓN ERP",
    business_name: "EL GRAN ALCÁZAR",
    printer_name: printer.name,
    windows_printer_name: printer.windows_printer_name,
    requested_at: new Date().toISOString()
  }
}
