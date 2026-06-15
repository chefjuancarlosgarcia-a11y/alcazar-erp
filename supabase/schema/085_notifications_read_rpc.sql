-- Reliable notification reads for authenticated users + normalized role matching.
-- Apply after 084_catering_request_notifications.sql.

drop policy if exists "notifications_read_recipients" on public.notifications;

create policy "notifications_read_recipients"
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      target_role is not null
      and public.normalize_profile_role(target_role) = public.normalize_profile_role(
        public.current_profile_role()
      )
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
  order by n.is_read asc, n.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.get_my_notifications(integer) from public;
grant execute on function public.get_my_notifications(integer) to authenticated;
