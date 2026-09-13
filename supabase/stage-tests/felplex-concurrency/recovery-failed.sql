-- Category A recovery: known result without HTTP — finalize failed.
-- {{DOCUMENT_ID}} {{ATTEMPT_ID}}

select jsonb_build_object(
  'phase', 'recovery_without_http',
  'finalize', public.fel_finalize_pos_fel_certification_attempt(
    '{{DOCUMENT_ID}}'::uuid,
    '{{ATTEMPT_ID}}'::uuid,
    'failed',
    null,
    null,
    null,
    null,
    null,
    499,
    'FEL_TEST_CONCURRENCY',
    'Concurrency test — claim without HTTP transport',
    '{"http_status": 499, "error_kind": "transport", "safe_code": "CONCURRENCY"}'::jsonb,
    null
  ),
  'at', clock_timestamp(),
  'document', (
    select jsonb_build_object(
      'status', d.status,
      'retry_count', d.retry_count,
      'fel_uuid', d.fel_uuid,
      'sat_authorization', d.sat_authorization,
      'last_error', d.last_error
    )
    from public.pos_fel_documents d
    where d.id = '{{DOCUMENT_ID}}'::uuid
  ),
  'attempt', (
    select jsonb_build_object(
      'attempt_id', a.id,
      'outcome', a.outcome,
      'error_code', a.error_code
    )
    from public.pos_fel_attempts a
    where a.id = '{{ATTEMPT_ID}}'::uuid
  )
) as recovery_result;
