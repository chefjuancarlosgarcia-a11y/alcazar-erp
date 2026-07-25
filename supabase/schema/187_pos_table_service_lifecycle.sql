-- F0A follow-up — POS table service lifecycle (187): open + release, idempotency, unique index.
-- Apply after 186_fix_clear_pos_order_draft_items_mixed_order.sql (or latest schema).
-- Does NOT auto-close existing open orders. Aborts entirely if duplicate active orders per table_id exist.
-- Single transaction: gate failure rolls back auxiliary functions too.

begin;

-- =============================================================================
-- A. Auxiliary predicates (required before duplicate gate and unique index)
-- =============================================================================

create or replace function public.pos_table_service_active_statuses()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['open', 'sent', 'awaiting_bill', 'sent_to_cashier', 'partially_paid']::text[];
$$;

create or replace function public.pos_dine_in_table_service_predicate(
  p_sales_channel text,
  p_table_id text,
  p_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(p_sales_channel), ''), 'dine_in') = 'dine_in'
    and p_table_id is not null
    and btrim(p_table_id) <> ''
    and p_status = any(public.pos_table_service_active_statuses());
$$;

-- =============================================================================
-- B. Precondition: duplicate active orders block migration (no partial apply)
-- =============================================================================

do $$
declare
  v_duplicate_tables integer;
  v_sample text;
begin
  select count(*)::integer,
         coalesce(string_agg(table_id || ' (' || n::text || ')', ', ' order by table_id), '')
    into v_duplicate_tables, v_sample
  from (
    select o.table_id, count(*)::integer as n
    from public.pos_orders o
    where public.pos_dine_in_table_service_predicate(o.sales_channel, o.table_id, o.status)
    group by o.table_id
    having count(*) > 1
  ) dup;

  if v_duplicate_tables > 0 then
    raise exception
      '187 POS migration aborted: % table_id(s) have duplicate active orders (%). Run diagnose_pos_table_service_lifecycle_187.sql, resolve manually, then re-apply.',
      v_duplicate_tables, v_sample
      using errcode = 'P0001';
  end if;
end $$;

-- =============================================================================
-- 1. Idempotency store
-- =============================================================================

create table if not exists public.pos_rpc_idempotency (
  idempotency_key uuid primary key,
  rpc_name text not null,
  actor_id uuid references public.profiles(id),
  resource_key text not null,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pos_rpc_idempotency_created_idx
  on public.pos_rpc_idempotency (created_at desc);

create index if not exists pos_rpc_idempotency_rpc_resource_idx
  on public.pos_rpc_idempotency (rpc_name, resource_key, created_at desc);

alter table public.pos_rpc_idempotency enable row level security;

drop policy if exists "pos_rpc_idempotency_service_role_all" on public.pos_rpc_idempotency;
create policy "pos_rpc_idempotency_service_role_all"
  on public.pos_rpc_idempotency for all to service_role
  using (true) with check (true);

revoke all on table public.pos_rpc_idempotency from public;
revoke all on table public.pos_rpc_idempotency from anon;
grant select on table public.pos_rpc_idempotency to authenticated;
grant all on table public.pos_rpc_idempotency to service_role;

-- =============================================================================
-- 2. Role / order helpers
-- =============================================================================

create or replace function public.is_pos_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) = 'supervisor'
  );
$$;

create or replace function public.is_pos_general_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) = 'gerente_general'
  );
$$;

create or replace function public.is_pos_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) = 'admin'
  );
$$;

create or replace function public.is_pos_elevated_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_pos_supervisor()
      or public.is_pos_general_manager()
      or public.is_pos_admin();
$$;

create or replace function public.is_order_owner(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.id = p_order_id
      and o.owner_profile_id is not null
      and o.owner_profile_id = auth.uid()
  );
$$;

create or replace function public.pos_order_has_active_items(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_order_items i
    where i.order_id = p_order_id
      and i.status <> 'cancelled'
  );
