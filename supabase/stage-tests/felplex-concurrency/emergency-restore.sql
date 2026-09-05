-- Emergency restore for interrupted concurrency test (fixture only).
-- Targets processing M-FEL-PAID documents with test or orphan attempts.

do $restore$
declare
  v_doc record;
  v_attempt record;
begin
  update public.fel_emission_config
  set emission_enabled = false, updated_at = now()
  where id = 1;

  for v_doc in
    select d.id, d.order_id
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where o.table_id = 'M-FEL-PAID'
      and d.environment = 'stage'
      and d.status in ('processing', 'failed')
      and d.fel_uuid is null
      and d.sat_authorization is null
      and d.certified_at is null
  loop
    for v_attempt in
      select a.id
      from public.pos_fel_attempts a
      where a.fel_document_id = v_doc.id
    loop
      delete from public.pos_fel_attempts where id = v_attempt.id;
    end loop;

    update public.pos_fel_documents d
    set
      status = 'pending_certification',
      retry_count = 0,
      last_error = null,
      last_attempt_at = null,
      request_payload = null,
      response_payload = null,
      updated_at = now()
    where d.id = v_doc.id;
  end loop;
end;
$restore$;

select jsonb_build_object(
  'phase', 'emergency_restore',
  'emission_enabled', (select emission_enabled from public.fel_emission_config where id = 1),
  'fel_attempts', (select count(*) from public.pos_fel_attempts),
  'processing_documents', (select count(*) from public.pos_fel_documents where status = 'processing')
) as result;
