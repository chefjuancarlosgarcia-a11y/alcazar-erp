-- Postflight read-only AFTER applying 195. gate_code, is_blocker, detail.

with
affected as (
  select unnest(array[
    'admin_set_operational_pin',
    'verify_operational_pin_for_device',
    'touch_operational_operator_session',
    'lock_operational_operator_session'
  ]) as proname
),
defs as (
  select
    a.proname,
    pg_get_functiondef(p.oid) as def,
    p.prosecdef,
    coalesce(array_to_string(p.proconfig, ','), '') as proconfig
  from affected a
  join pg_proc p on p.proname = a.proname
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
),
gates (gate_code, is_blocker, detail) as (
  select 'no_public_digest'::text as gate_code,
    exists (select 1 from defs where position('public.digest' in def) > 0) as is_blocker,
    jsonb_build_object('clean', not exists (select 1 from defs where position('public.digest' in def) > 0)) as detail

  union all
  select 'extensions_digest_in_session_rpcs',
    not (
      (select position('extensions.digest' in def) > 0 from defs where proname = 'verify_operational_pin_for_device')
      and (select position('extensions.digest' in def) > 0 from defs where proname = 'touch_operational_operator_session')
      and (select position('extensions.digest' in def) > 0 from defs where proname = 'lock_operational_operator_session')
    ),
    jsonb_build_object('verify', true, 'touch', true, 'lock', true)

  union all
  select 'extensions_crypt_in_admin_and_verify',
    not (
      (select position('extensions.crypt' in def) > 0 from defs where proname = 'admin_set_operational_pin')
      and (select position('extensions.crypt' in def) > 0 from defs where proname = 'verify_operational_pin_for_device')
    ),
    jsonb_build_object('admin_crypt', true, 'verify_crypt', true)

  union all
  select 'security_definer_and_search_path',
    exists (select 1 from defs where not prosecdef or proconfig not like '%search_path=%'),
    jsonb_build_object(
      'all_secdef', (select bool_and(prosecdef) from defs),
      'all_search_path', (select bool_and(proconfig like '%search_path=%') from defs)
    )

  union all
  select 'verify_pin_acl_unchanged',
    not coalesce(
      has_function_privilege(
        'authenticated',
        to_regprocedure('public.verify_operational_pin_for_device(text, text, text)'),
        'EXECUTE'
      ),
      false
    ),
    jsonb_build_object('authenticated_execute', true)
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
