-- FELplex Phase 1A.3 — Supabase Stage runtime validation (transactional, ROLLBACK only).
-- Project: tgrqarxfmpwgrkntvgma (Stage)
-- Manual execution: Supabase Stage SQL Editor as postgres / privileged role.
--
-- Constraints:
--   * BEGIN … ROLLBACK — never COMMIT
--   * No HTTP, Edge Functions, pg_net, FELplex calls
--   * Temporary emission_enabled=true only inside this transaction
--   * Uses exclusively fictitious fixture data (M-FEL-PAID, Q297.00)
--   * No DELETE, TRUNCATE, SET ROLE, RLS changes, or production data

begin;

create temp table fel_runtime_results (
  scenario text primary key,
  passed boolean not null,
  executed boolean not null,
  detail text not null
) on commit drop;

insert into fel_runtime_results (scenario, passed, executed, detail)
values (
  'runtime_postgres_concurrency',
  false,
  false,
  'NOT EXECUTED: requires separate approved concurrency runbook — see docs/felplex-20260808220000-stage-runtime-runbook.md'
);

do $fel_runtime$
declare
  v_fixture_product_id constant uuid := 'fef00001-0000-4000-8000-000000000001'::uuid;

  v_actor_id uuid;
  v_doc1_id uuid;
  v_doc2_id uuid;
  v_order1_id uuid;
  v_order2_id uuid;

  v_attempt1_doc1 uuid;
  v_attempt1_doc2 uuid;
  v_attempt2_doc2 uuid;
  v_claim jsonb;
  v_finalize jsonb;

  v_orders_before jsonb;
  v_orders_after jsonb;
  v_payments_before jsonb;
  v_payments_after jsonb;

  v_retry_before integer;
  v_retry_after integer;
  v_attempt_count integer;
  v_doc_status text;
  v_attempt_outcome text;
  v_last_error text;

