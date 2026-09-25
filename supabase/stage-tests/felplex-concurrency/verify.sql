-- Post-concurrency verification (read-only).
-- {{DOCUMENT_ID}} {{ORDER_ID}}

select jsonb_build_object(
  'phase', 'verify_concurrency',
  'at', clock_timestamp(),
  'document_id', '{{DOCUMENT_ID}}',
  'attempts_for_document', (
    select count(*) from public.pos_fel_attempts a
    where a.fel_document_id = '{{DOCUMENT_ID}}'::uuid
  ),
  'attempts_detail', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'attempt_id', a.id,
        'attempt_number', a.attempt_number,
        'outcome', a.outcome,
        'error_code', a.error_code,
        'started_at', a.started_at,
        'finished_at', a.finished_at
      ) order by a.attempt_number
    ), '[]'::jsonb)
    from public.pos_fel_attempts a
    where a.fel_document_id = '{{DOCUMENT_ID}}'::uuid
  ),
  'document', (
    select jsonb_build_object(
      'status', d.status,
      'retry_count', d.retry_count,
      'fel_uuid', d.fel_uuid,
      'sat_authorization', d.sat_authorization,
      'certified_at', d.certified_at,
      'last_error', d.last_error
    )
    from public.pos_fel_documents d
    where d.id = '{{DOCUMENT_ID}}'::uuid
  ),
  'orders_unchanged', (
    select jsonb_agg(
      jsonb_build_object('order_id', o.id, 'status', o.status, 'total', o.total)
      order by o.id
    )
    from public.pos_orders o
    where o.id = '{{ORDER_ID}}'::uuid
  ),
  'payments_unchanged', (
    select coalesce(jsonb_agg(
      jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'status', p.status)
      order by p.id
    ), '[]'::jsonb)
    from public.pos_order_payments p
    where p.order_id = '{{ORDER_ID}}'::uuid
  ),
  'emission_enabled', (select emission_enabled from public.fel_emission_config where id = 1),
  'processing_documents', (select count(*) from public.pos_fel_documents where status = 'processing')
) as verify;
