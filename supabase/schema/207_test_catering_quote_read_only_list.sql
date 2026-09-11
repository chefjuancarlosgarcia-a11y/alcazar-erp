-- Regression tests for 207_catering_quote_read_only_list.sql
-- Run AFTER applying 207. Entire file: BEGIN … ROLLBACK (no COMMIT).
--
-- Fixture safety:
--   - No INSERT/UPDATE/DELETE on auth.users
--   - No INSERT/UPDATE/DELETE on existing profiles (read-only actor lookup)
--   - Temporary rows use fixed TEST-207-* UUIDs inside this transaction only
--   - No permanent role/grant/RLS changes; test function rolls back with ROLLBACK

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
  v_actor uuid;
  v_denied_sub text := '00000000-0000-0000-0000-000000000000';
  v_request_a uuid := 'd1111111-1111-1111-1111-111111111111';
  v_request_b uuid := 'd2222222-2222-2222-2222-222222222222';
  v_request_one uuid := 'd3333333-3333-3333-3333-333333333333';
  v_quote_a1 uuid := 'e1111111-1111-1111-1111-111111111111';
  v_quote_a2 uuid := 'e2222222-2222-2222-2222-222222222222';
  v_quote_b1 uuid := 'e3333333-3333-3333-3333-333333333333';
  v_quote_one uuid := 'e4444444-4444-4444-4444-444444444444';
  v_quote_draft uuid := 'e5555555-5555-5555-5555-555555555555';
  v_quote_approved uuid := 'e6666666-6666-6666-6666-666666666666';
  v_quote_rejected uuid := 'e7777777-7777-7777-7777-777777777777';
  v_quote_sent_ok uuid := 'e8888888-8888-8888-8888-888888888888';
  v_quote_null_until uuid := 'e9999999-9999-9999-9999-999999999999';
  v_result jsonb;
  v_count int;
  v_err text;
  v_sync_first int;
  v_sync_second int;
  v_activity_before int;
  v_activity_after int;
  v_db_status text;
