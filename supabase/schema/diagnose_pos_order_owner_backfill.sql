-- F0A — manual diagnostic queries (read-only, SQL Editor / service_role)
-- Requires 184_pos_order_owner_f0a.sql applied.
-- Not callable from authenticated app users.

select * from public.diagnose_pos_order_owner_integrity() order by check_code;

select count(*) as orphan_order_count from public.diagnose_pos_order_owner_orphans();
