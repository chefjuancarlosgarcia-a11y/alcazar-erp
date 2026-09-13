-- Read-only preflight and fixture selection for FELplex Stage concurrency test.
-- Project: tgrqarxfmpwgrkntvgma (Stage only)

select jsonb_pretty(jsonb_build_object(
  'project_ref_expected', 'tgrqarxfmpwgrkntvgma',
  'preflight_counts', (
    select jsonb_build_object(
      'config_rows', (select count(*) from public.fel_emission_config),
      'environment', (select environment from public.fel_emission_config where id = 1),
      'emission_enabled', (select emission_enabled from public.fel_emission_config where id = 1),
      'auto_issue_paid_orders', (select auto_issue_paid_orders from public.fel_emission_config where id = 1),
      'formal_contingency_enabled', (select formal_contingency_enabled from public.fel_emission_config where id = 1),
      'fel_documents', (select count(*) from public.pos_fel_documents),
      'fel_attempts', (select count(*) from public.pos_fel_attempts),
      'processing_documents', (select count(*) from public.pos_fel_documents where status = 'processing'),
      'non_stage_documents', (select count(*) from public.pos_fel_documents where environment <> 'stage')
    )
  ),
  'fixture_product_id', 'fef00001-0000-4000-8000-000000000001',
  'selected', (
    select jsonb_build_object(
      'document_id', d.id,
      'order_id', d.order_id,
      'actor_id', actor.actor_id,
      'table_id', o.table_id,
      'order_total', o.total,
      'order_status', o.status,
      'doc_status', d.status,
      'retry_count', d.retry_count,
      'request_payload_is_null', d.request_payload is null,
      'fel_uuid', d.fel_uuid,
      'sat_authorization', d.sat_authorization,
      'certified_at', d.certified_at,
      'attempt_count', (
        select count(*) from public.pos_fel_attempts a where a.fel_document_id = d.id
      ),
      'reconciliation', public.fel_order_payment_reconciliation(o.id)
    )
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    cross join lateral (
      select p.id as actor_id
      from public.profiles p
      join auth.users u on u.id = p.id
      where lower(u.email) = lower('cajero@stage-fel.test')
        and p.status = 'active'
        and public.normalize_profile_role(p.role) in ('caja', 'cajero')
      limit 1
    ) actor
    where o.table_id = 'M-FEL-PAID'
      and public.fel_round_money(o.total) = 297.00
      and o.status = 'paid'
      and d.environment = 'stage'
      and d.status = 'pending_certification'
      and d.request_payload is null
      and d.fel_uuid is null
      and d.sat_authorization is null
      and d.certified_at is null
      and d.retry_count = 0
      and not exists (
        select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
      )
      and coalesce(
        (public.fel_order_payment_reconciliation(o.id) ->> 'is_fully_paid')::boolean,
        false
      )
      and public.fel_round_money(
        (public.fel_order_payment_reconciliation(o.id) ->> 'balance_due')::numeric
      ) = 0
      and exists (
        select 1
        from public.pos_order_items i
        where i.order_id = o.id
          and i.product_id = 'fef00001-0000-4000-8000-000000000001'::uuid
          and i.status <> 'cancelled'
      )
      and not exists (
        select 1
        from public.pos_order_items i
        where i.order_id = o.id
          and i.status <> 'cancelled'
          and i.product_id is distinct from 'fef00001-0000-4000-8000-000000000001'::uuid
      )
    order by d.created_at, d.id
    limit 1
  ),
  'valid_candidate_count', (
    select count(*)
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where o.table_id = 'M-FEL-PAID'
      and public.fel_round_money(o.total) = 297.00
      and o.status = 'paid'
      and d.environment = 'stage'
      and d.status = 'pending_certification'
      and d.request_payload is null
      and d.fel_uuid is null
      and d.sat_authorization is null
      and d.certified_at is null
      and not exists (
        select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
      )
  ),
  'orders_snapshot', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'order_id', o.id,
        'table_id', o.table_id,
        'status', o.status,
        'total', o.total
      ) order by o.id
    ), '[]'::jsonb)
    from public.pos_orders o
    where o.table_id in ('M-FEL-OPEN', 'M-FEL-PARTIAL', 'M-FEL-PAID')
  ),
  'payments_snapshot', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'payment_id', p.id,
        'order_id', p.order_id,
        'amount', p.amount,
        'status', p.status
      ) order by p.id
    ), '[]'::jsonb)
    from public.pos_order_payments p
    join public.pos_orders o on o.id = p.order_id
    where o.table_id in ('M-FEL-OPEN', 'M-FEL-PARTIAL', 'M-FEL-PAID')
  )
)) as preflight;