$$;

create or replace function public.pos_order_ever_sent_to_kds(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_order_items i
    where i.order_id = p_order_id
      and i.status not in ('draft', 'cancelled')
  )
  or exists (
    select 1
    from public.production_tickets t
    where t.order_id = p_order_id::text
  );
$$;

create or replace function public.pos_order_has_payments(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_order_payments p
    where p.order_id = p_order_id
      and p.status = 'paid'
  );
$$;

create or replace function public.pos_table_is_zombie_open(p_table_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.table_id = p_table_id
      and o.sales_channel = 'dine_in'
      and o.status = 'open'
      and not public.pos_order_has_active_items(o.id)
      and not public.pos_order_has_payments(o.id)
  );
$$;

create or replace function public.pos_table_has_reusable_active_order(p_table_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.pos_orders o
  where o.table_id = p_table_id
    and o.sales_channel = 'dine_in'
    and o.status = any(public.pos_table_service_active_statuses())
    and public.pos_order_has_active_items(o.id)
  order by o.created_at desc
  limit 1;
$$;

create or replace function public.pos_table_has_billing_block(p_table_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.table_id = p_table_id
      and o.sales_channel = 'dine_in'
      and o.status in ('awaiting_bill', 'sent_to_cashier', 'partially_paid')
  );
$$;

create or replace function public.pos_classify_release_scenario(p_order_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.pos_orders;
  v_item_count integer;
  v_draft_only boolean;
begin
  select * into v_order from public.pos_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'POS order not found.';
  end if;

  if v_order.status = 'paid' then
    return 'L6_paid';
  end if;
  if v_order.status = 'cancelled' then
    return 'L6_cancelled';
  end if;
  if v_order.status = 'partially_paid' or public.pos_order_has_payments(p_order_id) then
    return 'L5_payments';
  end if;
  if v_order.status in ('awaiting_bill', 'sent_to_cashier') then
    return 'L4_billing';
  end if;
  if public.pos_order_ever_sent_to_kds(p_order_id) then
    return 'L3_kds_history';
  end if;

  select count(*) into v_item_count
  from public.pos_order_items i
  where i.order_id = p_order_id;

  if v_item_count = 0 then
    return 'L1_empty';
  end if;

  select not exists (
    select 1 from public.pos_order_items i
    where i.order_id = p_order_id and i.status <> 'draft'
  ) into v_draft_only;

  if v_draft_only then
    return 'L2_drafts_only';
  end if;

  return 'L3_kds_history';
end;
$$;

create or replace function public.pos_assert_release_authorized(
  p_order_id uuid,
  p_scenario text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_scenario = 'L5_payments' then
    raise exception 'POS_RELEASE_BLOCKED_PAYMENTS'
      using hint = 'Orders with payments require flow 189.';
  end if;

  if p_scenario in ('L1_empty', 'L2_drafts_only') then
    if not public.is_order_owner(p_order_id) then
      raise exception 'POS_RELEASE_NOT_OWNER'
        using hint = 'Only the order owner can release this service scenario.';
    end if;
    return;
  end if;

  if p_scenario in ('L3_kds_history', 'L4_billing') then
    if not public.is_pos_elevated_supervisor() then
      raise exception 'POS_RELEASE_REQUIRES_SUPERVISOR'
        using hint = 'Supervisor, general manager, or admin required.';
    end if;
    return;
  end if;
end;
$$;

create or replace function public.pos_rpc_fingerprint(p_parts text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(array_to_string(p_parts, '|'), ''));
$$;

create or replace function public.pos_store_rpc_idempotency(
  p_key uuid,
  p_rpc_name text,
  p_resource_key text,
  p_fingerprint text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pos_rpc_idempotency (
    idempotency_key, rpc_name, actor_id, resource_key, request_fingerprint, result
  ) values (
    p_key, p_rpc_name, auth.uid(), p_resource_key, p_fingerprint, p_result
  );
end;
$$;

create or replace function public.pos_load_rpc_idempotency(
  p_key uuid,
  p_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.pos_rpc_idempotency;
begin
  if p_key is null then
    raise exception 'POS_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select * into v_row
  from public.pos_rpc_idempotency
  where idempotency_key = p_key;

  if v_row.idempotency_key is null then
    return null;
  end if;

  if v_row.request_fingerprint is distinct from p_fingerprint then
    raise exception 'POS_IDEMPOTENCY_FINGERPRINT_MISMATCH'
      using hint = 'Same idempotency key was used with different parameters.';
  end if;

  return v_row.result;
end;
$$;

-- =============================================================================
-- 3. open_pos_table_service
-- =============================================================================

create or replace function public.open_pos_table_service(
  p_table_id text,
  p_table_name text,
  p_area_id text,
  p_area_name text,
  p_sales_channel text default 'dine_in',
  p_customer_id uuid default null,
  p_customer_address_id uuid default null,
  p_delivery_notes text default null,
  p_external_source text default null,
  p_external_order_id text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id text;
  v_fingerprint text;
  v_cached jsonb;
  v_reuse_id uuid;
  v_order public.pos_orders;
  v_waiter_name text;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para abrir servicio POS.';
  end if;

  if coalesce(nullif(trim(p_sales_channel), ''), 'dine_in') <> 'dine_in' then
    raise exception 'open_pos_table_service supports dine_in table service only.'
      using hint = 'Use legacy channel flow for delivery, takeout, or online.';
  end if;

  v_table_id := nullif(trim(p_table_id), '');
  if v_table_id is null then
    raise exception 'Table id is required.';
  end if;
  if p_idempotency_key is null then
    raise exception 'POS_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_fingerprint := public.pos_rpc_fingerprint(array[
    'open',
    v_table_id,
    coalesce(trim(p_table_name), ''),
    coalesce(trim(p_area_id), ''),
    coalesce(trim(p_area_name), ''),
    coalesce(trim(p_sales_channel), 'dine_in'),
    coalesce(p_customer_id::text, ''),
    coalesce(p_customer_address_id::text, ''),
    coalesce(trim(p_delivery_notes), ''),
    coalesce(trim(p_external_source), ''),
    coalesce(trim(p_external_order_id), '')
  ]);

  v_cached := public.pos_load_rpc_idempotency(p_idempotency_key, v_fingerprint);
  if v_cached is not null then
    return v_cached;
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_table_service:' || v_table_id));

  v_reuse_id := public.pos_table_has_reusable_active_order(v_table_id);
  if v_reuse_id is not null then
    select * into v_order from public.pos_orders where id = v_reuse_id;
    v_result := jsonb_build_object(
      'created', false,
      'reused', true,
      'order_id', v_order.id,
      'owner_profile_id', v_order.owner_profile_id,
      'status', v_order.status,
      'table_id', v_order.table_id
    );
    perform public.pos_store_rpc_idempotency(
      p_idempotency_key, 'open_pos_table_service', 'table:' || v_table_id, v_fingerprint, v_result
    );
    return v_result;
  end if;

  if public.pos_table_is_zombie_open(v_table_id) then
    raise exception 'POS_TABLE_PENDING_RELEASE'
      using hint = 'Release the pending service before opening a new one.';
  end if;

  if public.pos_table_has_billing_block(v_table_id) then
    raise exception 'POS_TABLE_IN_BILLING'
      using hint = 'Table has an order in billing flow.';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.username), ''), 'POS')
    into v_waiter_name
  from public.profiles p
  where p.id = auth.uid();

  begin
    insert into public.pos_orders (
      table_id, table_name, area_id, area_name,
      sales_channel, customer_id, customer_address_id, delivery_notes,
      external_source, external_order_id,
      waiter_id, waiter_name, owner_profile_id, status
    ) values (
      v_table_id,
      coalesce(nullif(trim(p_table_name), ''), 'Mesa'),
      nullif(trim(p_area_id), ''),
      nullif(trim(p_area_name), ''),
      coalesce(nullif(trim(p_sales_channel), ''), 'dine_in'),
      p_customer_id,
      p_customer_address_id,
      nullif(trim(p_delivery_notes), ''),
      nullif(trim(p_external_source), ''),
      nullif(trim(p_external_order_id), ''),
      auth.uid(),
      v_waiter_name,
      auth.uid(),
      'open'
    )
    returning * into v_order;
  exception
    when unique_violation then
      v_reuse_id := public.pos_table_has_reusable_active_order(v_table_id);
      if v_reuse_id is null then
        raise;
      end if;
      select * into v_order from public.pos_orders where id = v_reuse_id;
      v_result := jsonb_build_object(
        'created', false,
        'reused', true,
        'order_id', v_order.id,
        'owner_profile_id', v_order.owner_profile_id,
        'status', v_order.status,
        'table_id', v_order.table_id
      );
      perform public.pos_store_rpc_idempotency(
        p_idempotency_key, 'open_pos_table_service', 'table:' || v_table_id, v_fingerprint, v_result
      );
      return v_result;
  end;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    v_order.id,
    'service_opened',
    'Servicio abierto en ' || coalesce(v_order.table_name, v_table_id) || '.',
    auth.uid()
  );

  v_result := jsonb_build_object(
    'created', true,
    'reused', false,
    'order_id', v_order.id,
    'owner_profile_id', v_order.owner_profile_id,
    'status', v_order.status,
    'table_id', v_order.table_id
  );

  perform public.pos_store_rpc_idempotency(
    p_idempotency_key, 'open_pos_table_service', 'table:' || v_table_id, v_fingerprint, v_result
  );

  return v_result;
