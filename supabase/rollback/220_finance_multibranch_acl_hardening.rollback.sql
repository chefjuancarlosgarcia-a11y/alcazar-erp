-- Technical rollback of 220. Restores the ACL that exists immediately after 203
-- when Supabase default privileges copied EXECUTE to anon, authenticated and
-- service_role, and 203 revoked PUBLIC on every new function except
-- finance_accounting_period_bounds, which received no revoke.
-- Not a security fix. Does not change rows, bodies, owners, or default privileges.

revoke all on function public.can_manage_accounting_structure() from public;
grant execute on function public.can_manage_accounting_structure() to anon, authenticated, service_role;

revoke all on function public.can_manage_accounting_periods() from public;
grant execute on function public.can_manage_accounting_periods() to anon, authenticated, service_role;

revoke all on function public.can_close_accounting_period() from public;
grant execute on function public.can_close_accounting_period() to anon, authenticated, service_role;

revoke all on function public.can_reopen_accounting_period() from public;
grant execute on function public.can_reopen_accounting_period() to anon, authenticated, service_role;

revoke all on function public.list_branches(text, boolean, boolean) from public;
grant execute on function public.list_branches(text, boolean, boolean) to anon, authenticated, service_role;

revoke all on function public.create_branch(jsonb) from public;
grant execute on function public.create_branch(jsonb) to anon, authenticated, service_role;

revoke all on function public.update_branch(uuid, jsonb) from public;
grant execute on function public.update_branch(uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.set_branch_active(uuid, boolean) from public;
grant execute on function public.set_branch_active(uuid, boolean) to anon, authenticated, service_role;

revoke all on function public.set_branch_main(uuid) from public;
grant execute on function public.set_branch_main(uuid) to anon, authenticated, service_role;

revoke all on function public.list_finance_cost_centers(text, uuid, boolean, boolean) from public;
grant execute on function public.list_finance_cost_centers(text, uuid, boolean, boolean) to anon, authenticated, service_role;

revoke all on function public.create_finance_cost_center(jsonb) from public;
grant execute on function public.create_finance_cost_center(jsonb) to anon, authenticated, service_role;

revoke all on function public.update_finance_cost_center(uuid, jsonb) from public;
grant execute on function public.update_finance_cost_center(uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.set_finance_cost_center_active(uuid, boolean) from public;
grant execute on function public.set_finance_cost_center_active(uuid, boolean) to anon, authenticated, service_role;

revoke all on function public.list_finance_accounting_periods(integer, text) from public;
grant execute on function public.list_finance_accounting_periods(integer, text) to anon, authenticated, service_role;

revoke all on function public.create_finance_accounting_period(integer, integer) from public;
grant execute on function public.create_finance_accounting_period(integer, integer) to anon, authenticated, service_role;

revoke all on function public.set_finance_accounting_period_status(uuid, text) from public;
grant execute on function public.set_finance_accounting_period_status(uuid, text) to anon, authenticated, service_role;

revoke all on function public.reopen_finance_accounting_period(uuid, text) from public;
grant execute on function public.reopen_finance_accounting_period(uuid, text) to anon, authenticated, service_role;

revoke all on function public.branch_normalize_code(text) from public;
grant execute on function public.branch_normalize_code(text) to anon, authenticated, service_role;

revoke all on function public.finance_cost_center_normalize_code(text) from public;
grant execute on function public.finance_cost_center_normalize_code(text) to anon, authenticated, service_role;

revoke all on function public.finance_cost_center_assert_branch_hierarchy(uuid, uuid) from public;
grant execute on function public.finance_cost_center_assert_branch_hierarchy(uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_default_branch_dimension_rule(text) from public;
grant execute on function public.finance_chart_account_default_branch_dimension_rule(text) to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_default_cost_center_dimension_rule(text) from public;
grant execute on function public.finance_chart_account_default_cost_center_dimension_rule(text) to anon, authenticated, service_role;

revoke all on function public.finance_chart_account_validate_dimension_rule(text) from public;
grant execute on function public.finance_chart_account_validate_dimension_rule(text) to anon, authenticated, service_role;

revoke all on function public.finance_cost_center_parent_level(uuid) from public;
grant execute on function public.finance_cost_center_parent_level(uuid) to anon, authenticated, service_role;

revoke all on function public.finance_cost_center_assert_no_cycle(uuid, uuid) from public;
grant execute on function public.finance_cost_center_assert_no_cycle(uuid, uuid) to anon, authenticated, service_role;

grant execute on function public.finance_accounting_period_bounds(integer, integer) to public, anon, authenticated, service_role;

revoke all on function public.branch_row_to_json(public.branches) from public;
grant execute on function public.branch_row_to_json(public.branches) to anon, authenticated, service_role;

revoke all on function public.finance_cost_center_row_to_json(public.finance_cost_centers) from public;
grant execute on function public.finance_cost_center_row_to_json(public.finance_cost_centers) to anon, authenticated, service_role;

revoke all on function public.finance_accounting_period_row_to_json(public.finance_accounting_periods) from public;
grant execute on function public.finance_accounting_period_row_to_json(public.finance_accounting_periods) to anon, authenticated, service_role;
