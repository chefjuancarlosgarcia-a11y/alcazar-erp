import { supabase } from "../lib/supabase"

export function getEmployeeSchedules(weekStart, weekEnd) {
  return supabase
    .from("employee_schedules")
    .select("*")
    .gte("shift_date", weekStart)
    .lte("shift_date", weekEnd)
    .order("shift_date")
    .order("start_time")
}

export function getShiftTemplates() {
  return supabase
    .from("shift_templates")
    .select("*")
    .eq("is_active", true)
    .order("name")
}

export function saveEmployeeSchedule(schedule) {
  return supabase.rpc("save_employee_schedule", { p_data: schedule })
}

export function deleteEmployeeSchedule(id) {
  return supabase.rpc("delete_employee_schedule", { p_schedule_id: id })
}

export function publishScheduleWeek(weekStart) {
  return supabase.rpc("publish_schedule_week", { p_week_start: weekStart })
}

export function getScheduleAttendanceSummary(weekStart) {
  return supabase.rpc("get_schedule_attendance_summary", { p_week_start: weekStart })
}

export function getScheduleAttendanceDetails(weekStart) {
  return supabase.rpc("get_schedule_attendance_details", { p_week_start: weekStart })
}

export function reviewPayrollSummary(employeeId, weekStart, status) {
  return supabase.rpc("review_payroll_summary", {
    p_employee_id: employeeId,
    p_week_start: weekStart,
    p_status: status
  })
}
