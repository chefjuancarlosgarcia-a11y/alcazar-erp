-- Preflight read-only BEFORE applying 195 (after 194 applied). gate_code, is_blocker, detail.

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
    pg_get_functiondef(p.oid) as def
  from affected a
  join pg_proc p on p.proname = a.proname
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
),
gates (gate_code, is_blocker, detail) as (
  select 'station_cash_wrappers_present'::text as gate_code,
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_station_cash_context'
    ) as is_blocker,
    jsonb_build_object(
      'get_station_cash_context', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_station_cash_context'
      )
    ) as detail

  union all
  select 'legacy_public_digest_in_operator_rpcs',
    false,
    jsonb_build_object(
      'needs_195_fix', exists (select 1 from defs where position('public.digest' in def) > 0),
      'functions_with_legacy', (
        select coalesce(jsonb_agg(proname), '[]'::jsonb)
        from defs where position('public.digest' in def) > 0
      )
    )

  union all
  select 'legacy_unqualified_crypt_in_operator_rpcs',
    false,
    jsonb_build_object(
      'needs_195_fix', exists (
        select 1 from defs where def ~ E'\\mcrypt\\(' and def !~ 'extensions\\.crypt'
      )
    )

  union all
  select 'ready_to_apply_195',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_station_cash_context'
    )
    or not (
      exists (select 1 from defs where position('public.digest' in def) > 0)
      or exists (select 1 from defs where def ~ E'\\mcrypt\\(' and def !~ 'extensions\\.crypt')
    ),
    jsonb_build_object(
      'ready_to_apply_195',
        exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_station_cash_context')
        and (
          exists (select 1 from defs where position('public.digest' in def) > 0)
          or exists (select 1 from defs where def ~ E'\\mcrypt\\(' and def !~ 'extensions\\.crypt')
        )
    )
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
