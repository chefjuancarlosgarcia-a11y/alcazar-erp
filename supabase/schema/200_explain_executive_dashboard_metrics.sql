-- EXPLAIN helper for 200 (run in lab with authenticated JWT context).
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', 'a2100000-0000-4000-8000-000000000099', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
explain (analyze, buffers, format text)
select public.get_executive_dashboard_metrics('2026-07-31 13:34:00+00'::timestamptz);
select pg_column_size(public.get_executive_dashboard_metrics('2026-07-31 13:34:00+00'::timestamptz)) as rpc_payload_bytes;
