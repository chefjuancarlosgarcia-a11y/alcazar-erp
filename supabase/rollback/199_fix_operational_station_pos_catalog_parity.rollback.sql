-- Forward-only rollback 199
-- Re-apply 198 function bodies for get_station_pos_catalog, open_station_pos_table_service,
-- and station_pos_assert_order_open_for_drafts if rollback is required in a controlled migration.
select '199_rollback_forward_only: restore 198 prosrc via dedicated down migration; do not drop business data' as guidance;
