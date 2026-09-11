-- Stage finance accounting transactional smoke (READ/WRITE inside transaction, ROLLBACK at end).
-- Prefix: STAGE_FINANCE_SMOKE. No persistent data when run as a single script (ROLLBACK).
-- Requires 202+203+204 applied. Operator must use contador/admin profile UUID via auth seed below.
-- If run outside a transaction, STOP — this script uses BEGIN … ROLLBACK.
--
-- Cleanup note: if COMMIT happens by mistake, delete rows where description ilike 'STAGE_FINANCE_SMOKE%'
-- and chart accounts where code like 'STAGE_FINANCE_SMOKE%' after explicit approval.

\set ON_ERROR_STOP on

begin;

do $guard$
declare
  v_env text := lower(coalesce(
    (select value ->> 'name' from public.app_settings where key = 'deployment_environment'),
    ''
  ));
  v_stored_ref text := nullif(trim(coalesce(
    (select value ->> 'project_ref' from public.app_settings where key = 'deployment_environment'),
    ''
  )), '');
  v_session_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
begin
  if to_regclass('public.finance_journal_entries') is null then
    raise exception 'Apply 204 before Stage smoke';
  end if;
  if v_env in ('production', 'prod') then
    raise exception 'Stage smoke guard blocked: production environment';
  end if;
  if v_env <> 'stage' then
    raise exception 'Stage smoke guard blocked: deployment_environment.name must be stage';
  end if;
  if v_session_ref is null then
    raise exception 'Stage smoke guard blocked: set alcazar.finance_stage_project_ref before smoke';
  end if;
  if v_stored_ref is null then
    raise exception 'Stage smoke guard blocked: deployment_environment.project_ref missing';
  end if;
  if v_session_ref <> v_stored_ref then
    raise exception 'Stage smoke guard blocked: session project ref does not match stored value';
  end if;
end $guard$;

insert into auth.users (id, aud, role, email) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'stage-finance-smoke-contador@test.local')
on conflict (id) do nothing;

set session_replication_role = replica;

insert into public.profiles (id, full_name, username, role, status) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Stage Smoke Contador', 'stage_smoke_contador', 'contador', 'active')
on conflict (id) do update set role = 'contador', status = 'active';

set session_replication_role = default;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $smoke$
declare
  v_cash uuid;
  v_equity uuid;
  v_period uuid;
  v_entry_id uuid;
  v_posted jsonb;
  v_reversal jsonb;
  v_net numeric;
begin
  perform public.create_finance_accounting_period(2099, 1);
  select id into v_period from public.finance_accounting_periods where period_year = 2099 and period_month = 1;

  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'STAGE_FINANCE_SMOKE-CASH', 'name', 'STAGE_FINANCE_SMOKE Caja',
    'financial_type', 'asset', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'STAGE_FINANCE_SMOKE-EQ', 'name', 'STAGE_FINANCE_SMOKE Capital',
    'financial_type', 'equity', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_entry_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2099-01-15',
    'description', 'STAGE_FINANCE_SMOKE manual entry'
  )) ->> 'id')::uuid;

  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 100)
  ));

  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  v_posted := public.post_finance_journal_entry(v_entry_id);

  v_reversal := public.reverse_finance_journal_entry(
    v_entry_id,
    'STAGE_FINANCE_SMOKE reversal',
    '2099-01-15'::date
  );

  select coalesce(sum(debit - credit), 0) into v_net
  from public.finance_journal_lines jl
  join public.finance_journal_entries je on je.id = jl.journal_entry_id
  where je.description like 'STAGE_FINANCE_SMOKE%'
     or je.id in ((v_posted ->> 'id')::uuid, (v_reversal ->> 'id')::uuid);

  if abs(v_net) > 0.009 then
    raise exception 'STAGE_FINANCE_SMOKE net not zero: %', v_net;
  end if;
end $smoke$;

select 'PASS' as finance_accounting_stage_smoke, 'net_zero_confirmed' as detail;

rollback;
