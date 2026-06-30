-- Bulk mark-as-read for admin users only.
-- Apply after 097_catering_notification_roles.sql.

create or replace function public.mark_all_my_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if public.normalize_profile_role(public.current_profile_role()) <> 'admin' then
    raise exception 'Solo administradores pueden marcar todas las notificaciones como leidas.';
  end if;

  update public.notifications n
  set is_read = true
  where n.is_read = false
    and auth.uid() is not null
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
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_all_my_notifications_read() from public;
grant execute on function public.mark_all_my_notifications_read() to authenticated;
