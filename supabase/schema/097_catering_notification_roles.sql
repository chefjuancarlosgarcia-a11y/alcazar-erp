-- Restrict catering notifications and module access to commercial leadership roles.
-- apply after 096_pos_printer_prebill_support.sql

-- Central allow-list (extend later via app config: sales_rep, catering_manager).
create or replace function public.catering_notification_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'admin',
    'gerente_general',
    'gerente_operaciones'
  ]::text[];
$$;

comment on function public.catering_notification_roles() is
  'Roles that receive catering notifications and can manage the catering module. Future: sales_rep, catering_manager.';

-- Backward-compatible alias used by notify RPCs.
create or replace function public.catering_request_notification_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select public.catering_notification_roles();
$$;

create or replace function public.can_receive_catering_notifications(p_role text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.normalize_profile_role(coalesce(p_role, ''))
    = any(public.catering_notification_roles());
$$;

create or replace function public.is_catering_notification(p_type text, p_entity_type text default null)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(trim(p_type), ''), '') in (
      'catering_request',
      'catering_followup_due',
      'catering_quote',
      'catering_lead_assigned'
    )
    or coalesce(nullif(trim(p_entity_type), ''), '') = 'catering_request';
$$;

create or replace function public.can_manage_catering_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_receive_catering_notifications(public.current_profile_role());
$$;

create or replace function public.notify_catering_lead_assigned(
  p_request_id uuid,
  p_assigned_to uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
  v_action_url text;
  v_inserted integer := 0;
begin
  if p_request_id is null or p_assigned_to is null then
    return 0;
  end if;

  select * into v_request from public.catering_requests where id = p_request_id;
  if not found then
    return 0;
  end if;

  v_action_url := '/catering?id=' || v_request.id::text;

  insert into public.notifications (
    user_id,
    target_role,
    type,
    title,
    message,
    entity_type,
    entity_id,
    action_url
  )
  select
    assignee.id,
    null,
    'catering_lead_assigned',
    'Lead de catering asignado',
    coalesce(nullif(trim(v_request.customer_name), ''), 'Cliente')
      || ' te fue asignado para seguimiento comercial.',
    'catering_request',
    v_request.id::text,
    v_action_url
  from public.profiles assignee
  where assignee.id = p_assigned_to
    and assignee.status = 'active'
    and public.can_receive_catering_notifications(assignee.role)
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p_assigned_to
        and n.type = 'catering_lead_assigned'
        and n.entity_type = 'catering_request'
        and n.entity_id = v_request.id::text
        and n.created_at > now() - interval '1 hour'
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
exception
  when others then
    raise warning 'notify_catering_lead_assigned failed for %: %', p_request_id, sqlerrm;
    return 0;
end;
$$;

drop policy if exists "notifications_read_recipients" on public.notifications;

create policy "notifications_read_recipients"
  on public.notifications
  for select
  to authenticated
  using (
    (
      user_id = auth.uid()
      or (
        target_role is not null
        and public.normalize_profile_role(target_role) = public.normalize_profile_role(
          public.current_profile_role()
        )
      )
    )
    and (
      not public.is_catering_notification(type, entity_type)
      or public.can_receive_catering_notifications(public.current_profile_role())
    )
  );

create or replace function public.get_my_notifications(p_limit integer default 100)
returns setof public.notifications
language sql
stable
security definer
set search_path = ''
as $$
  select n.*
  from public.notifications n
  where auth.uid() is not null
    and (
      n.user_id = auth.uid()
      or (
        n.target_role is not null
        and public.normalize_profile_role(n.target_role) = public.normalize_profile_role(
          public.current_profile_role()
        )
      )
    )
    and (
      not public.is_catering_notification(n.type, n.entity_type)
      or public.can_receive_catering_notifications(public.current_profile_role())
    )
  order by n.is_read asc, n.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.catering_notification_roles() from public;
revoke all on function public.can_receive_catering_notifications(text) from public;
revoke all on function public.is_catering_notification(text, text) from public;

grant execute on function public.catering_notification_roles() to authenticated, service_role;
grant execute on function public.can_receive_catering_notifications(text) to authenticated, service_role;
grant execute on function public.is_catering_notification(text, text) to authenticated, service_role;
