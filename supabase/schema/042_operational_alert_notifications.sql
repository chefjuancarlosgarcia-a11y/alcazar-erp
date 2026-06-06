-- Operational alert notifications for KDS and Cashier.
-- Apply after 041_pos_test_dishes.sql.

alter table public.notifications
  add column if not exists action_url text;

create or replace function public.notify_operational_kds_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_roles text[];
  role_name text;
  title text;
begin
  if coalesce(new.area_name, '') ~* 'barra|bar' then
    target_roles := array['bartender', 'barista'];
    title := 'Nueva orden en barra';
  else
    target_roles := array['cocinero', 'pizzero', 'panadero', 'repostero'];
    title := 'Nueva orden en cocina';
  end if;

  foreach role_name in array target_roles
  loop
    insert into public.notifications (
      target_role, type, title, message, entity_type, entity_id, action_url
    )
    values (
      role_name,
      'kds_order',
      title,
      coalesce(new.table_name, 'Orden POS') || ' - ' || coalesce(new.area_name, 'Produccion'),
      'production_ticket',
      new.id::text,
      '/production'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_operational_kds_ticket_insert on public.production_tickets;
create trigger notify_operational_kds_ticket_insert
  after insert on public.production_tickets
  for each row execute function public.notify_operational_kds_ticket();

create or replace function public.notify_operational_cashier_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'sent_to_cashier'
    and old.status is distinct from new.status then
    insert into public.notifications (
      target_role, type, title, message, entity_type, entity_id, action_url
    )
    values (
      'cajero',
      'payment_request',
      'Nueva solicitud de cobro',
      coalesce(new.table_name, 'Mesa') || ' solicita cobro.',
      'pos_order',
      new.id::text,
      '/cash'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_operational_cashier_request_update on public.pos_orders;
create trigger notify_operational_cashier_request_update
  after update of status on public.pos_orders
  for each row execute function public.notify_operational_cashier_request();
