-- Fix get_pending_print_jobs returning zero rows for print-agent.
-- Bug: WHERE auth.role() = 'service_role' is false when auth.role() is NULL
-- (observed via debug_auth_role with service role JWT).
-- Security: EXECUTE granted only to service_role; no auth.role() filter in query.
-- Apply after 100_debug_auth_role.sql.

create or replace function public.get_pending_print_jobs(
  p_location text default null,
  p_limit integer default 10
)
returns table (
  id uuid,
  printer_id uuid,
  job_type text,
  payload jsonb,
  status text,
  attempts integer,
  created_at timestamptz,
  printer_name text,
  windows_printer_name text,
  location text,
  printer_type text,
  ip_address text,
  port integer,
  paper_width text
)
language sql
security definer
set search_path = ''
as $$
  select
    j.id,
    j.printer_id,
    j.job_type,
    j.payload,
    j.status,
    j.attempts,
    j.created_at,
    p.name as printer_name,
    p.windows_printer_name,
    p.location,
    p.printer_type,
    p.ip_address,
    p.port,
    p.paper_width
  from public.print_jobs j
  join public.pos_printers p on p.id = j.printer_id
  where j.status = 'pending'
    and p.is_active = true
    and (
      nullif(trim(coalesce(p_location, '')), '') is null
      or lower(coalesce(p.location, '')) = lower(trim(p_location))
    )
  order by j.created_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.get_pending_print_jobs(text, integer) from public;
revoke all on function public.get_pending_print_jobs(text, integer) from authenticated;
revoke all on function public.get_pending_print_jobs(text, integer) from anon;
grant execute on function public.get_pending_print_jobs(text, integer) to service_role;
