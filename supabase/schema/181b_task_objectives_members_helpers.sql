-- 181b: helpers (run second, after 181a).

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_operational_task_members(
  p_task public.assigned_tasks
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_mutate_operational_task(p_task)
    and (
      public.is_operational_task_area_manager()
      or p_task.created_by = auth.uid()
    );
$$;

create or replace function public.can_manage_operational_task_watchers(
  p_task public.assigned_tasks
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_operational_task_members(p_task);
$$;

create or replace function public.is_operational_task_watcher(
  p_task_id text,
  p_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_watchers tw
    where tw.task_id = p_task_id
      and tw.profile_id = coalesce(p_profile_id, auth.uid())
  );
$$;

create or replace function public.get_operational_task_permissions(
  p_task public.assigned_tasks
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'can_view', public.can_access_operational_task(p_task, 'view'),
    'can_edit', public.can_mutate_operational_task(p_task),
    'can_assign', public.can_manage_operational_task_members(p_task),
    'can_move', public.can_mutate_operational_task(p_task),
    'manage_members', public.can_manage_operational_task_members(p_task),
    'manage_watchers', public.can_manage_operational_task_watchers(p_task),
    'watch_self', public.can_access_operational_task(p_task, 'view'),
    'is_watching', public.is_operational_task_watcher(p_task.id, auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Notification helper (best-effort)
-- ---------------------------------------------------------------------------
create or replace function public.notify_operational_task_event(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_task_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_url text;
begin
  if p_user_id is null or p_user_id = auth.uid() then
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.status = 'active'
  ) then
    return;
  end if;

  v_action_url := '/tasks/trabajo/mi-trabajo?task=' || p_task_id;

  begin
    perform public.create_notification(
      p_user_id,
      null,
      p_type,
      p_title,
      p_message,
      'task',
      p_task_id,
      v_action_url
    );
  exception when others then
    null;
  end;
end;
$$;

revoke all on function public.notify_operational_task_event(uuid, text, text, text, text) from public;
grant execute on function public.notify_operational_task_event(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ensure assignees are watchers
-- ---------------------------------------------------------------------------
create or replace function public.ensure_operational_task_assignee_watchers(
  p_task_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_watchers (task_id, profile_id, created_by)
  select p_task_id, ta.profile_id, auth.uid()
  from public.task_assignees ta
  where ta.task_id = p_task_id
    and ta.status = 'active'
  on conflict (task_id, profile_id) do nothing;
end;
$$;

revoke all on function public.ensure_operational_task_assignee_watchers(text) from public;
grant execute on function public.ensure_operational_task_assignee_watchers(text) to authenticated;
