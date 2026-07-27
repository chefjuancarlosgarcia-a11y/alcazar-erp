-- Tests 195_fix_operational_operator_pgcrypto_schema.sql (BEGIN…ROLLBACK).

begin;

create or replace function public.test_operational_operator_pgcrypto_195()
returns table(scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text[] := array[
    'admin_set_operational_pin',
    'verify_operational_pin_for_device',
    'touch_operational_operator_session',
    'lock_operational_operator_session'
  ];
  v_name text;
  v_def text;
  v_oid oid;
  v_digest text;
  v_hash text;
  v_hmac text;
begin
  foreach v_name in array v_names loop
    select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name
    order by p.oid
    limit 1;

    return query select ('no_public_digest_' || v_name)::text,
      v_def is not null and position('public.digest' in v_def) = 0,
      'pg_get_functiondef'::text;
  end loop;

  return query select 'verify_uses_extensions_digest'::text,
    position('extensions.digest' in (
      select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'verify_operational_pin_for_device' limit 1
    )) > 0,
    'verify token hash'::text;

  return query select 'admin_uses_extensions_crypt'::text,
    position('extensions.crypt' in (
      select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_set_operational_pin' limit 1
    )) > 0
    and position('extensions.gen_salt' in (
      select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_set_operational_pin' limit 1
    )) > 0,
    'admin pin hash'::text;

  return query select 'security_definer_preserved'::text,
    (
      select bool_and(p.prosecdef)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_names)
    ),
    'prosecdef'::text;

  return query select 'search_path_empty'::text,
    (
      select bool_and(coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_names)
    ),
    'proconfig'::text;

  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'verify_operational_pin_for_device' limit 1;

  return query select 'verify_acl_authenticated'::text,
    v_oid is not null and has_function_privilege('authenticated', v_oid, 'EXECUTE'),
    'client verify pin'::text;

  return query select 'runtime_extensions_digest'::text,
    length(encode(extensions.digest('smoke195', 'sha256'), 'hex')) = 64,
    'direct digest'::text;

  return query select 'runtime_extensions_crypt_salt'::text,
    extensions.crypt('0000', extensions.gen_salt('bf')) is not null,
    'crypt roundtrip'::text;

  v_hmac := encode(extensions.hmac('9', 'k', 'sha256'), 'hex');
  return query select 'runtime_extensions_hmac'::text,
    length(v_hmac) = 64,
    'hmac helper'::text;

  return query select 'signatures_unchanged'::text,
    to_regprocedure('public.admin_set_operational_pin(uuid, text)') is not null
    and to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') is not null
    and to_regprocedure('public.touch_operational_operator_session(text)') is not null
    and to_regprocedure('public.lock_operational_operator_session(text, text, text)') is not null,
    'to_regprocedure'::text;
end;
$$;

with results as materialized (
  select * from public.test_operational_operator_pgcrypto_195()
),
summary as (
  select
    count(*)::int as total,
    count(*) filter (where passed)::int as passed_total,
    count(*) filter (where not passed)::int as failed_total
  from results
)
select
  r.scenario,
  r.passed,
  r.detail,
  s.total,
  s.passed_total,
  s.failed_total
from results r
cross join summary s
order by r.passed asc, r.scenario;

drop function if exists public.test_operational_operator_pgcrypto_195();

rollback;