end;
$$;

-- =============================================================================
-- 4. release_pos_table_service
-- =============================================================================

create or replace function public.release_pos_table_service(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key uuid default null,
  p_force_supervisor boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pos_orders;
  v_scenario text;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_authorized_by uuid;
  v_removed integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.can_operate_pos_orders() then
    raise exception 'No tienes permiso para liberar servicio POS.';
  end if;
  if p_idempotency_key is null then
    raise exception 'POS_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'POS_RELEASE_REASON_REQUIRED';
  end if;

  v_fingerprint := public.pos_rpc_fingerprint(array[
    'release',
    p_order_id::text,
    trim(p_reason)
  ]);

  v_cached := public.pos_load_rpc_idempotency(p_idempotency_key, v_fingerprint);
  if v_cached is not null then
    return v_cached;
  end if;

  select * into v_order
  from public.pos_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_table_service:' || coalesce(v_order.table_id, p_order_id::text)));

  if v_order.status = 'cancelled' then
    v_result := jsonb_build_object(
      'released', true,
      'already', true,
      'order_id', v_order.id,
      'status', v_order.status
    );
    perform public.pos_store_rpc_idempotency(
      p_idempotency_key, 'release_pos_table_service', 'order:' || p_order_id::text, v_fingerprint, v_result
    );
    return v_result;
  end if;

  if v_order.status = 'paid' then
    v_result := jsonb_build_object(
      'released', false,
      'reason', 'already_paid',
      'order_id', v_order.id,
      'status', v_order.status
    );
    perform public.pos_store_rpc_idempotency(
      p_idempotency_key, 'release_pos_table_service', 'order:' || p_order_id::text, v_fingerprint, v_result
    );
    return v_result;
  end if;

  v_scenario := public.pos_classify_release_scenario(p_order_id);
  perform public.pos_assert_release_authorized(p_order_id, v_scenario);

  if v_scenario = 'L2_drafts_only' then
    v_removed := public.clear_pos_order_draft_items(p_order_id);
  end if;

  v_authorized_by := case
    when public.is_pos_elevated_supervisor()
         and (not public.is_order_owner(p_order_id) or v_scenario in ('L3_kds_history', 'L4_billing'))
      then auth.uid()
    else null
  end;

  update public.pos_orders
  set status = 'cancelled',
      updated_at = now()
  where id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    p_order_id,
    'table_released',
    'Mesa liberada. Motivo: ' || left(trim(p_reason), 500),
    auth.uid()
  );

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    p_order_id,
    'service_cancelled',
    'Servicio cancelado (' || v_scenario || ').',
    auth.uid()
  );

  v_result := jsonb_build_object(
    'released', true,
    'order_id', p_order_id,
    'previous_status', v_order.status,
    'scenario', v_scenario,
    'authorized_by', v_authorized_by,
    'owner_profile_id', v_order.owner_profile_id,
    'drafts_cleared', coalesce(v_removed, 0)
  );

  perform public.pos_store_rpc_idempotency(
    p_idempotency_key, 'release_pos_table_service', 'order:' || p_order_id::text, v_fingerprint, v_result
  );

  return v_result;
