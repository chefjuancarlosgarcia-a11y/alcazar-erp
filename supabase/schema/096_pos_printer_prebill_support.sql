-- Ensure existing POS printers can receive prebill jobs.
-- Apply after 095_printing_foundation.sql.

-- Diagnostic query:
-- select
--   id,
--   name,
--   supported_job_types,
--   is_active
-- from public.pos_printers
-- order by name;

update public.pos_printers
set supported_job_types = array(
  select distinct unnest(coalesce(supported_job_types, array[]::text[]) || array['prebill']::text[])
)
where is_active = true
  and (
    lower(name) = 'caja'
    or lower(windows_printer_name) = 'caja'
  )
  and not ('prebill' = any(coalesce(supported_job_types, array[]::text[])));

