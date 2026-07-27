-- Rollback 195_fix_operational_operator_pgcrypto_schema.sql (forward-only companion).
-- No safe downgrade: reverting to public.digest breaks Supabase runtime. Re-apply 195 if needed.

begin;
commit;
