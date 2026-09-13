-- Guatemala Stage base URL correction (FELplex representative confirmation 2026-09-12/13).
-- Prior host https://felplex.stage.plex.lat caused HTTP 404 on the single Stage pilot POST.
-- FELplex confirmed Guatemala Stage empresa 547 (billing columns unchanged by this migration).

begin;

do $felplex_gt_stage_host_url$
declare
  v_row_count integer;
begin
  update public.billing_provider_configs cfg
  set base_url = 'https://felplex-gt.stage.plex.lat'
  where cfg.provider_code = 'felplex_gt'
    and cfg.environment = 'stage'
    and cfg.base_url = 'https://felplex.stage.plex.lat';

  get diagnostics v_row_count = row_count;

  if v_row_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'FELPLEX_GT_STAGE_HOST_URL_ROW_COUNT',
      detail = format('expected exactly 1 felplex_gt/stage row on legacy host, got %s', v_row_count);
  end if;
end
$felplex_gt_stage_host_url$;

commit;
