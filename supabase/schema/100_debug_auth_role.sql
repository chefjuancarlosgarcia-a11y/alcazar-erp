-- Temporary diagnostic: verify auth.role() when print-agent calls Supabase with service role JWT.
-- Remove after debugging get_pending_print_jobs auth filter.
-- Apply after 099_pos_printer_receipt_support.sql.

create or replace function public.debug_auth_role()
returns text
language sql
security definer
set search_path = ''
as $$
  select auth.role();
$$;

revoke all on function public.debug_auth_role() from public;
grant execute on function public.debug_auth_role() to service_role;
