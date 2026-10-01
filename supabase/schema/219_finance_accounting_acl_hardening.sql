-- Finance accounting ACL hardening for the chart functions created by 202.
-- Apply after 202_finance_accounting_chart_of_accounts.sql.
-- Idempotent. Does not replace bodies, owners, SECURITY DEFINER, search_path,
-- tables, policies, or rows. Does not change default privileges.
--
-- Call graph (owner postgres executes internal calls of SECURITY DEFINER functions):
--   RLS insert/update policies -> can_manage_accounting_catalog()
--   list_finance_chart_accounts -> can_view_finance() [unchanged, not in 202]
--                                -> finance_chart_account_row_to_json
--   create/update/set_active/preview/import -> can_manage_accounting_catalog()
--   create/update -> normalize_code, assert_no_cycle, parent_level, row_to_json
--   preview -> normalize_code, would_cycle, chart reads
--   would_cycle -> normalize_code (arguments only)
--   import -> preview, sort_rows, normalize_code, parent_level, chart writes
--   sort_rows -> normalize_code, chart code lookup
--   parent_level / assert_no_cycle -> chart reads
--
-- Classification
--   API pública autenticada:
--     list, create, update, set_active, preview, import
--   Autorización requerida por RLS:
--     can_manage_accounting_catalog
--   Helper interno (no RPC):
--     parent_level, assert_no_cycle, sort_rows, row_to_json
--   Función pura interna (no RPC; el caller DEFINER ya corre como owner):
--     normalize_code, would_cycle
--
-- EXECUTE resultante
--   PUBLIC: ninguna de las 13.
--   anon: ninguna de las 13.
--   authenticated y service_role: solo la API pública y can_manage_accounting_catalog.
--   Helpers internos y funciones puras: solo el owner. authenticated, service_role,
--   anon y PUBLIC quedan sin EXECUTE.

revoke all on function public.can_manage_accounting_catalog() from public, anon;
grant execute on function public.can_manage_accounting_catalog() to authenticated, service_role;

revoke all on function public.list_finance_chart_accounts(text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.list_finance_chart_accounts(text, text, text, text, boolean, boolean) to authenticated, service_role;

revoke all on function public.create_finance_chart_account(jsonb) from public, anon;
grant execute on function public.create_finance_chart_account(jsonb) to authenticated, service_role;

revoke all on function public.update_finance_chart_account(uuid, jsonb) from public, anon;
grant execute on function public.update_finance_chart_account(uuid, jsonb) to authenticated, service_role;

revoke all on function public.set_finance_chart_account_active(uuid, boolean) from public, anon;
grant execute on function public.set_finance_chart_account_active(uuid, boolean) to authenticated, service_role;

revoke all on function public.preview_finance_chart_accounts_import(jsonb) from public, anon;
grant execute on function public.preview_finance_chart_accounts_import(jsonb) to authenticated, service_role;

revoke all on function public.import_finance_chart_accounts(jsonb) from public, anon;
grant execute on function public.import_finance_chart_accounts(jsonb) to authenticated, service_role;

revoke all on function public.finance_chart_account_normalize_code(text) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_account_parent_level(uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_account_assert_no_cycle(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_account_row_to_json(public.finance_chart_accounts) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_import_would_cycle(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_import_sort_rows(jsonb) from public, anon, authenticated, service_role;
