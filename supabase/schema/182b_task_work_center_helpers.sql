-- 182b: Work center helpers — run after 182a.

-- ---------------------------------------------------------------------------
-- Extended permissions
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_task_work_plan(
  p_task public.assigned_tasks
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_mutate_operational_task(p_task);
$$;

create or replace function public.can_comment_on_task(
  p_task public.assigned_tasks
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_access_operational_task(p_task, 'view');
$$;

create or replace function public.can_upload_task_files(
  p_task public.assigned_tasks
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_mutate_operational_task(p_task);
$$;

create or replace function public.can_submit_task_evidence(
  p_task public.assigned_tasks
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_mutate_operational_task(p_task);
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
    'is_watching', public.is_operational_task_watcher(p_task.id, auth.uid()),
    'manage_work_plan', public.can_manage_task_work_plan(p_task),
    'complete_steps', public.can_mutate_operational_task(p_task),
    'assign_steps', public.can_mutate_operational_task(p_task),
    'upload_attachments', public.can_upload_task_files(p_task),
    'comment', public.can_comment_on_task(p_task),
    'submit_evidence', public.can_submit_task_evidence(p_task),
    'verify_evidence', public.is_operational_task_area_manager()
  );
$$;

-- ---------------------------------------------------------------------------
-- Work plan progress + next step
-- ---------------------------------------------------------------------------
create or replace function public.get_task_work_plan_progress(p_task_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when count(*) filter (where s.deleted_at is null) = 0 then null
    else jsonb_build_object(
      'total', count(*) filter (where s.deleted_at is null)::int,
      'done', count(*) filter (where s.deleted_at is null and s.completed)::int
    )
  end
  from public.task_steps s
  where s.task_id = p_task_id;
$$;

create or replace function public.get_task_next_work_step(p_task_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'step_id', s.id,
    'text', s.text,
    'list_title', sl.title,
    'list_id', sl.id
  )
  from public.task_steps s
  join public.task_step_lists sl on sl.id = s.step_list_id and sl.deleted_at is null
  where s.task_id = p_task_id
    and s.deleted_at is null
    and not s.completed
    and (
      s.depends_on_step_id is null
      or exists (
        select 1 from public.task_steps dep
        where dep.id = s.depends_on_step_id
          and dep.deleted_at is null
          and dep.completed
      )
    )
  order by sl.sort_position asc, s.sort_position asc
  limit 1;
$$;

create or replace function public.task_work_plan_json(p_task_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', sl.id,
      'title', sl.title,
      'sort_position', sl.sort_position,
      'steps', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'text', s.text,
            'completed', s.completed,
            'completed_at', s.completed_at,
            'completed_by', s.completed_by,
            'completed_by_name', (select p.full_name from public.profiles p where p.id = s.completed_by),
            'assigned_profile_id', s.assigned_profile_id,
            'assigned_name', (select p.full_name from public.profiles p where p.id = s.assigned_profile_id),
            'assigned_avatar', (select p.avatar_url from public.profiles p where p.id = s.assigned_profile_id),
            'due_at', s.due_at,
            'sort_position', s.sort_position,
            'depends_on_step_id', s.depends_on_step_id,
            'depends_on_text', (
              select dep.text from public.task_steps dep
              where dep.id = s.depends_on_step_id and dep.deleted_at is null
            ),
            'is_blocked', (
              s.depends_on_step_id is not null
              and not exists (
                select 1 from public.task_steps dep
                where dep.id = s.depends_on_step_id
                  and dep.deleted_at is null
                  and dep.completed
              )
            ),
            'converted_task_id', s.converted_task_id,
            'attachment_count', (
              select count(*)::int from public.task_attachments a
              where a.step_id = s.id and a.deleted_at is null
            ),
            'comment_count', (
              select count(*)::int from public.task_comments c
              where c.step_id = s.id and c.deleted_at is null
            )
          )
          order by s.sort_position asc
        )
        from public.task_steps s
        where s.step_list_id = sl.id and s.deleted_at is null
      ), '[]'::jsonb)
    )
    order by sl.sort_position asc
  ), '[]'::jsonb)
  from public.task_step_lists sl
  where sl.task_id = p_task_id
    and sl.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Step dependency cycle check (F7)
