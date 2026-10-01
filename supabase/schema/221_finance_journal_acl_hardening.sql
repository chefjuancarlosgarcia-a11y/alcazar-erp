-- ACL hardening for functions created by 204.
-- Apply after 204_finance_accounting_journal_engine.sql and after 220.
-- 204 replaces set_finance_accounting_period_status. CREATE OR REPLACE keeps
-- the ACL left by 220. This file does not touch that signature or any 202/203
-- function.
-- Idempotent. Does not replace bodies, owners, security mode, search_path,
-- tables, policies, triggers, or rows. Does not change default privileges.
--
-- Classification
--   API pública autenticada:
--     create draft, replace lines, submit, reject, approve, post, reverse,
--     get, list.
--   Autorización requerida por RLS:
--     can_view_accounting (select de partidas y líneas).
--   Helper interno:
--     can_create/approve/post/reverse y el alcance de sucursal, porque los
--     RPC SECURITY DEFINER los ejecutan como owner y ninguna policy los llama;
--     triggers del diario; resolve_period, next_entry_number, validaciones,
--     assert_postable_period y row_to_json.
--
-- EXECUTE resultante
--   PUBLIC y anon: ninguna de las 27 firmas nuevas de 204.
--   authenticated y service_role: solo la API pública y can_view_accounting.
--   Helpers y triggers: solo el owner.

revoke all on function public.can_view_accounting() from public, anon;
grant execute on function public.can_view_accounting() to authenticated, service_role;

revoke all on function public.create_finance_journal_draft(jsonb) from public, anon;
grant execute on function public.create_finance_journal_draft(jsonb) to authenticated, service_role;

revoke all on function public.replace_finance_journal_lines(uuid, jsonb) from public, anon;
grant execute on function public.replace_finance_journal_lines(uuid, jsonb) to authenticated, service_role;

revoke all on function public.submit_finance_journal_entry(uuid) from public, anon;
grant execute on function public.submit_finance_journal_entry(uuid) to authenticated, service_role;

revoke all on function public.reject_finance_journal_entry(uuid, text) from public, anon;
grant execute on function public.reject_finance_journal_entry(uuid, text) to authenticated, service_role;

revoke all on function public.approve_finance_journal_entry(uuid) from public, anon;
grant execute on function public.approve_finance_journal_entry(uuid) to authenticated, service_role;

revoke all on function public.post_finance_journal_entry(uuid) from public, anon;
grant execute on function public.post_finance_journal_entry(uuid) to authenticated, service_role;

revoke all on function public.reverse_finance_journal_entry(uuid, text, date) from public, anon;
grant execute on function public.reverse_finance_journal_entry(uuid, text, date) to authenticated, service_role;

revoke all on function public.get_finance_journal_entry(uuid) from public, anon;
grant execute on function public.get_finance_journal_entry(uuid) to authenticated, service_role;

revoke all on function public.list_finance_journal_entries(text, uuid, date, date, text) from public, anon;
grant execute on function public.list_finance_journal_entries(text, uuid, date, date, text) to authenticated, service_role;

revoke all on function public.can_create_journal() from public, anon, authenticated, service_role;
revoke all on function public.can_approve_journal() from public, anon, authenticated, service_role;
revoke all on function public.can_post_journal() from public, anon, authenticated, service_role;
revoke all on function public.can_post_journal_in_soft_closed_period() from public, anon, authenticated, service_role;
revoke all on function public.can_reverse_journal() from public, anon, authenticated, service_role;
revoke all on function public.accounting_journal_branch_scope() from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_entry_guard_transitions() from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_entry_block_posted_mutation() from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_line_block_posted_parent() from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_resolve_period(date) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_next_entry_number(integer) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_validate_cost_center_branch(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_validate_line(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_validate_entry_balance(uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_assert_postable_period(public.finance_accounting_periods) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_line_row_to_json(public.finance_journal_lines) from public, anon, authenticated, service_role;
revoke all on function public.finance_journal_entry_row_to_json(public.finance_journal_entries) from public, anon, authenticated, service_role;