begin
  if not exists (select 1 from public.fel_emission_config where id = 1) then
    raise exception 'GUARD_FAIL: fel_emission_config id=1 missing';
  end if;

  if not exists (
    select 1
    from public.fel_emission_config
    where id = 1
      and environment = 'stage'
      and emission_enabled = false
      and auto_issue_paid_orders = false
      and formal_contingency_enabled = false
  ) then
    raise exception
      'GUARD_FAIL: fel_emission_config id=1 not in safe Stage baseline '
      '(stage / emission_enabled=false / auto_issue=false / contingency=false)';
  end if;

  select p.id into v_actor_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = lower('cajero@stage-fel.test')
    and p.status = 'active'
    and public.normalize_profile_role(p.role) in ('caja', 'cajero')
  limit 1;

  if v_actor_id is null then
    raise exception 'GUARD_FAIL: cajero@stage-fel.test active profile with role caja/cajero not found';
  end if;

  if (
    select count(*)
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where o.table_id = 'M-FEL-PAID'
      and public.fel_round_money(o.total) = 297.00
      and o.status = 'paid'
      and d.environment = 'stage'
      and d.status in ('pending_certification', 'failed')
      and d.request_payload is null
      and d.fel_uuid is null
      and d.sat_authorization is null
      and d.certified_at is null
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
      and public.fel_round_money(
        (public.fel_order_payment_reconciliation(o.id) ->> 'amount_paid')::numeric
      ) = public.fel_round_money(
        (public.fel_order_payment_reconciliation(o.id) ->> 'order_total')::numeric
      )
      and o.table_id in ('M-FEL-OPEN', 'M-FEL-PARTIAL', 'M-FEL-PAID')
      and exists (
        select 1
        from public.pos_order_items i
        where i.order_id = o.id
          and i.product_id = v_fixture_product_id
          and i.status <> 'cancelled'
      )
      and not exists (
        select 1
        from public.pos_order_items i
        where i.order_id = o.id
          and i.status <> 'cancelled'
          and i.product_id is distinct from v_fixture_product_id
      )
  ) < 2 then
    raise exception
      'GUARD_FAIL: fewer than two fixture FEL document candidates on M-FEL-PAID Q297 paid orders';
  end if;

  if exists (
    select 1
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where o.table_id = 'M-FEL-PAID'
      and public.fel_round_money(o.total) = 297.00
      and o.status = 'paid'
      and d.environment = 'stage'
      and d.status in ('pending_certification', 'failed')
      and d.request_payload is null
      and not exists (
        select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
      )
      and (
        d.fel_uuid is not null
        or d.sat_authorization is not null
        or d.certified_at is not null
      )
  ) then
    raise exception 'GUARD_FAIL: candidate document contains certified-like fields';
  end if;

  if exists (
    select 1
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where d.status in ('pending_certification', 'failed')
      and d.environment = 'stage'
      and d.request_payload is null
      and not exists (
        select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
      )
      and (
        o.table_id is null
        or o.table_id not in ('M-FEL-OPEN', 'M-FEL-PARTIAL', 'M-FEL-PAID')
      )
  ) then
    raise exception 'GUARD_FAIL: FEL candidate document outside Stage fixture tables';
  end if;

  if exists (
    select 1
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where d.environment = 'stage'
      and d.status in ('pending_certification', 'failed')
      and o.table_id = 'M-FEL-PAID'
      and not exists (
        select 1
        from public.pos_order_items i
        where i.order_id = o.id
          and i.product_id = v_fixture_product_id
          and i.status <> 'cancelled'
      )
  ) then
    raise exception 'GUARD_FAIL: candidate order missing fictitious fixture product fef00001';
  end if;

  if exists (
    select 1
    from public.pos_fel_documents d
    join public.pos_orders o on o.id = d.order_id
    where d.environment = 'stage'
      and d.status in ('pending_certification', 'failed')
      and o.table_id = 'M-FEL-PAID'
      and public.fel_round_money(o.total) = 297.00
      and o.status = 'paid'
      and not exists (
        select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
      )
      and exists (
        select 1
        from public.pos_order_items i
        where i.order_id = o.id
          and i.status <> 'cancelled'
          and i.product_id is distinct from v_fixture_product_id
      )
  ) then
    raise exception
      'GUARD_FAIL: candidate order contains additional non-cancelled products beyond fixture fef00001';
  end if;

  select d.id, d.order_id
  into v_doc1_id, v_order1_id
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
    and not exists (
      select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
    )
    and coalesce(
      (public.fel_order_payment_reconciliation(o.id) ->> 'is_fully_paid')::boolean,
      false
    )
    and exists (
      select 1
      from public.pos_order_items i
      where i.order_id = o.id
        and i.product_id = v_fixture_product_id
        and i.status <> 'cancelled'
    )
    and not exists (
      select 1
      from public.pos_order_items i
      where i.order_id = o.id
        and i.status <> 'cancelled'
        and i.product_id is distinct from v_fixture_product_id
    )
  order by d.created_at, d.id
  limit 1;

  if v_doc1_id is null then
    raise exception 'GUARD_FAIL: no pending_certification candidate for doc1';
  end if;

  select d.id, d.order_id
  into v_doc2_id, v_order2_id
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
    and d.id <> v_doc1_id
    and not exists (
      select 1 from public.pos_fel_attempts a where a.fel_document_id = d.id
    )
    and coalesce(
      (public.fel_order_payment_reconciliation(o.id) ->> 'is_fully_paid')::boolean,
      false
    )
    and exists (
      select 1
      from public.pos_order_items i
      where i.order_id = o.id
        and i.product_id = v_fixture_product_id
        and i.status <> 'cancelled'
    )
    and not exists (
      select 1
      from public.pos_order_items i
      where i.order_id = o.id
        and i.status <> 'cancelled'
        and i.product_id is distinct from v_fixture_product_id
    )
  order by d.created_at, d.id
  limit 1;

  if v_doc2_id is null then
    raise exception 'GUARD_FAIL: no second pending_certification candidate for doc2';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'status', o.status,
      'total', o.total,
      'table_id', o.table_id
    )
    order by o.id
  )
  into v_orders_before
  from public.pos_orders o
  where o.id in (v_order1_id, v_order2_id);

  select jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'order_id', p.order_id,
      'amount', p.amount,
      'status', p.status
    )
    order by p.id
  )
  into v_payments_before
  from public.pos_order_payments p
  where p.order_id in (v_order1_id, v_order2_id);

  update public.fel_emission_config
  set
    emission_enabled = true,
    updated_at = now()
  where id = 1;

  if not exists (
    select 1
    from public.fel_emission_config
    where id = 1
      and environment = 'stage'
      and emission_enabled = true
      and auto_issue_paid_orders = false
      and formal_contingency_enabled = false
  ) then
    raise exception 'RUNTIME_FAIL: emission gate toggle did not reach expected temporary state';
  end if;

  -- 1. runtime_claim_pending_document
  v_claim := public.fel_claim_pos_fel_certification_attempt(v_doc1_id, v_actor_id);

  select count(*) into v_attempt_count
  from public.pos_fel_attempts a
  where a.fel_document_id = v_doc1_id;

  select a.id into v_attempt1_doc1
  from public.pos_fel_attempts a
  where a.fel_document_id = v_doc1_id
    and a.attempt_number = 1;

  select d.status into v_doc_status
  from public.pos_fel_documents d
  where d.id = v_doc1_id;

  insert into fel_runtime_results (scenario, passed, executed, detail)
  values (
    'runtime_claim_pending_document',
    v_claim ->> 'status' = 'processing'
      and (v_claim ->> 'attempt_number')::integer = 1
      and v_attempt_count = 1
      and v_doc_status = 'processing'
      and exists (
        select 1 from public.pos_fel_attempts a
        where a.id = v_attempt1_doc1 and a.outcome = 'pending'
      ),
    true,
    format(
      'claim=%s attempts=%s doc_status=%s attempt1=%s',
      v_claim::text, v_attempt_count, v_doc_status, v_attempt1_doc1
    )
  )
  on conflict (scenario) do update
    set passed = excluded.passed,
        executed = excluded.executed,
        detail = excluded.detail;

  -- 2. runtime_claim_processing_rejected
  begin
    perform public.fel_claim_pos_fel_certification_attempt(v_doc1_id, v_actor_id);
    insert into fel_runtime_results (scenario, passed, executed, detail)
    values (
      'runtime_claim_processing_rejected',
      false,
      true,
      'expected FEL_ALREADY_PROCESSING but claim succeeded'
    )
    on conflict (scenario) do update
      set passed = excluded.passed,
          executed = excluded.executed,
          detail = excluded.detail;
  exception
    when others then
      select count(*) into v_attempt_count
      from public.pos_fel_attempts a
      where a.fel_document_id = v_doc1_id;

      insert into fel_runtime_results (scenario, passed, executed, detail)
      values (
        'runtime_claim_processing_rejected',
        position('FEL_ALREADY_PROCESSING' in sqlerrm) = 1 and v_attempt_count = 1,
        true,
        sqlerrm || format(' attempts=%s', v_attempt_count)
      )
      on conflict (scenario) do update
        set passed = excluded.passed,
            executed = excluded.executed,
            detail = excluded.detail;
  end;

  -- 3. runtime_finalize_success
  v_finalize := public.fel_finalize_pos_fel_certification_attempt(
    v_doc1_id,
    v_attempt1_doc1,
    'success',
    'TEST-ROLLBACK-NOT-CERTIFIED',
    'TEST-ROLLBACK-NOT-CERTIFIED',
    null,
    null,
    null,
    200,
    null,
    null,
    '{"http_status": 200, "provider_valid": true}'::jsonb,
    null
  );

  select d.status into v_doc_status
  from public.pos_fel_documents d
  where d.id = v_doc1_id;

  select a.outcome into v_attempt_outcome
  from public.pos_fel_attempts a
  where a.id = v_attempt1_doc1;

  insert into fel_runtime_results (scenario, passed, executed, detail)
  values (
    'runtime_finalize_success',
    v_finalize ->> 'status' = 'certified'
      and v_finalize ->> 'outcome' = 'success'
      and v_doc_status = 'certified'
      and v_attempt_outcome = 'success'
      and exists (
        select 1 from public.pos_fel_documents d
        where d.id = v_doc1_id
          and d.fel_uuid = 'TEST-ROLLBACK-NOT-CERTIFIED'
          and d.sat_authorization = 'TEST-ROLLBACK-NOT-CERTIFIED'
      ),
    true,
    format('finalize=%s doc_status=%s attempt_outcome=%s', v_finalize::text, v_doc_status, v_attempt_outcome)
  )
  on conflict (scenario) do update
    set passed = excluded.passed,
        executed = excluded.executed,
        detail = excluded.detail;

  -- 4. runtime_certified_not_overwritable
  begin
    perform public.fel_finalize_pos_fel_certification_attempt(
      v_doc1_id,
      v_attempt1_doc1,
      'success',
      'TEST-OVERWRITE-BLOCKED',
      'TEST-OVERWRITE-BLOCKED',
      null,
      null,
      null,
      200,
      null,
      null,
      '{"http_status": 200}'::jsonb,
      null
    );
    insert into fel_runtime_results (scenario, passed, executed, detail)
    values (
      'runtime_certified_not_overwritable',
      false,
      true,
      'expected FEL_ALREADY_CERTIFIED but finalize succeeded'
    )
    on conflict (scenario) do update
      set passed = excluded.passed,
          executed = excluded.executed,
          detail = excluded.detail;
  exception
    when others then
      insert into fel_runtime_results (scenario, passed, executed, detail)
      values (
        'runtime_certified_not_overwritable',
        position('FEL_ALREADY_CERTIFIED' in sqlerrm) = 1
          and exists (
            select 1 from public.pos_fel_documents d
            where d.id = v_doc1_id
              and d.fel_uuid = 'TEST-ROLLBACK-NOT-CERTIFIED'
              and d.sat_authorization = 'TEST-ROLLBACK-NOT-CERTIFIED'
          ),
        true,
        sqlerrm
      )
      on conflict (scenario) do update
        set passed = excluded.passed,
            executed = excluded.executed,
            detail = excluded.detail;
  end;

  -- 5. runtime_finalize_failure_retry
  select d.retry_count into v_retry_before
  from public.pos_fel_documents d
  where d.id = v_doc2_id;

  v_claim := public.fel_claim_pos_fel_certification_attempt(v_doc2_id, v_actor_id);

  select a.id into v_attempt1_doc2
  from public.pos_fel_attempts a
  where a.fel_document_id = v_doc2_id
    and a.attempt_number = 1;

  v_finalize := public.fel_finalize_pos_fel_certification_attempt(
    v_doc2_id,
    v_attempt1_doc2,
    'failed',
    null,
    null,
    null,
    null,
    null,
    502,
    'FEL_TEST_RUNTIME',
    'Simulated runtime failure — rollback test only',
    '{"http_status": 502, "error_kind": "transport", "safe_code": "FEL_TEST"}'::jsonb,
    null
  );

  select d.status, d.retry_count, d.last_error
  into v_doc_status, v_retry_after, v_last_error
  from public.pos_fel_documents d
  where d.id = v_doc2_id;

  select a.outcome into v_attempt_outcome
  from public.pos_fel_attempts a
  where a.id = v_attempt1_doc2;

  insert into fel_runtime_results (scenario, passed, executed, detail)
  values (
    'runtime_finalize_failure_retry',
    v_finalize ->> 'status' = 'failed'
      and v_finalize ->> 'outcome' = 'failed'
      and v_doc_status = 'failed'
      and v_attempt_outcome = 'failed'
      and v_retry_after = v_retry_before + 1
      and v_last_error is not null
      and char_length(v_last_error) > 0,
    true,
    format(
      'retry %s→%s finalize=%s last_error=%s',
      v_retry_before, v_retry_after, v_finalize::text, v_last_error
    )
  )
  on conflict (scenario) do update
    set passed = excluded.passed,
        executed = excluded.executed,
        detail = excluded.detail;

  -- 6. runtime_reclaim_failed_document
  v_claim := public.fel_claim_pos_fel_certification_attempt(v_doc2_id, v_actor_id);

  select a.id into v_attempt2_doc2
  from public.pos_fel_attempts a
  where a.fel_document_id = v_doc2_id
    and a.attempt_number = 2;

  select d.status into v_doc_status
  from public.pos_fel_documents d
  where d.id = v_doc2_id;

  insert into fel_runtime_results (scenario, passed, executed, detail)
  values (
    'runtime_reclaim_failed_document',
    (v_claim ->> 'attempt_number')::integer = 2
      and v_claim ->> 'status' = 'processing'
      and v_doc_status = 'processing'
      and exists (
        select 1 from public.pos_fel_attempts a
        where a.id = v_attempt2_doc2 and a.outcome = 'pending'
      ),
    true,
    format('claim=%s doc_status=%s attempt2=%s', v_claim::text, v_doc_status, v_attempt2_doc2)
  )
  on conflict (scenario) do update
    set passed = excluded.passed,
        executed = excluded.executed,
        detail = excluded.detail;

  -- 7. runtime_stale_attempt_rejected
  begin
    perform public.fel_finalize_pos_fel_certification_attempt(
      v_doc2_id,
      v_attempt1_doc2,
      'failed',
      null,
      null,
      null,
      null,
      null,
      502,
      'FEL_TEST_STALE',
      'stale worker test',
      '{"http_status": 502, "safe_code": "STALE"}'::jsonb,
      null
    );
    insert into fel_runtime_results (scenario, passed, executed, detail)
    values (
      'runtime_stale_attempt_rejected',
      false,
      true,
      'expected FEL_FINALIZE_STALE but finalize succeeded'
    )
    on conflict (scenario) do update
      set passed = excluded.passed,
          executed = excluded.executed,
          detail = excluded.detail;
  exception
    when others then
      select a.outcome into v_attempt_outcome
      from public.pos_fel_attempts a
      where a.id = v_attempt2_doc2;

      insert into fel_runtime_results (scenario, passed, executed, detail)
      values (
        'runtime_stale_attempt_rejected',
        position('FEL_FINALIZE_STALE' in sqlerrm) = 1
          and v_attempt_outcome = 'pending',
        true,
        sqlerrm || format(' attempt2_outcome=%s', v_attempt_outcome)
      )
      on conflict (scenario) do update
        set passed = excluded.passed,
            executed = excluded.executed,
            detail = excluded.detail;
  end;

  -- 8. runtime_attempt_belongs_to_document
  begin
    perform public.fel_finalize_pos_fel_certification_attempt(
      v_doc2_id,
      v_attempt1_doc1,
      'failed',
      null,
      null,
      null,
      null,
      null,
      404,
      'FEL_TEST_CROSS',
      'cross document attempt test',
      '{"http_status": 404, "safe_code": "CROSS"}'::jsonb,
      null
    );
    insert into fel_runtime_results (scenario, passed, executed, detail)
    values (
      'runtime_attempt_belongs_to_document',
      false,
      true,
      'expected FEL_ATTEMPT_NOT_FOUND but finalize succeeded'
    )
    on conflict (scenario) do update
      set passed = excluded.passed,
          executed = excluded.executed,
          detail = excluded.detail;
  exception
    when others then
      select d.status into v_doc_status
      from public.pos_fel_documents d
      where d.id = v_doc2_id;

      select a.outcome into v_attempt_outcome
      from public.pos_fel_attempts a
      where a.id = v_attempt2_doc2;

      insert into fel_runtime_results (scenario, passed, executed, detail)
      values (
        'runtime_attempt_belongs_to_document',
        position('FEL_ATTEMPT_NOT_FOUND' in sqlerrm) = 1
          and v_doc_status = 'processing'
          and v_attempt_outcome = 'pending',
        true,
        sqlerrm || format(' doc2_status=%s attempt2_outcome=%s', v_doc_status, v_attempt_outcome)
      )
      on conflict (scenario) do update
        set passed = excluded.passed,
            executed = excluded.executed,
            detail = excluded.detail;
  end;

  -- 9. runtime_order_payment_intact
  select jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'status', o.status,
      'total', o.total,
      'table_id', o.table_id
    )
    order by o.id
  )
  into v_orders_after
  from public.pos_orders o
  where o.id in (v_order1_id, v_order2_id);

  select jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'order_id', p.order_id,
      'amount', p.amount,
      'status', p.status
    )
    order by p.id
  )
  into v_payments_after
  from public.pos_order_payments p
  where p.order_id in (v_order1_id, v_order2_id);

  insert into fel_runtime_results (scenario, passed, executed, detail)
  values (
    'runtime_order_payment_intact',
    v_orders_before is not distinct from v_orders_after
      and v_payments_before is not distinct from v_payments_after,
    true,
    format(
      'orders_equal=%s payments_equal=%s',
      v_orders_before is not distinct from v_orders_after,
      v_payments_before is not distinct from v_payments_after
    )
  )
  on conflict (scenario) do update
    set passed = excluded.passed,
        executed = excluded.executed,
        detail = excluded.detail;

  perform public.fel_finalize_pos_fel_certification_attempt(
    v_doc2_id,
    v_attempt2_doc2,
    'failed',
    null,
    null,
    null,
    null,
    null,
    499,
    'FEL_TEST_CLEANUP',
    'Controlled cleanup before rollback',
    '{"http_status": 499, "safe_code": "CLEANUP"}'::jsonb,
    null
  );

end;
$fel_runtime$;

select
  scenario,
  passed,
  executed,
  detail
from fel_runtime_results
order by scenario;

select
  count(*) filter (where executed and passed) as executed_passed,
  count(*) filter (where executed and not passed) as executed_failed,
  count(*) filter (where not executed) as not_executed,
  count(*) as total
from fel_runtime_results;

rollback;
