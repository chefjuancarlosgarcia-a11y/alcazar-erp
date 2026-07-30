-- 199: Station POS catalog parity (batch image_url) + differentiated draft/order errors.
-- Apply after 198_operational_station_pos_shared_foundation.sql. Do NOT reapply 197/198.
-- Forward-only: no business row mutations outside lab tests (tests use BEGIN…ROLLBACK).

begin;

-- ---------------------------------------------------------------------------
-- Differentiated errors for draft mutations (owner / order state)
-- ---------------------------------------------------------------------------
create or replace function public.station_pos_assert_order_open_for_drafts(
  p_order_id uuid,
  p_operator_id uuid
)
returns public.pos_orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.pos_orders;
begin
  select * into v_order
  from public.pos_orders
  where id = p_order_id;

  if v_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  if v_order.status <> 'open' then
    raise exception 'STATION_POS_ORDER_NOT_OPEN'
      using hint = 'Order is not open for draft items.';
  end if;

  if not public.station_pos_is_order_owner(p_order_id, p_operator_id) then
    raise exception 'STATION_POS_ORDER_OWNER_MISMATCH'
      using hint = 'Only the order owner can modify draft items on this table.';
  end if;

  return v_order;
end;
$$;

revoke all on function public.station_pos_assert_order_open_for_drafts(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- open_station_pos_table_service: block silent reuse of another operator's order
-- ---------------------------------------------------------------------------
create or replace function public.open_station_pos_table_service(
  p_operator_session_token text,
  p_table_id text,
  p_table_name text,
  p_area_id text,
  p_area_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_table_id text;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_reuse_id uuid;
  v_order public.pos_orders;
  v_waiter_name text;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_table_id := nullif(trim(p_table_id), '');
  if v_table_id is null then
    raise exception 'Table id is required.';
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'open_table_service',
    jsonb_build_object(
      'table_id', v_table_id,
      'table_name', coalesce(nullif(trim(p_table_name), ''), 'Mesa'),
      'area_id', coalesce(nullif(trim(p_area_id), ''), ''),
      'area_name', coalesce(nullif(trim(p_area_name), ''), ''),
      'sales_channel', 'dine_in'
    )
  );

  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'open_table_service', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'open_table_service', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);

  if not public.station_pos_can_operate_orders(v_operator_id) then
    raise exception '%', v_generic;
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_table_service:' || v_table_id));

  v_reuse_id := public.pos_table_has_reusable_active_order(v_table_id);
  if v_reuse_id is not null then
    select * into v_order from public.pos_orders where id = v_reuse_id;
    if v_order.owner_profile_id is distinct from v_operator_id then
      raise exception 'STATION_POS_ORDER_OWNER_MISMATCH'
        using hint = 'Table service owned by another operator.';
    end if;
    v_result := jsonb_build_object(
      'created', false,
      'reused', true,
      'order_id', v_order.id,
      'owner_profile_id', v_order.owner_profile_id,
      'status', v_order.status,
      'table_id', v_order.table_id
    );
    perform public.station_pos_record_audit(
      v_order.id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
      'open_table_service', v_fingerprint, v_result
    );
    perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
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
  where p.id = v_operator_id;

  begin
    insert into public.pos_orders (
      table_id, table_name, area_id, area_name,
      sales_channel,
      waiter_id, waiter_name, owner_profile_id, status
    ) values (
      v_table_id,
      coalesce(nullif(trim(p_table_name), ''), 'Mesa'),
      nullif(trim(p_area_id), ''),
      nullif(trim(p_area_name), ''),
      'dine_in',
      v_operator_id,
      v_waiter_name,
      v_operator_id,
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
      if v_order.owner_profile_id is distinct from v_operator_id then
        raise exception 'STATION_POS_ORDER_OWNER_MISMATCH'
          using hint = 'Table service owned by another operator.';
      end if;
      v_result := jsonb_build_object(
        'created', false,
        'reused', true,
        'order_id', v_order.id,
        'owner_profile_id', v_order.owner_profile_id,
        'status', v_order.status,
        'table_id', v_order.table_id
      );
      perform public.station_pos_record_audit(
        v_order.id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
        'open_table_service', v_fingerprint, v_result
      );
      perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
      return v_result;
  end;

  insert into public.pos_order_events (
    order_id,
    event_type,
    description,
    created_by
  )
  values (
    v_order.id,
    'service_opened',
    'Servicio abierto en ' || coalesce(v_order.table_name, v_table_id) || '.',
    v_operator_id
  );

  v_result := jsonb_build_object(
    'created', true,
    'reused', false,
    'order_id', v_order.id,
    'owner_profile_id', v_order.owner_profile_id,
    'status', v_order.status,
    'table_id', v_order.table_id
  );
  perform public.station_pos_record_audit(
    v_order.id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'open_table_service', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'STATION_POS_%' or sqlerrm like 'POS_TABLE_%' or sqlerrm like 'POS_IDEMPOTENCY_%' then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

revoke all on function public.open_station_pos_table_service(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog batch parity: image_url + description + production_area_name (no N+1)
-- ---------------------------------------------------------------------------
create or replace function public.get_station_pos_catalog(p_operator_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_products jsonb;
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  perform public.resolve_station_pos_operator_context(p_operator_session_token, false);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'description', coalesce(p.description, ''),
      'price', p.price,
      'category_id', p.category_id,
      'category_name', p.category_name,
      'recipe_id', p.recipe_id,
      'production_area_id', p.production_area_id,
      'production_area_name', coalesce(a.name, p.production_area_id),
      'production_ready', p.production_ready,
      'product_type', p.product_type,
      'is_test_item', p.is_test_item,
      'allow_kitchen_notes', p.allow_kitchen_notes,
      'sort_order', p.sort_order,
      'image_url', case
        when p.image_url is not null
          and btrim(p.image_url) <> ''
          and p.image_url not like 'data:%'
        then p.image_url
        else null
      end,
      'variants', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'name', v.name,
            'size', v.size,
            'price', v.price,
            'recipe_id', v.recipe_id,
            'production_area_id', v.production_area_id,
            'is_active', v.is_active,
            'sort_order', v.sort_order
          )
          order by v.sort_order, v.name
        ), '[]'::jsonb)
        from public.pos_product_variants v
        where v.product_id = p.id and v.is_active = true
      ),
      'modifiers', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'name', m.name,
            'modifier_type', m.modifier_type,
            'price_delta', m.price_delta,
            'sort_order', m.sort_order
          )
          order by m.sort_order, m.name
        ), '[]'::jsonb)
        from public.pos_product_modifiers m
        where m.product_id = p.id and m.is_active = true
      ),
      'option_groups', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'required', g.required,
            'selection_mode', g.selection_mode,
            'min_selections', g.min_selections,
            'max_selections', g.max_selections,
            'sort_order', g.sort_order,
            'choices', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'price_mode', c.price_mode,
                  'price', c.price,
                  'recipe_id', c.recipe_id,
                  'sort_order', c.sort_order
                )
                order by c.sort_order, c.name
              ), '[]'::jsonb)
              from public.pos_option_choices c
              where c.group_id = g.id and c.is_active = true and trim(c.name) <> ''
            )
          )
          order by g.sort_order, g.name
        ), '[]'::jsonb)
        from public.pos_option_groups g
        where g.product_id = p.id and g.is_active = true
      )
    )
    order by p.sort_order, p.name
  ), '[]'::jsonb)
  into v_products
  from public.pos_products p
  left join public.areas a on a.id = p.production_area_id
  where p.active = true;

  return jsonb_build_object('products', v_products);
end;
$$;

revoke all on function public.get_station_pos_catalog(text)
  from public, anon, authenticated, service_role;

-- Preserve ACL (same as 198 public wrappers)
grant execute on function public.open_station_pos_table_service(text, text, text, text, text, text) to authenticated;
grant execute on function public.get_station_pos_catalog(text) to authenticated;

commit;
