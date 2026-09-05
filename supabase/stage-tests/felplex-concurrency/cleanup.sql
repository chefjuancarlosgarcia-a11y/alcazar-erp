-- Emergency / final cleanup - restore fixture snapshot and close emission window.

do $cleanup$
begin
  if not exists (
    select 1
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where d.id = '{{DOCUMENT_ID}}'::uuid
      and o.id = '{{ORDER_ID}}'::uuid
      and o.table_id = 'M-FEL-PAID'
      and d.environment = 'stage'
  ) then
    raise exception 'CLEANUP_FAIL: document/order fixture identity mismatch';
  end if;

  if exists (
    select 1 from public.pos_fel_documents d
    where d.id = '{{DOCUMENT_ID}}'::uuid
      and (
        d.fel_uuid is not null
        or d.sat_authorization is not null
        or d.certified_at is not null
      )
  ) then
    raise exception 'CLEANUP_FAIL: certified-like fields present - manual review required';
  end if;

  if (
    select count(*)
    from public.pos_fel_attempts a
    where a.fel_document_id = '{{DOCUMENT_ID}}'::uuid
      and a.id is distinct from '{{ATTEMPT_ID}}'::uuid
  ) > 0 then
    raise exception 'CLEANUP_FAIL: unexpected extra attempts on fixture document';
  end if;

  delete from public.pos_fel_attempts a
  where a.id = '{{ATTEMPT_ID}}'::uuid
    and a.fel_document_id = '{{DOCUMENT_ID}}'::uuid
    and (
      a.error_code = 'FEL_TEST_CONCURRENCY'
      or a.outcome in ('pending', 'failed')
    );

  update public.pos_fel_documents d
  set
    status = 'pending_certification',
    retry_count = 0,
    last_error = null,
    last_attempt_at = null,
    fel_uuid = null,
    sat_authorization = null,
    sat_series = null,
    sat_document_number = null,
    certified_at = null,
    request_payload = null,
    response_payload = null,
    updated_at = now()
  where d.id = '{{DOCUMENT_ID}}'::uuid
    and d.environment = 'stage';

  update public.fel_emission_config
  set emission_enabled = false, updated_at = now()
  where id = 1;
end;
$cleanup$;

select jsonb_build_object(
  'phase', 'cleanup',
  'at', clock_timestamp(),
  'emission_enabled', (select emission_enabled from public.fel_emission_config where id = 1),
  'fel_attempts', (select count(*) from public.pos_fel_attempts),
  'processing_documents', (select count(*) from public.pos_fel_documents where status = 'processing'),
  'document', (
    select jsonb_build_object(
      'status', d.status,
      'retry_count', d.retry_count
    )
    from public.pos_fel_documents d
    where d.id = '{{DOCUMENT_ID}}'::uuid
  )
) as cleanup_result;