end;
$$;

-- =============================================================================
-- 5. Unique index (safe after duplicate gate in section B)
-- =============================================================================

create unique index if not exists pos_orders_one_active_service_per_table
  on public.pos_orders (table_id)
  where public.pos_dine_in_table_service_predicate(sales_channel, table_id, status);

-- =============================================================================
-- 6. Floor plan helper alignment
-- =============================================================================

create or replace function public.pos_floor_has_open_orders(
  p_table_id text default null,
  p_area_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.status = any(public.pos_table_service_active_statuses())
      and o.sales_channel = 'dine_in'
      and (
        (p_table_id is not null and o.table_id = p_table_id)
        or (p_area_id is not null and o.area_id = p_area_id)
      )
  );
$$;

-- =============================================================================
-- 7. Grants
-- =============================================================================

revoke all on function public.pos_table_service_active_statuses() from public;
revoke all on function public.pos_dine_in_table_service_predicate(text, text, text) from public;
revoke all on function public.is_pos_supervisor() from public;
revoke all on function public.is_pos_general_manager() from public;
revoke all on function public.is_pos_admin() from public;
revoke all on function public.is_pos_elevated_supervisor() from public;
revoke all on function public.is_order_owner(uuid) from public;
revoke all on function public.pos_order_has_active_items(uuid) from public;
revoke all on function public.pos_order_ever_sent_to_kds(uuid) from public;
revoke all on function public.pos_order_has_payments(uuid) from public;
revoke all on function public.pos_table_is_zombie_open(text) from public;
revoke all on function public.pos_table_has_reusable_active_order(text) from public;
revoke all on function public.pos_table_has_billing_block(text) from public;
revoke all on function public.pos_classify_release_scenario(uuid) from public;
revoke all on function public.pos_assert_release_authorized(uuid, text) from public;
revoke all on function public.pos_rpc_fingerprint(text[]) from public;
revoke all on function public.pos_store_rpc_idempotency(uuid, text, text, text, jsonb) from public;
revoke all on function public.pos_load_rpc_idempotency(uuid, text) from public;
revoke all on function public.open_pos_table_service(text, text, text, text, text, uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.release_pos_table_service(uuid, text, uuid, boolean) from public;
revoke all on function public.pos_floor_has_open_orders(text, text) from public;

grant execute on function public.open_pos_table_service(text, text, text, text, text, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.release_pos_table_service(uuid, text, uuid, boolean) to authenticated;

grant execute on function public.open_pos_table_service(text, text, text, text, text, uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.release_pos_table_service(uuid, text, uuid, boolean) to service_role;
grant execute on function public.pos_floor_has_open_orders(text, text) to authenticated;
grant execute on function public.pos_floor_has_open_orders(text, text) to service_role;

commit;
