-- Rollback gate for 20260808230000_pos_fel_premerge_hardening.sql.
-- WARNING: manual review only. Production is not authorized.
--
-- This hardening is intentionally forward-only. Restoring the immediately
-- previous definitions would re-admit production configuration, arbitrary
-- request_payload JSON and broad service_role table privileges. That would
-- degrade security, so this script aborts without changing any object.
--
-- The ERP baseline is bootstrap-only and has no safe destructive rollback.
-- This script never drops FEL documents, attempts or tables and never uses CASCADE.

do $fel_premerge_rollback_guard$
begin
  if pg_catalog.to_regclass('public.fel_emission_config') is null
     or pg_catalog.to_regclass('public.pos_fel_documents') is null
     or pg_catalog.to_regclass('public.pos_fel_attempts') is null then
    raise exception 'FEL_PREMERGE_ROLLBACK_INCOMPATIBLE: required FEL tables are missing.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.fel_emission_config c
    where c.environment <> 'stage'
  ) then
    raise exception 'FEL_PREMERGE_ROLLBACK_INCOMPATIBLE: non-Stage configuration cannot be relaxed safely.'
      using errcode = 'P0001';
  end if;

  if pg_catalog.to_regprocedure('public.fel_payload_key_is_forbidden(text)') is null
     or pg_catalog.to_regprocedure('public.fel_validate_request_payload_node(jsonb)') is null
     or pg_catalog.to_regprocedure('public.fel_validate_request_payload(jsonb)') is null
     or pg_catalog.to_regprocedure('public.fel_order_payment_reconciliation(uuid)') is null
     or pg_catalog.to_regprocedure(
       'public.request_pos_fel_certification(uuid,text,text,text,text,numeric)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.fel_finalize_pos_fel_certification_attempt(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,text,jsonb,jsonb)'
     ) is null then
    raise exception 'FEL_PREMERGE_ROLLBACK_INCOMPATIBLE: 230000 objects are incomplete.'
      using errcode = 'P0001';
  end if;

  raise exception
    'FEL_PREMERGE_ROLLBACK_UNSAFE: rollback aborted; restoring pre-230000 definitions would weaken Stage, payload and privilege controls. Apply a separately approved forward migration instead.'
    using errcode = 'P0001';
end;
$fel_premerge_rollback_guard$;
