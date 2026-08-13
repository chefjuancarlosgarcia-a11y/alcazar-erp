-- Opens controlled emission window (auto-commit via DO). Placeholders replaced by coordinator.

do $enable$
begin
  if not exists (
    select 1
    from public.fel_emission_config
    where id = 1
      and environment = 'stage'
      and emission_enabled = false
      and auto_issue_paid_orders = false
      and formal_contingency_enabled = false
  ) then
    raise exception 'ENABLE_WINDOW_FAIL: fel_emission_config not in safe baseline';
  end if;

  if (select count(*) from public.pos_fel_documents where status = 'processing') > 0 then
    raise exception 'ENABLE_WINDOW_FAIL: processing documents already exist';
  end if;

  if (select count(*) from public.pos_fel_attempts) > 0 then
    raise exception 'ENABLE_WINDOW_FAIL: attempts already exist';
  end if;

  if not exists (
    select 1
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where d.id = '{{DOCUMENT_ID}}'::uuid
      and d.order_id = '{{ORDER_ID}}'::uuid
      and o.table_id = 'M-FEL-PAID'
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
  ) then
    raise exception 'ENABLE_WINDOW_FAIL: fixture document no longer matches guards';
  end if;

  update public.fel_emission_config
  set emission_enabled = true, updated_at = now()
  where id = 1
    and environment = 'stage'
    and auto_issue_paid_orders = false
    and formal_contingency_enabled = false;

  if not found then
    raise exception 'ENABLE_WINDOW_FAIL: could not enable emission window';
  end if;
end;
$enable$;

select jsonb_build_object(
  'phase', 'enable_window',
  'opened_at', clock_timestamp(),
  'emission_enabled', (select emission_enabled from public.fel_emission_config where id = 1)
) as result;
