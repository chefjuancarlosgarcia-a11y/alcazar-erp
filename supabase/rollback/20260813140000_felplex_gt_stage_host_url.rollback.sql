-- Rollback 20260813140000_felplex_gt_stage_host_url.sql
-- Restores the previous Stage host only for felplex_gt/stage rows on the GT host.

begin;

do $felplex_gt_stage_host_url_rollback$
declare
  v_row_count integer;
begin
  update public.billing_provider_configs cfg
  set base_url = 'https://felplex.stage.plex.lat'
  where cfg.provider_code = 'felplex_gt'
    and cfg.environment = 'stage'
    and cfg.base_url = 'https://felplex-gt.stage.plex.lat';

  get diagnostics v_row_count = row_count;

  if v_row_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'FELPLEX_GT_STAGE_HOST_URL_ROLLBACK_ROW_COUNT',
      detail = format('expected exactly 1 felplex_gt/stage row on GT host, got %s', v_row_count);
  end if;
end
$felplex_gt_stage_host_url_rollback$;

commit;
