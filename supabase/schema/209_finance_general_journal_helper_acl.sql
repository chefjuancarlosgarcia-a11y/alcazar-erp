-- Finance accounting Phase A — General Journal helper ACL fix.
-- Apply after 208_finance_general_journal.sql (Stage may already have 208 COMMIT).
-- Root cause: helper finance_general_journal_row_to_json only revoked PUBLIC;
-- Supabase default EXECUTE grants can remain for authenticated/anon on internal helpers.
-- Idempotent: safe to re-apply; does not replace or drop 208 objects.

revoke all on function public.finance_general_journal_row_to_json(
  uuid, uuid, date, text, text, text, smallint, uuid, text, text, text, text,
  uuid, text, text, uuid, text, text, numeric, numeric, boolean, uuid, text, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.get_finance_general_journal(
  date, date, uuid, uuid, uuid, uuid, text, integer, integer, timestamptz
) from public, anon;

grant execute on function public.get_finance_general_journal(
  date, date, uuid, uuid, uuid, uuid, text, integer, integer, timestamptz
) to authenticated;
