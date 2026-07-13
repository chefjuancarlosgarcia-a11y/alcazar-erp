-- 182e: Board performance — single query for work summary per card.
-- Apply after 182d. Safe to re-run (CREATE OR REPLACE).

create or replace function public.get_task_work_card_summary(p_task_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with stats as (
    select
      count(*) filter (where s.deleted_at is null)::int as total,
      count(*) filter (where s.deleted_at is null and s.completed)::int as done
    from public.task_steps s
    where s.task_id = p_task_id
  ),
  next_step as (
    select jsonb_build_object(
      'step_id', s.id,
      'text', s.text,
      'list_title', sl.title,
      'list_id', sl.id
    ) as payload
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
    limit 1
  )
  select jsonb_build_object(
    'steps_progress', case when stats.total > 0 then jsonb_build_object(
      'total', stats.total,
      'done', stats.done
    ) else null end,
    'work_summary', (select payload from next_step)
  )
  from stats;
$$;

create or replace function public.operational_task_card_summary(
  p_task public.assigned_tasks
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with work as (
    select public.get_task_work_card_summary(p_task.id) as payload
  )
  select jsonb_build_object(
    'id', p_task.id,
    'title', p_task.title,
    'objective', p_task.objective,
    'expected_result', p_task.expected_result,
    'status', p_task.status,
    'priority', p_task.priority,
    'due_at', p_task.due_at,
    'waiting_reason', p_task.waiting_reason,
    'waiting_unblock_note', p_task.waiting_unblock_note,
    'sort_position', p_task.sort_position,
    'area_id', p_task.area_id,
    'area_name', (select a.name from public.areas a where a.id = p_task.area_id),
    'is_overdue', (
      p_task.due_at is not null
      and p_task.due_at < now()
      and p_task.status not in ('completed', 'cancelled')
    ),
    'steps_progress', work.payload -> 'steps_progress',
    'work_summary', work.payload -> 'work_summary',
    'assignees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', ta.profile_id,
          'full_name', coalesce(p.full_name, ''),
          'avatar_url', p.avatar_url,
          'assignment_role', ta.assignment_role
        )
        order by case ta.assignment_role when 'primary' then 0 else 1 end, p.full_name
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id and ta.status = 'active'
    ), '[]'::jsonb),
    'primary_assignee', (
      select jsonb_build_object(
        'profile_id', ta.profile_id,
        'full_name', coalesce(p.full_name, ''),
        'avatar_url', p.avatar_url
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id
        and ta.status = 'active'
        and ta.assignment_role = 'primary'
      limit 1
    ),
    'permissions', public.get_operational_task_permissions(p_task)
  )
  from work;
$$;

grant execute on function public.get_task_work_card_summary(text) to authenticated;
