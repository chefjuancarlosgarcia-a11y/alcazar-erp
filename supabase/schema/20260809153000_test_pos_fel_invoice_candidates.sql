-- Tests for 20260809153000_pos_fel_invoice_candidates_and_channel_guard.sql
-- Structural/textual checks run here; behavioral SQL requires applied migration (Stage/local DB).

begin;

create or replace function public.test_pos_fel_invoice_candidates_20260809153000()
returns table (
  scenario text,
  passed boolean,
  executed boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_def text;
  v_request_def text;
  v_assert_def text;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_list_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'list_pos_fel_invoice_candidates'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_limit integer, p_paid_within_days integer, p_order_id uuid';

  select pg_catalog.pg_get_functiondef(p.oid)
  into v_request_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'request_pos_fel_certification'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid, p_receiver_nit text, p_receiver_name text, p_receiver_address text, p_receiver_email text, p_discount_total numeric';

  select pg_catalog.pg_get_functiondef(p.oid)
  into v_assert_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'fel_assert_pos_fel_pilot_sales_channel'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_sales_channel text';

  return query select 'list_rpc_exists'::text,
    v_list_def is not null,
    true,
    'list_pos_fel_invoice_candidates must be installed'::text;

  return query select 'list_uses_fel_can_request'::text,
    coalesce(v_list_def, '') ilike '%fel_can_request_fel_certification()%',
    true,
    'TEXTUAL: Caja list RPC gates on fel_can_request_fel_certification'::text;

  return query select 'list_param_limit_error_not_clamp'::text,
    coalesce(v_list_def, '') ilike '%FEL_LIST_PARAM_LIMIT_OUT_OF_RANGE%'
      and coalesce(v_list_def, '') not ilike '%greatest(1, least(%p_limit%',
    true,
    'TEXTUAL: explicit limit out of range must raise, not clamp'::text;

  return query select 'list_param_days_error_not_clamp'::text,
    coalesce(v_list_def, '') ilike '%FEL_LIST_PARAM_DAYS_OUT_OF_RANGE%'
      and coalesce(v_list_def, '') not ilike '%greatest(1, least(%p_paid_within_days%',
    true,
    'TEXTUAL: explicit days out of range must raise, not clamp'::text;

  return query select 'list_no_fel_document_id_in_payload'::text,
    coalesce(v_list_def, '') not ilike '%''fel_document_id''%'
      and coalesce(v_list_def, '') not ilike '%table_name%',
    true,
    'TEXTUAL: list JSON must omit fel_document_id and table_name'::text;

  return query select 'list_display_label_fixed_channels'::text,
    coalesce(v_list_def, '') ilike '%when ''takeout'' then ''Para llevar''%'
      and coalesce(v_list_def, '') ilike '%when ''dine_in'' then ''En mesa''%',
    true,
    'TEXTUAL: display_label is channel-fixed only'::text;

  return query select 'list_paid_at_from_payments'::text,
    coalesce(v_list_def, '') ilike '%pos_order_payments%'
      and coalesce(v_list_def, '') ilike '%created_at%'
      and coalesce(v_list_def, '') not ilike '%pos_orders.updated_at%',
    true,
    'TEXTUAL: paid_at from pos_order_payments'::text;

  return query select 'list_scoped_order_id_limit_one'::text,
    coalesce(v_list_def, '') ilike '%p_order_id is not null%'
      and coalesce(v_list_def, '') ilike '%limit case when p_order_id is not null then 1%',
    true,
    'TEXTUAL: scoped p_order_id returns at most one row'::text;

  return query select 'list_failed_can_request_false'::text,
    coalesce(v_list_def, '') ilike '%when d.status = ''failed'' then false%',
    true,
    'TEXTUAL: failed documents expose can_request=false'::text;

  return query select 'request_h1_assert_helper_and_call'::text,
    v_assert_def is not null
      and coalesce(v_assert_def, '') ilike '%FEL_SALES_CHANNEL_NOT_SUPPORTED%'
      and coalesce(v_request_def, '') ilike '%fel_assert_pos_fel_pilot_sales_channel%',
    true,
    'TEXTUAL: H1 via fel_assert_pos_fel_pilot_sales_channel called from request RPC'::text;

  return query select 'request_idempotent_before_channel_assert'::text,
    coalesce(v_request_def, '') ilike '%if v_existing.id is not null then%'
      and position('if v_existing.id is not null' in coalesce(v_request_def, ''))
        < position('fel_assert_pos_fel_pilot_sales_channel' in coalesce(v_request_def, '')),
    true,
    'TEXTUAL: idempotent FACT reuse precedes channel assert (intentional)'::text;

  return query select 'list_grants_authenticated_only'::text,
    exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'list_pos_fel_invoice_candidates'
    )
    and has_function_privilege('authenticated', 'public.list_pos_fel_invoice_candidates(integer, integer, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.list_pos_fel_invoice_candidates(integer, integer, uuid)', 'EXECUTE'),
    true,
    'RUNTIME PRIV: list RPC EXECUTE for authenticated only'::text;

  return query select 'runtime_blocked_channel_no_fact'::text, false, false,
    'NOT EXECUTED: requires DB with paid order on delivery and no FACT; expect FEL_SALES_CHANNEL_NOT_SUPPORTED'::text;

  return query select 'runtime_blocked_channel_with_fact_idempotent'::text, false, false,
    'NOT EXECUTED: requires DB fixture; expect idempotent JSON, zero INSERT'::text;

  return query select 'runtime_list_invalid_params'::text, false, false,
    'NOT EXECUTED: requires DB; explicit limit/days out of range must raise FEL_LIST_PARAM_*'::text;

  return query select 'source_no_http'::text, false, false,
    'NOT EXECUTED: HTTP/pg_net invariant is enforced by scripts/validate-felplex-migration-safety.mjs'::text;
end;
$$;

select *
from public.test_pos_fel_invoice_candidates_20260809153000();

rollback;
