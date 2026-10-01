-- Technical rollback of 221. Restores the ACL that exists immediately after 204
-- when Supabase default privileges copied EXECUTE to anon, authenticated and
-- service_role, and 204 revoked PUBLIC. Not a security fix. Does not change
-- rows, bodies, owners, or default privileges.

revoke all on function public.can_view_accounting() from public;
grant execute on function public.can_view_accounting() to anon, authenticated, service_role;

revoke all on function public.create_finance_journal_draft(jsonb) from public;
grant execute on function public.create_finance_journal_draft(jsonb) to anon, authenticated, service_role;

revoke all on function public.replace_finance_journal_lines(uuid, jsonb) from public;
grant execute on function public.replace_finance_journal_lines(uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.submit_finance_journal_entry(uuid) from public;
grant execute on function public.submit_finance_journal_entry(uuid) to anon, authenticated, service_role;

revoke all on function public.reject_finance_journal_entry(uuid, text) from public;
grant execute on function public.reject_finance_journal_entry(uuid, text) to anon, authenticated, service_role;

revoke all on function public.approve_finance_journal_entry(uuid) from public;
grant execute on function public.approve_finance_journal_entry(uuid) to anon, authenticated, service_role;

revoke all on function public.post_finance_journal_entry(uuid) from public;
grant execute on function public.post_finance_journal_entry(uuid) to anon, authenticated, service_role;

revoke all on function public.reverse_finance_journal_entry(uuid, text, date) from public;
grant execute on function public.reverse_finance_journal_entry(uuid, text, date) to anon, authenticated, service_role;

revoke all on function public.get_finance_journal_entry(uuid) from public;
grant execute on function public.get_finance_journal_entry(uuid) to anon, authenticated, service_role;

revoke all on function public.list_finance_journal_entries(text, uuid, date, date, text) from public;
grant execute on function public.list_finance_journal_entries(text, uuid, date, date, text) to anon, authenticated, service_role;

revoke all on function public.can_create_journal() from public;
grant execute on function public.can_create_journal() to anon, authenticated, service_role;

revoke all on function public.can_approve_journal() from public;
grant execute on function public.can_approve_journal() to anon, authenticated, service_role;

revoke all on function public.can_post_journal() from public;
grant execute on function public.can_post_journal() to anon, authenticated, service_role;

revoke all on function public.can_post_journal_in_soft_closed_period() from public;
grant execute on function public.can_post_journal_in_soft_closed_period() to anon, authenticated, service_role;

revoke all on function public.can_reverse_journal() from public;
grant execute on function public.can_reverse_journal() to anon, authenticated, service_role;

revoke all on function public.accounting_journal_branch_scope() from public;
grant execute on function public.accounting_journal_branch_scope() to anon, authenticated, service_role;

revoke all on function public.finance_journal_entry_guard_transitions() from public;
grant execute on function public.finance_journal_entry_guard_transitions() to anon, authenticated, service_role;

revoke all on function public.finance_journal_entry_block_posted_mutation() from public;
grant execute on function public.finance_journal_entry_block_posted_mutation() to anon, authenticated, service_role;

revoke all on function public.finance_journal_line_block_posted_parent() from public;
grant execute on function public.finance_journal_line_block_posted_parent() to anon, authenticated, service_role;

revoke all on function public.finance_journal_resolve_period(date) from public;
grant execute on function public.finance_journal_resolve_period(date) to anon, authenticated, service_role;

revoke all on function public.finance_journal_next_entry_number(integer) from public;
grant execute on function public.finance_journal_next_entry_number(integer) to anon, authenticated, service_role;

revoke all on function public.finance_journal_validate_cost_center_branch(uuid, uuid) from public;
grant execute on function public.finance_journal_validate_cost_center_branch(uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.finance_journal_validate_line(jsonb) from public;
grant execute on function public.finance_journal_validate_line(jsonb) to anon, authenticated, service_role;

revoke all on function public.finance_journal_validate_entry_balance(uuid) from public;
grant execute on function public.finance_journal_validate_entry_balance(uuid) to anon, authenticated, service_role;

revoke all on function public.finance_journal_assert_postable_period(public.finance_accounting_periods) from public;
grant execute on function public.finance_journal_assert_postable_period(public.finance_accounting_periods) to anon, authenticated, service_role;

revoke all on function public.finance_journal_line_row_to_json(public.finance_journal_lines) from public;
grant execute on function public.finance_journal_line_row_to_json(public.finance_journal_lines) to anon, authenticated, service_role;

revoke all on function public.finance_journal_entry_row_to_json(public.finance_journal_entries) from public;
grant execute on function public.finance_journal_entry_row_to_json(public.finance_journal_entries) to anon, authenticated, service_role;
