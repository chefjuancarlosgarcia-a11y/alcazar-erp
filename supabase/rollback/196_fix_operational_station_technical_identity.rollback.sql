-- Forward-only rollback for 196_fix_operational_station_technical_identity.sql
-- Deleted technical profiles are not recreated automatically.
-- Re-enroll the station device after Edge hotfix deploy to obtain a clean technical auth user.

select '196_rollback_forward_only: re-enroll station device if profile cleanup was applied' as guidance;
