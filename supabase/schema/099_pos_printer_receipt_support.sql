-- Ensure CAJA printers can receive receipt jobs (same pattern as 096 for prebill).
-- Apply after 098_fix_create_print_job_job_type_check.sql.

update public.pos_printers
set supported_job_types = array(
  select distinct unnest(coalesce(supported_job_types, array[]::text[]) || array['receipt']::text[])
)
where is_active = true
  and (
    lower(coalesce(name, '')) = 'caja'
    or lower(coalesce(windows_printer_name, '')) = 'caja'
    or lower(coalesce(location, '')) = 'caja'
  )
  and not ('receipt' = any(coalesce(supported_job_types, array[]::text[])));
