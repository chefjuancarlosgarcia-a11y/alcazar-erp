-- Structural checks for 20260813140000_felplex_gt_stage_host_url.sql (NOT EXECUTED IN CI by default).

select 1
where exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'fel_round_money'
);

-- Forward migration file MUST contain (textual static review):
--   UPDATE public.billing_provider_configs
--   provider_code = 'felplex_gt'
--   environment = 'stage'
--   base_url = 'https://felplex.stage.plex.lat' (WHERE legacy host only)
--   SET base_url = 'https://felplex-gt.stage.plex.lat'
--   GET DIAGNOSTICS ... ROW_COUNT
--   v_row_count <> 1
--   RAISE EXCEPTION ... FELPLEX_GT_STAGE_HOST_URL_ROW_COUNT
-- Rollback file MUST contain symmetric GT host WHERE and FELPLEX_GT_STAGE_HOST_URL_ROLLBACK_ROW_COUNT
-- RUNTIME: NOT EXECUTED
