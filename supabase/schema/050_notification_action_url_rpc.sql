-- Allow notifications created through RPC to include action URLs.
-- Apply after 049_checklist_weekday_selection_fix.sql.

drop function if exists public.create_notification(uuid, text, text, text, text, text, text);
drop function if exists public.create_notification(uuid, text, text, text, text, text, text, text);

create or replace function public.create_notification(
  p_user_id uuid,
  p_target_role text,
  p_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null
)
returns public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  inserted_notification public.notifications;
  v_action_url text;
begin
  actor_role := public.current_profile_role();
  if actor_role is null then
    raise exception 'No tienes permiso para generar notificaciones.';
  end if;

  if p_user_id is null and nullif(trim(p_target_role), '') is null then
    raise exception 'La notificacion debe tener un destinatario.';
  end if;

  v_action_url := nullif(trim(p_action_url), '');
  if v_action_url is not null and (v_action_url not like '/%' or v_action_url like '//%') then
    v_action_url := null;
  end if;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url
  )
  values (
    p_user_id,
    nullif(trim(p_target_role), ''),
    p_type,
    p_title,
    p_message,
    nullif(trim(p_entity_type), ''),
    nullif(trim(p_entity_id), ''),
    v_action_url
  )
  returning * into inserted_notification;

  return inserted_notification;
end;
$$;

revoke all on function public.create_notification(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.create_notification(uuid, text, text, text, text, text, text, text) to authenticated;
