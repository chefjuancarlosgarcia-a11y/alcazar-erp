-- 200: Attribute POS audit events to delegated operator on technical station sessions.
-- Forward-fix after 199. Does not create technical profiles or mutate existing rows.
-- Root cause: audit_pos_order_change() used auth.uid() as pos_order_events.created_by FK;
-- station device JWT (post-196) has no profiles row → FK failure → wrapper P0001.

begin;

-- Internal helper: resolve audit actor without EXECUTE for clients.
create or replace function public.pos_order_event_actor_profile(
  p_order_id uuid default null,
  p_order_owner_profile_id uuid default null,
  p_order_waiter_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
begin
  if v_uid is not null and exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.status = 'active'
  ) then
    return v_uid;
  end if;

  v_actor := coalesce(p_order_owner_profile_id, p_order_waiter_id);

  if v_actor is null and p_order_id is not null then
    select coalesce(o.owner_profile_id, o.waiter_id)
      into v_actor
    from public.pos_orders o
    where o.id = p_order_id;
  end if;

  if v_actor is not null and exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.status = 'active'
  ) then
    return v_actor;
  end if;

  raise exception 'STATION_POS_AUDIT_ACTOR_INVALID'
    using hint = 'No valid operator profile for POS audit event attribution.';
end;
$$;

revoke all on function public.pos_order_event_actor_profile(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.audit_pos_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_table_name = 'pos_orders' then
    if tg_op = 'INSERT' then
      v_actor := public.pos_order_event_actor_profile(
        new.id, new.owner_profile_id, new.waiter_id
      );
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (
        new.id,
        'order_created',
        'Orden creada para ' || coalesce(new.table_name, 'mesa'),
        v_actor
      );
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_actor := public.pos_order_event_actor_profile(
        new.id, new.owner_profile_id, new.waiter_id
      );
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (
        new.id,
        'order_' || new.status,
        'Estado de la orden actualizado a ' || new.status || '.',
        v_actor
      );
    end if;
    return new;
  end if;

  if tg_table_name = 'pos_order_items' then
    if tg_op = 'INSERT' then
      v_actor := public.pos_order_event_actor_profile(new.order_id, null, null);
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (
        new.order_id,
        'item_added',
        new.product_name || ' agregado a la orden.',
        v_actor
      );
      return new;
    elsif tg_op = 'UPDATE' then
      v_actor := public.pos_order_event_actor_profile(new.order_id, null, null);
      if new.quantity is distinct from old.quantity then
        insert into public.pos_order_events (order_id, event_type, description, created_by)
        values (
          new.order_id,
          'item_updated',
          new.product_name || ': cantidad actualizada a ' || new.quantity::text || '.',
          v_actor
        );
      elsif new.notes is distinct from old.notes then
        insert into public.pos_order_events (order_id, event_type, description, created_by)
        values (
          new.order_id,
          'item_updated',
          new.product_name || ': notas actualizadas.',
          v_actor
        );
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      v_actor := public.pos_order_event_actor_profile(old.order_id, null, null);
      insert into public.pos_order_events (order_id, event_type, description, created_by)
      values (
        old.order_id,
        'item_removed',
        old.product_name || ' eliminado de productos nuevos.',
        v_actor
      );
      return old;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

commit;
