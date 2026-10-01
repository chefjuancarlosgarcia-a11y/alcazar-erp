-- ACL hardening for functions created by 203.
-- Apply after 203_finance_accounting_multibranch_foundation.sql.
-- If 219 ran before 203, CREATE OR REPLACE in 203 keeps the safe chart ACL.
-- This file does not touch those 202 signatures.
-- Idempotent. Does not replace bodies, owners, security mode, search_path,
-- tables, policies, triggers, or rows. Does not change default privileges.
--
-- Classification
--   API pública autenticada:
--     list/create/update/set_active/set_main de branches;
--     list/create/update/set_active de centros de costo;
--     list/create/set_status/reopen de periodos.
--   Autorización requerida por RLS:
--     can_manage_accounting_structure (branches y centros de costo);
--     can_manage_accounting_periods, can_close_accounting_period,
--     can_reopen_accounting_period (periodos).
--   Helper interno:
--     normalize, parent_level, assert_no_cycle, assert_branch_hierarchy,
--     period_bounds, dimension rules, row_to_json.
--
-- EXECUTE resultante
--   PUBLIC y anon: ninguna de las 29 firmas nuevas de 203.
--   authenticated y service_role: solo la API pública y las cuatro
--   funciones de autorización usadas por RLS.
--   Helpers: solo el owner.

revoke all on function public.can_manage_accounting_structure() from public, anon;
grant execute on function public.can_manage_accounting_structure() to authenticated, service_role;

revoke all on function public.can_manage_accounting_periods() from public, anon;
grant execute on function public.can_manage_accounting_periods() to authenticated, service_role;

revoke all on function public.can_close_accounting_period() from public, anon;
grant execute on function public.can_close_accounting_period() to authenticated, service_role;

revoke all on function public.can_reopen_accounting_period() from public, anon;
grant execute on function public.can_reopen_accounting_period() to authenticated, service_role;

revoke all on function public.list_branches(text, boolean, boolean) from public, anon;
grant execute on function public.list_branches(text, boolean, boolean) to authenticated, service_role;

revoke all on function public.create_branch(jsonb) from public, anon;
grant execute on function public.create_branch(jsonb) to authenticated, service_role;

revoke all on function public.update_branch(uuid, jsonb) from public, anon;
grant execute on function public.update_branch(uuid, jsonb) to authenticated, service_role;

revoke all on function public.set_branch_active(uuid, boolean) from public, anon;
grant execute on function public.set_branch_active(uuid, boolean) to authenticated, service_role;

revoke all on function public.set_branch_main(uuid) from public, anon;
grant execute on function public.set_branch_main(uuid) to authenticated, service_role;

revoke all on function public.list_finance_cost_centers(text, uuid, boolean, boolean) from public, anon;
grant execute on function public.list_finance_cost_centers(text, uuid, boolean, boolean) to authenticated, service_role;

revoke all on function public.create_finance_cost_center(jsonb) from public, anon;
grant execute on function public.create_finance_cost_center(jsonb) to authenticated, service_role;

revoke all on function public.update_finance_cost_center(uuid, jsonb) from public, anon;
grant execute on function public.update_finance_cost_center(uuid, jsonb) to authenticated, service_role;

revoke all on function public.set_finance_cost_center_active(uuid, boolean) from public, anon;
grant execute on function public.set_finance_cost_center_active(uuid, boolean) to authenticated, service_role;

revoke all on function public.list_finance_accounting_periods(integer, text) from public, anon;
grant execute on function public.list_finance_accounting_periods(integer, text) to authenticated, service_role;

revoke all on function public.create_finance_accounting_period(integer, integer) from public, anon;
grant execute on function public.create_finance_accounting_period(integer, integer) to authenticated, service_role;

revoke all on function public.set_finance_accounting_period_status(uuid, text) from public, anon;
grant execute on function public.set_finance_accounting_period_status(uuid, text) to authenticated, service_role;

revoke all on function public.reopen_finance_accounting_period(uuid, text) from public, anon;
grant execute on function public.reopen_finance_accounting_period(uuid, text) to authenticated, service_role;

revoke all on function public.branch_normalize_code(text) from public, anon, authenticated, service_role;
revoke all on function public.finance_cost_center_normalize_code(text) from public, anon, authenticated, service_role;
revoke all on function public.finance_cost_center_assert_branch_hierarchy(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_account_default_branch_dimension_rule(text) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_account_default_cost_center_dimension_rule(text) from public, anon, authenticated, service_role;
revoke all on function public.finance_chart_account_validate_dimension_rule(text) from public, anon, authenticated, service_role;
revoke all on function public.finance_cost_center_parent_level(uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_cost_center_assert_no_cycle(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_accounting_period_bounds(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.branch_row_to_json(public.branches) from public, anon, authenticated, service_role;
revoke all on function public.finance_cost_center_row_to_json(public.finance_cost_centers) from public, anon, authenticated, service_role;
revoke all on function public.finance_accounting_period_row_to_json(public.finance_accounting_periods) from public, anon, authenticated, service_role;
