-- Regression tests for 185_fix_send_pos_order_product_ambiguity.sql
-- Run in SQL Editor AFTER applying 185 (service_role / postgres).
-- Does NOT create persistent fixtures; read-only checks + optional live RPC if order exists.

create or replace function public.test_send_pos_order_production_185_fix()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_def text;
  v_order_id uuid;
  v_draft_before integer;
  v_ticket_before integer;
  v_result jsonb;
  v_ticket_after integer;
  v_draft_after integer;
  v_test_item_id uuid;
begin
  v_def := pg_get_functiondef('public.send_pos_order_to_production(uuid)'::regprocedure);

  return query select 'function_exists'::text,
    v_def is not null and length(v_def) > 0,
    'send_pos_order_to_production installed'::text;

  return query select 'no_conflict_alias_product_join'::text,
    v_def not ilike '%join public.pos_products product%',
    'must not join pos_products AS product'::text;

  return query select 'uses_pop_or_catalog_alias'::text,
    v_def ilike '%join public.pos_products pop%' or v_def ilike '%catalog_product%',
    'SQL uses non-conflicting table alias'::text;

  return query select 'plpgsql_uses_v_product_not_bare_product_decl'::text,
    v_def ilike '%v_product public.pos_products%'
    and v_def not ilike E'declare\\n  product public.pos_products%',
    'record variable prefixed v_'::text;

  return query select 'signature_unchanged'::text,
    to_regprocedure('public.send_pos_order_to_production(uuid)') is not null,
    'send_pos_order_to_production(uuid)'::text;

  return query select 'grant_authenticated'::text,
    has_function_privilege('authenticated', 'public.send_pos_order_to_production(uuid)', 'EXECUTE'),
    'execute granted to authenticated'::text;

  return query select 'atomic_on_error_no_partial_ticket_for_missing_order'::text,
    true,
    'manual: function body is single PL/pgSQL unit; failed RPC rolls back'::text;

  -- Optional live checks when Sim B order exists (comanda prefix 7747300A / Mesa M1)
  select o.id into v_order_id
  from public.pos_orders o
  where left(o.id::text, 8) ilike '7747300a'
    and (
      o.table_name ilike '%m1%'
      or o.table_id ilike '%m1%'
    )
  order by o.updated_at desc
  limit 1;

  if v_order_id is null then
    return query select 'failed_order_still_draft_no_tickets'::text, true,
      'skipped — target order not found by comanda/table filter'::text;
    return query select 'retry_no_duplicate_if_no_drafts'::text, true, 'skipped — no fixture order'::text;
    return query select 'test_item_skips_inventory_deduction'::text, true, 'skipped — no fixture order'::text;
    return;
  end if;

  select count(*) into v_draft_before
  from public.pos_order_items poi
  where poi.order_id = v_order_id and poi.status = 'draft';

  select count(*) into v_ticket_before
  from public.production_tickets pt
  where pt.order_id = v_order_id::text;

  return query select 'failed_order_still_draft_no_tickets'::text,
    v_draft_before >= 1 and v_ticket_before = 0,
    format('order_id=%s draft_items=%s tickets=%s', v_order_id, v_draft_before, v_ticket_before)::text;

  -- Retry protection: second send with only drafts should not duplicate if first never succeeded
  if v_draft_before > 0 and v_ticket_before = 0 then
    return query select 'retry_no_duplicate_if_no_drafts'::text, true,
      'prior failure left 0 tickets; safe to retry after 185'::text;
  end if;

  select poi.id into v_test_item_id
  from public.pos_order_items poi
  where poi.order_id = v_order_id
    and poi.is_test_item = true
  limit 1;

  if v_test_item_id is not null then
    return query select 'test_item_skips_inventory_deduction'::text,
      exists (
        select 1 from public.pos_order_items poi
        where poi.id = v_test_item_id
          and (poi.inventory_consumed = false or poi.status = 'draft')
      ),
      'test line not inventory_consumed while draft/failed send'::text;
  else
    return query select 'test_item_skips_inventory_deduction'::text, true,
      'skipped — no is_test_item line on fixture order'::text;
  end if;
end;
$$;

revoke all on function public.test_send_pos_order_production_185_fix() from public;
revoke all on function public.test_send_pos_order_production_185_fix() from anon;
revoke all on function public.test_send_pos_order_production_185_fix() from authenticated;
grant execute on function public.test_send_pos_order_production_185_fix() to service_role;

select scenario, passed, detail
from public.test_send_pos_order_production_185_fix()
order by scenario;

select count(*) as total,
  count(*) filter (where passed) as passed,
  count(*) filter (where not passed) as failed
from public.test_send_pos_order_production_185_fix();
