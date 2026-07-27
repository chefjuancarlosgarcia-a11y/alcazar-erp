-- Rollback 194_station_cash_operator_wrappers.sql

begin;

drop function if exists public.record_station_cash_sale(text, uuid, numeric, text);
drop function if exists public.close_station_cash_session(text, numeric, text, text);
drop function if exists public.create_station_cash_movement(text, text, numeric, text, text, uuid, text);
drop function if exists public.open_station_cash_session(text, numeric, text, text);
drop function if exists public.get_station_cash_context(text);
drop function if exists public.resolve_station_cash_operator_context(text);
drop function if exists public.station_cash_is_operator_role(uuid);
drop function if exists public.station_cash_is_supervisor(uuid);
drop function if exists public.station_cash_operator_role(uuid);

drop table if exists public.operational_station_cash_idempotency;

commit;