begin
  select profile.id
  into v_actor
  from public.profiles profile
  where profile.status = 'active'
    and public.normalize_profile_role(profile.role) in ('ventas', 'admin')
  order by case public.normalize_profile_role(profile.role)
    when 'ventas' then 0
    when 'admin' then 1
    else 2
  end
  limit 1;

  if v_actor is null then
    raise exception 'No active ventas/admin profile available for Stage fixture';
  end if;

  insert into public.catering_requests (
    id, customer_name, status, conversion_status, source, lead_source, created_by, updated_by
  )
  values
    (v_request_a, 'Lead A 207', 'quoted', 'quoted', 'manual', 'other', v_actor, v_actor),
    (v_request_b, 'Lead B 207', 'new', 'lead', 'manual', 'other', v_actor, v_actor),
    (v_request_one, 'Lead One 207', 'quoted', 'quoted', 'manual', 'other', v_actor, v_actor);

  insert into public.catering_quotes (
    id, request_id, quote_number, status, subtotal, discount_amount, tax_amount, total, valid_until, created_by
  )
  values
    (v_quote_a1, v_request_a, 'TEST-207-0001', 'draft', 100, 0, 12, 112, null, v_actor),
    (v_quote_a2, v_request_a, 'TEST-207-0002', 'sent', 200, 0, 24, 224, current_date - 1, v_actor),
    (v_quote_b1, v_request_b, 'TEST-207-0003', 'sent', 50, 0, 6, 56, current_date + 7, v_actor),
    (v_quote_one, v_request_one, 'TEST-207-0004', 'sent', 300, 0, 36, 336, current_date + 3, v_actor),
    (v_quote_draft, v_request_a, 'TEST-207-0005', 'draft', 80, 0, 10, 90, current_date - 5, v_actor),
    (v_quote_approved, v_request_a, 'TEST-207-0006', 'approved', 400, 0, 48, 448, current_date - 2, v_actor),
    (v_quote_rejected, v_request_a, 'TEST-207-0007', 'rejected', 120, 0, 14, 134, current_date - 3, v_actor),
    (v_quote_sent_ok, v_request_a, 'TEST-207-0008', 'sent', 150, 0, 18, 168, current_date + 10, v_actor),
    (v_quote_null_until, v_request_a, 'TEST-207-0009', 'sent', 90, 0, 11, 101, null, v_actor);

  return query
  select 'effective_status_is_stable'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'catering_quote_effective_status'
        and p.provolatile = 's'
    ),
    'catering_quote_effective_status must be STABLE (uses current_date)'::text;

  return query
  select 'effective_status_expired'::text,
    public.catering_quote_effective_status('sent', current_date - 1) = 'expired',
    'sent + past valid_until maps to expired without UPDATE'::text;

  return query
  select 'effective_status_sent_current'::text,
    public.catering_quote_effective_status('sent', current_date + 7) = 'sent',
    'sent + future valid_until remains sent'::text;

  return query
  select 'effective_status_draft_past'::text,
    public.catering_quote_effective_status('draft', current_date - 5) = 'draft',
    'draft past valid_until remains draft'::text;

  return query
  select 'effective_status_approved_past'::text,
    public.catering_quote_effective_status('approved', current_date - 2) = 'approved',
    'approved past valid_until remains approved'::text;

  return query
  select 'effective_status_rejected_past'::text,
    public.catering_quote_effective_status('rejected', current_date - 3) = 'rejected',
    'rejected past valid_until remains rejected'::text;

  return query
  select 'effective_status_null_valid_until'::text,
    public.catering_quote_effective_status('sent', null) = 'sent',
    'sent with NULL valid_until does not expire'::text;

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
  select 'pipeline_function_is_stable'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'get_catering_pipeline_summary'
        and p.provolatile = 's'
    ),
    'get_catering_pipeline_summary remains STABLE'::text;

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

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.get_catering_request_quotes(v_request_a);
  v_count := jsonb_array_length(coalesce(v_result -> 'quotes', '[]'::jsonb));

  return query
  select 'ventas_lists_request_quotes'::text,
    (v_result ->> 'count')::int >= 2 and v_count >= 2,
    format('expected at least 2 quotes, got count=%s array=%s', v_result ->> 'count', v_count);

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
  select 'ventas_effective_sent_current_in_list'::text,
    exists (
      select 1
      from jsonb_array_elements(v_result -> 'quotes') item
      where item ->> 'quote_number' = 'TEST-207-0008'
        and item ->> 'status' = 'sent'
    ),
    'current sent quote remains sent in read RPC'::text;

  return query
  select 'ventas_draft_past_stays_draft'::text,
    exists (
      select 1
      from jsonb_array_elements(v_result -> 'quotes') item
      where item ->> 'quote_number' = 'TEST-207-0005'
        and item ->> 'status' = 'draft'
    ),
    'past-due draft remains draft in read RPC'::text;

  return query
  select 'ventas_null_valid_until_stays_sent'::text,
    exists (
      select 1
      from jsonb_array_elements(v_result -> 'quotes') item
      where item ->> 'quote_number' = 'TEST-207-0009'
        and item ->> 'status' = 'sent'
    ),
    'sent with NULL valid_until stays sent in read RPC'::text;

  return query
  select 'single_quote_request'::text,
    (public.get_catering_request_quotes(v_request_one) ->> 'count')::int = 1
      and jsonb_array_length(public.get_catering_request_quotes(v_request_one) -> 'quotes') = 1,
    'one quote request returns count 1'::text;

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
    select 'request_quotes_read_only_ok'::text, true, 'get_catering_request_quotes succeeds in READ ONLY'::text;
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      return query
      select 'request_quotes_read_only_ok'::text, false, v_err;
  end;

  begin
    set local transaction_read_only = on;
    perform public.get_catering_pipeline_summary(current_date - 30, current_date);
    return query
    select 'pipeline_read_only_ok'::text, true, 'get_catering_pipeline_summary succeeds in READ ONLY'::text;
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      return query
      select 'pipeline_read_only_ok'::text, false, v_err;
  end;

  perform set_config('request.jwt.claim.sub', v_denied_sub, true);

  begin
    perform public.get_catering_request_quotes(v_request_a);
    return query
    select 'denied_role_rejected'::text, false, 'unauthorized subject should not read catering quotes'::text;
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      return query
      select 'denied_role_rejected'::text,
        v_err ilike '%permiso%' or v_err ilike '%permission%',
        v_err;
  end;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);

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
  select 'sync_body_requires_sent_status'::text,
    pg_get_functiondef(p.oid) ilike '%status = ''sent''%',
    'sync UPDATE must filter status = sent'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sync_catering_quote_expired'
  limit 1;

  select status
  into v_db_status
  from public.catering_quotes
  where id = v_quote_a2;

  return query
  select 'pre_sync_db_still_sent'::text,
    v_db_status = 'sent',
    format('expired-effective quote remains sent in DB before sync (%s)', v_db_status);

  select count(*)
  into v_activity_before
  from public.catering_activity_log
  where request_id = v_request_a
    and activity_type = 'quote_expired'
    and metadata ->> 'quote_id' = v_quote_a2::text;

  v_sync_first := public.sync_catering_quote_expired();

  return query
  select 'sync_first_updates_sent_only'::text,
    v_sync_first >= 1,
    format('first sync updated %s sent rows', v_sync_first);

  select status
  into v_db_status
  from public.catering_quotes
  where id = v_quote_a2;

  return query
  select 'sync_persisted_expired_status'::text,
    v_db_status = 'expired',
    format('quote_a2 status after sync: %s', v_db_status);

  select status
  into v_db_status
  from public.catering_quotes
  where id = v_quote_draft;

  return query
  select 'sync_does_not_touch_draft'::text,
    v_db_status = 'draft',
    format('draft quote unchanged after sync (%s)', v_db_status);

  select status
  into v_db_status
  from public.catering_quotes
  where id = v_quote_approved;

  return query
  select 'sync_does_not_touch_approved'::text,
    v_db_status = 'approved',
    format('approved quote unchanged after sync (%s)', v_db_status);

  select count(*)
  into v_activity_after
  from public.catering_activity_log
  where request_id = v_request_a
    and activity_type = 'quote_expired'
    and metadata ->> 'quote_id' = v_quote_a2::text;

  return query
  select 'sync_logs_activity_once'::text,
    v_activity_after = v_activity_before + 1,
    format('quote_expired logs before=%s after=%s', v_activity_before, v_activity_after);

  v_sync_second := public.sync_catering_quote_expired();

  return query
  select 'sync_second_is_idempotent'::text,
    v_sync_second = 0,
    format('second sync updated %s rows', v_sync_second);

  select count(*)
  into v_count
  from public.catering_activity_log
  where request_id = v_request_a
    and activity_type = 'quote_expired'
    and metadata ->> 'quote_id' = v_quote_a2::text;

  return query
  select 'sync_no_duplicate_activity'::text,
    v_count = v_activity_after,
    format('quote_expired log count stable at %s', v_count);

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
