-- Stage finance accounting identity bootstrap (Stage-only, transactional, fail-closed).
-- Do NOT apply as migration. Run in Supabase SQL Editor on Stage after external ref validation.
--
-- BEFORE running (same transaction/session):
--   SELECT set_config('alcazar.finance_stage_project_ref', '<stage-ref-from-vault>', true);
--   SELECT set_config('alcazar.finance_production_project_ref', '<production-ref-from-vault>', true);
--
-- Writes ONLY public.app_settings.key = 'deployment_environment' when absent.
-- Never overwrites conflicting name/project_ref. Never touches other app_settings keys.
-- Marks created rows with value.finance_accounting_identity_bootstrap = true for targeted rollback.

\set ON_ERROR_STOP on

BEGIN;

-- alcazar:session_refs

DO $guard$
DECLARE
  v_stage_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
  v_prod_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_production_project_ref', true), '')), '');
  v_existing jsonb;
  v_existing_name text;
  v_existing_ref text;
BEGIN
  IF v_stage_ref IS NULL THEN
    RAISE EXCEPTION 'Identity bootstrap blocked: set alcazar.finance_stage_project_ref before running';
  END IF;
  IF v_prod_ref IS NULL THEN
    RAISE EXCEPTION 'Identity bootstrap blocked: set alcazar.finance_production_project_ref before running';
  END IF;
  IF v_stage_ref = v_prod_ref THEN
    RAISE EXCEPTION 'Identity bootstrap blocked: Stage and Production project refs must differ';
  END IF;

  SELECT value INTO v_existing
  FROM public.app_settings
  WHERE key = 'deployment_environment';

  IF v_existing IS NULL THEN
    RETURN;
  END IF;

  v_existing_name := lower(nullif(trim(coalesce(v_existing ->> 'name', '')), ''));
  v_existing_ref := nullif(trim(coalesce(v_existing ->> 'project_ref', '')), '');

  IF v_existing_name IN ('production', 'prod') THEN
    RAISE EXCEPTION 'Identity bootstrap blocked: existing deployment_environment indicates production';
  END IF;

  IF v_existing_name IS NOT NULL AND v_existing_name <> 'stage' THEN
    RAISE EXCEPTION 'Identity bootstrap blocked: conflicting deployment_environment.name=%', v_existing_name;
  END IF;

  IF v_existing_ref IS NOT NULL AND v_existing_ref <> v_stage_ref THEN
    RAISE EXCEPTION 'Identity bootstrap blocked: existing project_ref differs from expected Stage ref';
  END IF;

  IF v_existing_name = 'stage' AND v_existing_ref = v_stage_ref THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Identity bootstrap blocked: deployment_environment present but incomplete or conflicting';
END $guard$;

CREATE TEMP TABLE finance_identity_bootstrap_evidence (
  phase text NOT NULL,
  deployment_environment_present boolean NOT NULL,
  deployment_name text,
  deployment_project_ref text,
  felplex_settings_count integer NOT NULL
) ON COMMIT DROP;

INSERT INTO finance_identity_bootstrap_evidence (phase, deployment_environment_present, deployment_name, deployment_project_ref, felplex_settings_count)
SELECT
  'before'::text,
  EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT count(*)::integer FROM public.app_settings WHERE key ILIKE '%fel%' OR key ILIKE '%felplex%');

INSERT INTO public.app_settings (key, value)
SELECT
  'deployment_environment'::text,
  jsonb_build_object(
    'name', 'stage',
    'project_ref', nullif(trim(current_setting('alcazar.finance_stage_project_ref', true)), ''),
    'finance_accounting_identity_bootstrap', true,
    'bootstrapped_by', 'finance_accounting_stage_identity_bootstrap'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment'
);

INSERT INTO finance_identity_bootstrap_evidence (phase, deployment_environment_present, deployment_name, deployment_project_ref, felplex_settings_count)
SELECT
  'after'::text,
  EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
  (SELECT count(*)::integer FROM public.app_settings WHERE key ILIKE '%fel%' OR key ILIKE '%felplex%');

SELECT phase, deployment_environment_present, deployment_name, deployment_project_ref, felplex_settings_count
FROM finance_identity_bootstrap_evidence
ORDER BY phase;

SELECT
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.app_settings
      WHERE key = 'deployment_environment'
        AND lower(coalesce(value ->> 'name', '')) = 'stage'
        AND nullif(trim(coalesce(value ->> 'project_ref', '')), '')
          = nullif(trim(current_setting('alcazar.finance_stage_project_ref', true)), '')
    ) THEN 'FAIL'
    ELSE 'PASS'
  END AS finance_accounting_stage_identity_bootstrap_result,
  CASE
    WHEN (
      SELECT felplex_settings_count FROM finance_identity_bootstrap_evidence WHERE phase = 'before'
    ) <> (
      SELECT felplex_settings_count FROM finance_identity_bootstrap_evidence WHERE phase = 'after'
    ) THEN 'FAIL'
    ELSE 'PASS'
  END AS felplex_settings_unchanged;

SELECT 1 / (
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.app_settings
      WHERE key = 'deployment_environment'
        AND lower(coalesce(value ->> 'name', '')) = 'stage'
        AND nullif(trim(coalesce(value ->> 'project_ref', '')), '')
          = nullif(trim(current_setting('alcazar.finance_stage_project_ref', true)), '')
    ) THEN 0
    WHEN (
      SELECT felplex_settings_count FROM finance_identity_bootstrap_evidence WHERE phase = 'before'
    ) <> (
      SELECT felplex_settings_count FROM finance_identity_bootstrap_evidence WHERE phase = 'after'
    ) THEN 0
    ELSE 1
  END
) AS fail_closed_pass_guard;

COMMIT;
