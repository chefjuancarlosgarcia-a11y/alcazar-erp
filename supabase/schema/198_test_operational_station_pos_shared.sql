-- Comprehensive static tests for 198 station POS shared (apply migration first).
-- BEGIN … ROLLBACK — no PII fixtures.

begin;

create or replace function public.test_operational_station_pos_shared_198()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open_def text;
  v_send_wrap text;
  v_release_wrap text;
  v_pricing_def text;
  v_send_int text;
  v_release_int text;
begin
  return query select 'flag_default_off'::text,
    exists (select 1 from public.app_settings where key = 'operational_station_pos_enabled'),
    'app_settings row'::text;

  return query select 'pos_idempotency_table'::text,
    to_regclass('public.operational_station_pos_idempotency') is not null,
    'idempotency table'::text;

  return query select 'pos_audit_table'::text,
    to_regclass('public.operational_station_pos_action_audit') is not null,
    'audit table'::text;

  return query select 'get_context_acl'::text,
    has_function_privilege('authenticated', 'public.get_station_pos_context(text)', 'EXECUTE'),
    'authenticated execute'::text;

  return query select 'list_tables_acl'::text,
    has_function_privilege('authenticated', 'public.list_station_pos_tables(text)', 'EXECUTE'),
    'list tables'::text;

  return query select 'get_order_acl'::text,
    has_function_privilege('authenticated', 'public.get_station_pos_order(text, uuid)', 'EXECUTE'),
    'get order'::text;

  return query select 'table_history_acl'::text,
    has_function_privilege('authenticated', 'public.get_station_pos_table_history(text, text)', 'EXECUTE'),
    'table history'::text;

  return query select 'catalog_acl'::text,
    has_function_privilege('authenticated', 'public.get_station_pos_catalog(text)', 'EXECUTE'),
    'catalog'::text;

  return query select 'open_wrapper_acl'::text,
    has_function_privilege('authenticated', 'public.open_station_pos_table_service(text, text, text, text, text, text)', 'EXECUTE'),
    'open table'::text;

  return query select 'add_item_acl'::text,
    has_function_privilege('authenticated', 'public.add_station_pos_order_item(text, uuid, uuid, numeric, text, uuid, jsonb, jsonb, text)', 'EXECUTE'),
    'add item'::text;

  return query select 'update_item_acl'::text,
    has_function_privilege('authenticated', 'public.update_station_pos_order_item(text, uuid, uuid, numeric, text)', 'EXECUTE'),
    'update item'::text;

  return query select 'remove_draft_acl'::text,
    has_function_privilege('authenticated', 'public.remove_station_pos_draft_item(text, uuid, uuid, text)', 'EXECUTE'),
    'remove draft'::text;

  return query select 'clear_drafts_acl'::text,
    has_function_privilege('authenticated', 'public.clear_station_pos_draft_items(text, uuid, text)', 'EXECUTE'),
    'clear drafts'::text;

  return query select 'update_order_acl'::text,
    has_function_privilege('authenticated', 'public.update_station_pos_order(text, uuid, text, text)', 'EXECUTE'),
    'update order'::text;

  return query select 'send_production_acl'::text,
    has_function_privilege('authenticated', 'public.send_station_pos_order_to_production(text, uuid, text)', 'EXECUTE'),
    'send production'::text;

  return query select 'request_bill_acl'::text,
    has_function_privilege('authenticated', 'public.request_station_pos_order_bill(text, uuid, text)', 'EXECUTE'),
    'request bill'::text;

  return query select 'send_cashier_acl'::text,
    has_function_privilege('authenticated', 'public.send_station_pos_order_to_cashier(text, uuid, text)', 'EXECUTE'),
    'send cashier'::text;

  return query select 'release_acl'::text,
    has_function_privilege('authenticated', 'public.release_station_pos_table_service(text, uuid, text, text)', 'EXECUTE'),
    'release table'::text;

  return query select 'lock_session_acl'::text,
    has_function_privilege('authenticated', 'public.station_pos_lock_operator_session(text, text)', 'EXECUTE'),
    'lock session'::text;

  return query select 'bind_helper_revoked'::text,
    not has_function_privilege('authenticated', 'public.station_pos_bind_operator_session_by_token(text)', 'EXECUTE'),
    'internal bind'::text;

  return query select 'pricing_helper_revoked'::text,
    not has_function_privilege('authenticated', 'public.station_pos_compute_line_item_pricing(uuid, uuid, jsonb, jsonb)', 'EXECUTE'),
    'pricing internal'::text;

  return query select 'send_for_operator_revoked'::text,
    not has_function_privilege('authenticated', 'public.send_pos_order_to_production_for_operator(uuid, uuid)', 'EXECUTE'),
    'send internal'::text;

  return query select 'release_for_operator_revoked'::text,
    not has_function_privilege('authenticated', 'public.release_pos_table_service_for_operator(uuid, text, uuid)', 'EXECUTE'),
    'release internal'::text;

  return query select 'is_order_owner_helper_revoked'::text,
    not has_function_privilege('authenticated', 'public.station_pos_is_order_owner(uuid, uuid)', 'EXECUTE'),
    'owner helper'::text;

  return query select 'assert_release_helper_revoked'::text,
    not has_function_privilege('authenticated', 'public.station_pos_assert_release_authorized(uuid, text, uuid)', 'EXECUTE'),
    'assert release'::text;

  return query select 'revoke_session_helper_revoked'::text,
    not has_function_privilege('authenticated', 'public.station_pos_revoke_operator_session(uuid, text)', 'EXECUTE'),
    'revoke session'::text;

  v_open_def := pg_get_functiondef(
    'public.open_station_pos_table_service(text, text, text, text, text, text)'::regprocedure
  );
  return query select 'open_audit_actor_operator'::text,
    v_open_def is not null
      and position('v_actor_id := v_operator_id' in v_open_def) > 0
      and position('v_actor_id := auth.uid()' in v_open_def) = 0,
    'actor is operator'::text;

  v_pricing_def := pg_get_functiondef(
    'public.station_pos_compute_line_item_pricing(uuid, uuid, jsonb, jsonb)'::regprocedure
  );
  return query select 'table_events_acl'::text,
    has_function_privilege('authenticated', 'public.get_station_pos_table_events(text, text, integer)', 'EXECUTE'),
    'table events'::text;

  return query select 'floor_layout_wrapper'::text,
    to_regprocedure('public.get_station_pos_floor_layout(text)') is not null
      and position('station_pos_floor_layout_payload' in pg_get_functiondef(
        'public.get_station_pos_floor_layout(text)'::regprocedure
      )) > 0,
    'floor layout canonical'::text;

  return query select 'order_events_acl'::text,
    has_function_privilege('authenticated', 'public.get_station_pos_order_events(text, uuid, integer)', 'EXECUTE'),
    'order events'::text;

  return query select 'pricing_pizza_requires_variant'::text,
    v_pricing_def is not null
      and position('product_type = ''pizza'' and p_variant_id is null' in v_pricing_def) > 0,
    'pizza size required'::text;

  return query select 'pricing_half_and_half_recipe'::text,
    v_pricing_def is not null
      and position('v_recipe_ids[1]' in v_pricing_def) > 0
      and position('count(distinct rid) > 1' in v_pricing_def) = 0,
    'first option recipe'::text;

  return query select 'pricing_absolute_delta'::text,
    v_pricing_def is not null
      and position('price_mode' in v_pricing_def) > 0
      and position('v_absolute_total' in v_pricing_def) > 0,
    'absolute/delta modes'::text;

  v_send_int := pg_get_functiondef(
    'public.send_pos_order_to_production_for_operator(uuid, uuid)'::regprocedure
  );
  return query select 'send_uses_station_can_operate'::text,
    v_send_int is not null
      and position('station_pos_can_operate_orders(p_operator_profile_id)' in v_send_int) > 0
      and position('can_operate_pos_orders()' in v_send_int) = 0,
    'operator gate'::text;

  return query select 'send_events_use_operator'::text,
    v_send_int is not null
      and position('auth.uid()' in v_send_int) = 0
      and position('p_operator_profile_id' in v_send_int) > 0,
    'event attribution'::text;

  v_release_int := pg_get_functiondef(
    'public.release_pos_table_service_for_operator(uuid, text, uuid)'::regprocedure
  );
  return query select 'release_uses_station_assert'::text,
    v_release_int is not null
      and position('station_pos_assert_release_authorized' in v_release_int) > 0
      and position('perform public.pos_assert_release_authorized' in v_release_int) = 0,
    'station assert'::text;

  return query select 'release_l2_clears_drafts'::text,
    v_release_int is not null
      and position('station_pos_clear_draft_items_impl' in v_release_int) > 0,
    'draft clear impl'::text;

  v_send_wrap := pg_get_functiondef(
    'public.send_station_pos_order_to_production(text, uuid, text)'::regprocedure
  );
  return query select 'terminal_send_revokes_session'::text,
    v_send_wrap is not null
      and position('station_pos_revoke_operator_session' in v_send_wrap) > 0,
    'revoke after send'::text;

  v_release_wrap := pg_get_functiondef(
    'public.release_station_pos_table_service(text, uuid, text, text)'::regprocedure
  );
  return query select 'release_no_force_supervisor'::text,
    v_release_wrap is not null
      and position('p_force_supervisor' in v_release_wrap) = 0,
    'no force supervisor param'::text;

  return query select 'release_wrap_revokes_session'::text,
    v_release_wrap is not null
      and position('station_pos_revoke_operator_session' in v_release_wrap) > 0,
    'revoke after release'::text;

  return query select 'cashier_wrap_revokes_session'::text,
    position('station_pos_revoke_operator_session' in pg_get_functiondef(
      'public.send_station_pos_order_to_cashier(text, uuid, text)'::regprocedure
    )) > 0,
    'revoke after cashier'::text;

  return query select 'human_send_unchanged_sig'::text,
    pg_get_function_arguments('public.send_pos_order_to_production(uuid)'::regprocedure) = 'p_order_id uuid',
    'public send signature'::text;

  return query select 'resolve_context_extend_default'::text,
    position('p_extend_idle boolean' in lower(pg_get_functiondef(
      'public.resolve_station_pos_operator_context(text, boolean)'::regprocedure
    ))) > 0
    and position('default true' in lower(pg_get_functiondef(
      'public.resolve_station_pos_operator_context(text, boolean)'::regprocedure
    ))) > 0,
    'extend flag present'::text;

  return query select 'read_wrappers_no_extend'::text,
    position('resolve_station_pos_operator_context(p_operator_session_token, false)' in pg_get_functiondef(
      'public.get_station_pos_floor_layout(text)'::regprocedure
    )) > 0
    and position('resolve_station_pos_operator_context(p_operator_session_token, false)' in pg_get_functiondef(
      'public.get_station_pos_catalog(text)'::regprocedure
    )) > 0,
    'reads use extend false'::text;
end;
$$;

revoke all on function public.test_operational_station_pos_shared_198() from public, anon, authenticated;
grant execute on function public.test_operational_station_pos_shared_198() to service_role;

select scenario, passed, detail
from public.test_operational_station_pos_shared_198()
order by passed asc, scenario asc;

select
  count(*) as total,
  count(*) filter (where passed) as passed_total,
  count(*) filter (where not passed) as failed_total
from public.test_operational_station_pos_shared_198();

drop function if exists public.test_operational_station_pos_shared_198();
rollback;