-- ---------------------------------------------------------------------------
create or replace function public.task_step_has_dependency_cycle(
  p_step_id uuid,
  p_depends_on uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current uuid := p_depends_on;
  v_guard int := 0;
begin
  if p_step_id is null or p_depends_on is null then
    return false;
  end if;
  if p_step_id = p_depends_on then
    return true;
  end if;

  while v_current is not null and v_guard < 100 loop
    if v_current = p_step_id then
      return true;
    end if;
    select s.depends_on_step_id into v_current
    from public.task_steps s
    where s.id = v_current and s.deleted_at is null;
    v_guard := v_guard + 1;
  end loop;

  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mention parsing helper
-- ---------------------------------------------------------------------------
create or replace function public.parse_task_comment_mentions(
  p_task_id text,
  p_body text
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := '{}'::uuid[];
  v_member record;
  v_pattern text;
begin
  for v_member in
    select distinct p.id, p.full_name
    from (
      select ta.profile_id as id
      from public.task_assignees ta
      where ta.task_id = p_task_id and ta.status = 'active'
      union
      select tw.profile_id as id
      from public.task_watchers tw
      where tw.task_id = p_task_id
    ) members
    join public.profiles p on p.id = members.id
    where coalesce(trim(p.full_name), '') <> ''
  loop
    v_pattern := '@' || regexp_replace(v_member.full_name, '([.^$|*+?(){}\[\]\\])', '\\\1', 'g');
    if p_body ~* v_pattern then
      v_ids := array_append(v_ids, v_member.id);
    end if;
  end loop;
  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

-- ---------------------------------------------------------------------------
-- Task timing helpers (sidebar)
-- ---------------------------------------------------------------------------
create or replace function public.task_open_duration_days(p_task public.assigned_tasks)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, extract(day from (now() - p_task.created_at))::int);
$$;

create or replace function public.task_blocked_duration_days(p_task public.assigned_tasks)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_task.status in ('waiting', 'blocked') and p_task.waiting_since is not null
      then greatest(0, extract(day from (now() - p_task.waiting_since))::int)
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- Activity icon metadata
-- ---------------------------------------------------------------------------
create or replace function public.task_activity_icon(p_action text)
returns jsonb
language sql
immutable
as $$
  select case p_action
    when 'created' then '{"icon":"🟢","tone":"success"}'::jsonb
    when 'assignees_updated' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'watchers_updated' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'watcher_added' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'watcher_removed' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'status_changed' then '{"icon":"◎","tone":"info"}'::jsonb
    when 'step_completed' then '{"icon":"🟡","tone":"warning"}'::jsonb
    when 'step_uncompleted' then '{"icon":"🟡","tone":"warning"}'::jsonb
    when 'step_list_created' then '{"icon":"📋","tone":"info"}'::jsonb
    when 'step_list_deleted' then '{"icon":"📋","tone":"info"}'::jsonb
    when 'attachment_added' then '{"icon":"📎","tone":"info"}'::jsonb
    when 'attachment_removed' then '{"icon":"📎","tone":"info"}'::jsonb
    when 'comment_added' then '{"icon":"💬","tone":"info"}'::jsonb
    when 'evidence_submitted' then '{"icon":"✅","tone":"success"}'::jsonb
    when 'step_converted' then '{"icon":"↗","tone":"info"}'::jsonb
    else '{"icon":"•","tone":"muted"}'::jsonb
  end;
$$;

revoke all on function public.can_manage_task_work_plan(public.assigned_tasks) from public;
revoke all on function public.can_comment_on_task(public.assigned_tasks) from public;
revoke all on function public.can_upload_task_files(public.assigned_tasks) from public;
revoke all on function public.can_submit_task_evidence(public.assigned_tasks) from public;
revoke all on function public.get_task_work_plan_progress(text) from public;
revoke all on function public.get_task_next_work_step(text) from public;
revoke all on function public.task_work_plan_json(text) from public;
revoke all on function public.task_step_has_dependency_cycle(uuid, uuid) from public;
revoke all on function public.parse_task_comment_mentions(text, text) from public;
revoke all on function public.task_open_duration_days(public.assigned_tasks) from public;
revoke all on function public.task_blocked_duration_days(public.assigned_tasks) from public;

grant execute on function public.can_manage_task_work_plan(public.assigned_tasks) to authenticated;
grant execute on function public.can_comment_on_task(public.assigned_tasks) to authenticated;
grant execute on function public.can_upload_task_files(public.assigned_tasks) to authenticated;
grant execute on function public.can_submit_task_evidence(public.assigned_tasks) to authenticated;
grant execute on function public.get_task_work_plan_progress(text) to authenticated;
grant execute on function public.get_task_next_work_step(text) to authenticated;
grant execute on function public.task_work_plan_json(text) to authenticated;
grant execute on function public.task_step_has_dependency_cycle(uuid, uuid) to authenticated;
grant execute on function public.parse_task_comment_mentions(text, text) to authenticated;
grant execute on function public.task_open_duration_days(public.assigned_tasks) to authenticated;
grant execute on function public.task_blocked_duration_days(public.assigned_tasks) to authenticated;
