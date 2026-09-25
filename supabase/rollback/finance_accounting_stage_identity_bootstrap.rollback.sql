-- Rollback for finance_accounting_stage_identity_bootstrap.sql (Stage-only, fail-closed).
-- Removes ONLY deployment_environment rows created by the finance identity bootstrap marker.
-- Does NOT use CASCADE. Does NOT delete pre-existing rows without the bootstrap marker.

\set ON_ERROR_STOP on

BEGIN;

-- alcazar:session_refs

DO $guard$
DECLARE
  v_stage_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
  v_prod_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_production_project_ref', true), '')), '');
BEGIN
  IF v_stage_ref IS NULL OR v_prod_ref IS NULL THEN
    RAISE EXCEPTION 'Identity bootstrap rollback blocked: set session Stage and Production refs';
  END IF;
  IF v_stage_ref = v_prod_ref THEN
    RAISE EXCEPTION 'Identity bootstrap rollback blocked: Stage and Production refs must differ';
  END IF;
END $guard$;

CREATE TEMP TABLE finance_identity_rollback_evidence (
  phase text NOT NULL,
  deployment_environment_present boolean NOT NULL,
  deployment_name text,
  deployment_project_ref text,
  bootstrap_marker boolean
) ON COMMIT DROP;

INSERT INTO finance_identity_rollback_evidence (phase, deployment_environment_present, deployment_name, deployment_project_ref, bootstrap_marker)
SELECT
  'before'::text,
  EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
  coalesce((
    SELECT (value ->> 'finance_accounting_identity_bootstrap')::boolean
    FROM public.app_settings WHERE key = 'deployment_environment'
  ), false);

DELETE FROM public.app_settings
WHERE key = 'deployment_environment'
  AND lower(coalesce(value ->> 'name', '')) = 'stage'
  AND nullif(trim(coalesce(value ->> 'project_ref', '')), '')
    = nullif(trim(current_setting('alcazar.finance_stage_project_ref', true)), '')
  AND coalesce(value ->> 'finance_accounting_identity_bootstrap', 'false') = 'true'
  AND coalesce(value ->> 'bootstrapped_by', '') = 'finance_accounting_stage_identity_bootstrap';

INSERT INTO finance_identity_rollback_evidence (phase, deployment_environment_present, deployment_name, deployment_project_ref, bootstrap_marker)
SELECT
  'after'::text,
  EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
  coalesce((
    SELECT (value ->> 'finance_accounting_identity_bootstrap')::boolean
    FROM public.app_settings WHERE key = 'deployment_environment'
  ), false);

SELECT phase, deployment_environment_present, deployment_name, deployment_project_ref, bootstrap_marker
FROM finance_identity_rollback_evidence
ORDER BY phase;

SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment')
      AND coalesce((
        SELECT value ->> 'finance_accounting_identity_bootstrap'
        FROM public.app_settings WHERE key = 'deployment_environment'
      ), 'false') = 'true'
    THEN 'FAIL'
    ELSE 'PASS'
  END AS finance_accounting_stage_identity_bootstrap_rollback_result;

SELECT 1 / (
  CASE
    WHEN EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment')
      AND coalesce((
        SELECT value ->> 'finance_accounting_identity_bootstrap'
        FROM public.app_settings WHERE key = 'deployment_environment'
      ), 'false') = 'true'
    THEN 0
    ELSE 1
  END
) AS fail_closed_pass_guard;

COMMIT;
