-- Technical rollback for 219_finance_accounting_acl_hardening.sql.
-- Restores the ACL observed after 202 under Supabase default privileges:
--   PUBLIC without EXECUTE;
--   anon, authenticated and service_role with EXECUTE.
-- Does not change function bodies, owners, tables, policies, or rows.
-- Not a security fix. Do not apply unless reversing 219 on purpose.

revoke all on function public.can_manage_accounting_catalog() from public;
grant execute on function public.can_manage_accounting_catalog() to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_normalize_code(text) from public;
grant execute on function public.finance_chart_account_normalize_code(text) to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_parent_level(uuid) from public;
grant execute on function public.finance_chart_account_parent_level(uuid) to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_assert_no_cycle(uuid, uuid) from public;
grant execute on function public.finance_chart_account_assert_no_cycle(uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_row_to_json(public.finance_chart_accounts) from public;
grant execute on function public.finance_chart_account_row_to_json(public.finance_chart_accounts) to anon, authenticated, service_role;

revoke all on function public.list_finance_chart_accounts(text, text, text, text, boolean, boolean) from public;
grant execute on function public.list_finance_chart_accounts(text, text, text, text, boolean, boolean) to anon, authenticated, service_role;

revoke all on function public.create_finance_chart_account(jsonb) from public;
grant execute on function public.create_finance_chart_account(jsonb) to anon, authenticated, service_role;

revoke all on function public.update_finance_chart_account(uuid, jsonb) from public;
grant execute on function public.update_finance_chart_account(uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.set_finance_chart_account_active(uuid, boolean) from public;
grant execute on function public.set_finance_chart_account_active(uuid, boolean) to anon, authenticated, service_role;

revoke all on function public.preview_finance_chart_accounts_import(jsonb) from public;
grant execute on function public.preview_finance_chart_accounts_import(jsonb) to anon, authenticated, service_role;

revoke all on function public.finance_chart_import_would_cycle(text, text, jsonb) from public;
grant execute on function public.finance_chart_import_would_cycle(text, text, jsonb) to anon, authenticated, service_role;

revoke all on function public.import_finance_chart_accounts(jsonb) from public;
grant execute on function public.import_finance_chart_accounts(jsonb) to anon, authenticated, service_role;

revoke all on function public.finance_chart_import_sort_rows(jsonb) from public;
grant execute on function public.finance_chart_import_sort_rows(jsonb) to anon, authenticated, service_role;
