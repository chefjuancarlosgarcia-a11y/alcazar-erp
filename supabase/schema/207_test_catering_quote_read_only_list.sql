-- Regression tests for 207_catering_quote_read_only_list.sql
-- Run AFTER applying 207. Entire file: BEGIN … ROLLBACK (no COMMIT).

begin;

create or replace function public.test_catering_quote_read_only_list_207()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_ventas uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_denied uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_request_a uuid := 'd1111111-1111-1111-1111-111111111111';
  v_request_b uuid := 'd2222222-2222-2222-2222-222222222222';
  v_quote_a1 uuid := 'e1111111-1111-1111-1111-111111111111';
  v_quote_a2 uuid := 'e2222222-2222-2222-2222-222222222222';
  v_quote_b1 uuid := 'e3333333-3333-3333-3333-333333333333';
  v_result jsonb;
  v_count int;
  v_err text;
begin
  -- Fixture profiles (ignore if migrations already seeded roles elsewhere)
  insert into public.profiles (id, username, full_name, role, status)
  values
    (v_admin, 'test_admin_207', 'Test Admin 207', 'admin', 'active'),
    (v_ventas, 'test_ventas_207', 'Test Ventas 207', 'ventas', 'active'),
    (v_denied, 'test_denied_207', 'Test Denied 207', 'mesero', 'active')
  on conflict (id) do update
  set role = excluded.role, status = excluded.status;

  insert into public.catering_requests (
    id, customer_name, status, conversion_status, source, lead_source, created_by, updated_by
  )
  values
    (v_request_a, 'Lead A 207', 'quoted', 'quoted', 'manual', 'other', v_admin, v_admin),
    (v_request_b, 'Lead B 207', 'new', 'lead', 'manual', 'other', v_admin, v_admin)
  on conflict (id) do nothing;

  insert into public.catering_quotes (
    id, request_id, quote_number, status, subtotal, discount_amount, tax_amount, total, valid_until, created_by
  )
  values
    (v_quote_a1, v_request_a, 'TEST-207-0001', 'draft', 100, 0, 12, 112, null, v_admin),
    (v_quote_a2, v_request_a, 'TEST-207-0002', 'sent', 200, 0, 24, 224, current_date - 1, v_admin),
    (v_quote_b1, v_request_b, 'TEST-207-0003', 'sent', 50, 0, 6, 56, current_date + 7, v_admin)
  on conflict (id) do nothing;

  return query
  select 'effective_status_expired'::text,
    public.catering_quote_effective_status('sent', current_date - 1) = 'expired',
    'sent + past valid_until maps to expired without UPDATE'::text;

  return query
  select 'get_quotes_function_is_stable'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'get_catering_request_quotes'
        and p.provolatile = 's'
    ),
    'get_catering_request_quotes remains STABLE'::text;

  return query
  select 'get_quotes_body_has_no_sync_call'::text,
    pg_get_functiondef(p.oid) not ilike '%sync_catering_quote_expired%',
    'get_catering_request_quotes must not call sync_catering_quote_expired'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_catering_request_quotes'
  limit 1;

  return query
  select 'pipeline_body_has_no_sync_call'::text,
    pg_get_functiondef(p.oid) not ilike '%sync_catering_quote_expired%',
    'get_catering_pipeline_summary must not call sync_catering_quote_expired'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_catering_pipeline_summary'
  order by p.oid desc
  limit 1;

  perform set_config('request.jwt.claim.sub', v_ventas::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.get_catering_request_quotes(v_request_a);
  v_count := jsonb_array_length(coalesce(v_result -> 'quotes', '[]'::jsonb));

  return query
  select 'ventas_lists_request_quotes'::text,
    (v_result ->> 'count')::int = 2 and v_count = 2,
    format('expected 2 quotes, got count=%s array=%s', v_result ->> 'count', v_count);

  return query
  select 'ventas_effective_expired_in_list'::text,
    exists (
      select 1
      from jsonb_array_elements(v_result -> 'quotes') item
      where item ->> 'quote_number' = 'TEST-207-0002'
        and item ->> 'status' = 'expired'
    ),
    'past-due sent quote reported as expired in read RPC'::text;

  return query
  select 'ventas_request_isolation'::text,
    (public.get_catering_request_quotes(v_request_b) ->> 'count')::int = 1
      and not exists (
        select 1
        from jsonb_array_elements(public.get_catering_request_quotes(v_request_b) -> 'quotes') item
        where item ->> 'quote_number' like 'TEST-207-000%'
          and item ->> 'quote_number' <> 'TEST-207-0003'
      ),
    'quotes from other leads are not returned'::text;

  begin
    set local transaction_read_only = on;
    perform public.get_catering_request_quotes(v_request_a);
    return query
    select 'read_only_transaction_ok'::text, true, 'get_catering_request_quotes succeeds in READ ONLY'::text;
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      return query
      select 'read_only_transaction_ok'::text, false, v_err;
  end;

  perform set_config('request.jwt.claim.sub', v_denied::text, true);

  begin
    perform public.get_catering_request_quotes(v_request_a);
    return query
    select 'denied_role_rejected'::text, false, 'mesero should not read catering quotes'::text;
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      return query
      select 'denied_role_rejected'::text,
        v_err ilike '%permiso%' or v_err ilike '%permission%',
        v_err;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  return query
  select 'sync_expired_still_exists'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'sync_catering_quote_expired'
    ),
    'explicit sync_catering_quote_expired remains available'::text;

  return query
  select 'zero_quotes_empty_array'::text,
    (public.get_catering_request_quotes(gen_random_uuid()) ->> 'count')::int = 0
      and jsonb_array_length(public.get_catering_request_quotes(gen_random_uuid()) -> 'quotes') = 0,
    'unknown request returns count 0 and empty quotes array'::text;
end;
$$;

select scenario, passed, detail
from public.test_catering_quote_read_only_list_207()
order by scenario;

rollback;
